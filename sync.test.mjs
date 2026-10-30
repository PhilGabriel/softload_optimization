import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { main, clientScript, purgeCloudflare } from './sync.mjs';

test('fetches top paths from a fake Umami and writes the script', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req);
    if (req.url === '/api/auth/login') return res.end(JSON.stringify({ token: 't0k' }));
    res.end(JSON.stringify([{ x: '/', y: 50 }, { x: null, y: 3 }, { x: '/pricing/', y: 20 }]));
  });
  await new Promise((r) => server.listen(0, r));
  const out = join(await mkdtemp(join(tmpdir(), 'snv-')), 'vitals.js');
  try {
    const paths = await main({
      UMAMI_API_URL: `http://localhost:${server.address().port}/api/`,
      UMAMI_WEBSITE_ID: 'site-1',
      UMAMI_USERNAME: 'admin',
      UMAMI_PASSWORD: 'pw',
      OUT_FILE: out,
    });
    assert.deepEqual(paths, ['/', '/pricing']);
    const metrics = new URL(seen[1].url, 'http://x');
    assert.equal(metrics.pathname, '/api/websites/site-1/metrics');
    assert.equal(metrics.searchParams.get('type'), 'path');
    assert.equal(+metrics.searchParams.get('endAt') - +metrics.searchParams.get('startAt'), 30 * 864e5);
    assert.equal(seen[1].headers.authorization, 'Bearer t0k');
    const file = await readFile(out, 'utf8');
    assert.match(file, /var webVitals=/);
    assert.match(file, /\["\/","\/pricing"\]/);
  } finally {
    server.close();
  }
});

test('client reports only top paths, per navigation type', () => {
  const handlers = {};
  const opts = {};
  const tracked = [];
  const on = (name) => (fn, o) => { handlers[name] = fn; opts[name] = o; };
  const ctx = {
    URL,
    location: { href: 'https://site.test/pricing' },
    self: { webVitals: { onLCP: on('LCP'), onCLS: on('CLS'), onINP: on('INP'), onTTFB: on('TTFB'), onFCP: on('FCP') } },
    window: { umami: { track: (fn) => tracked.push(fn({ website: 'w', url: '/old' })) } },
  };
  vm.runInNewContext(clientScript(['/pricing']), ctx);

  assert.equal(JSON.stringify(opts.LCP), '{"reportSoftNavs":true}');
  assert.equal(opts.TTFB, undefined);
  handlers.LCP({ name: 'LCP', value: 812.4, rating: 'good', navigationType: 'soft-navigation', navigationURL: 'https://site.test/pricing?a=1' });
  handlers.CLS({ name: 'CLS', value: 0.017, rating: 'good', navigationType: 'navigate', navigationURL: 'https://site.test/pricing' });
  handlers.FCP({ name: 'FCP', value: 300, rating: 'good', navigationType: 'navigate', navigationURL: 'https://site.test/pricing/' });
  handlers.INP({ name: 'INP', value: 90, rating: 'good', navigationType: 'soft-navigation', navigationURL: 'https://site.test/not-top' });

  assert.equal(tracked.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(tracked[0])), {
    website: 'w', url: '/pricing', name: 'web-vital',
    data: { metric: 'LCP', value: 812, rating: 'good', navigationType: 'soft-navigation' },
  });
  assert.equal(tracked[1].data.value, 17);
  assert.equal(tracked[2].url, '/pricing');
});

test('Cloudflare purge is optional and needs all three variables', async (t) => {
  const calls = [];
  let reply = { ok: true, json: async () => ({ success: true }) };
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push([url, init]); return reply; });

  assert.equal(await purgeCloudflare({}), false);
  await assert.rejects(purgeCloudflare({ CF_ZONE_ID: 'z' }), /needs all of/);
  assert.equal(calls.length, 0);

  const env = { CF_ZONE_ID: 'z1', CF_API_TOKEN: 'tok', CF_PURGE_URL: 'https://site.test/static/soft-nav-vitals.js' };
  assert.equal(await purgeCloudflare(env), true);
  assert.equal(calls[0][0], 'https://api.cloudflare.com/client/v4/zones/z1/purge_cache');
  assert.equal(calls[0][1].headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0][1].body), { files: [env.CF_PURGE_URL] });

  reply = { ok: false, status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }) };
  await assert.rejects(purgeCloudflare(env), /403.*Authentication error/);
});
