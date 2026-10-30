// Reads the most visited paths of the last 30 days from Umami and writes a
// browser script that reports soft navigation web vitals for those paths back to Umami.
import { writeFile, readFile, mkdir, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 24 * 60 * 60 * 1000;

async function authHeaders(env) {
  if (env.UMAMI_API_KEY) {
    // Same header pair as @umami/api-client: Cloud reads x-umami-api-key, self-hosted keys the bearer.
    return { 'x-umami-api-key': env.UMAMI_API_KEY, authorization: `Bearer ${env.UMAMI_API_KEY}` };
  }
  if (!env.UMAMI_USERNAME || !env.UMAMI_PASSWORD) {
    throw new Error('Set UMAMI_API_KEY or UMAMI_USERNAME + UMAMI_PASSWORD');
  }
  const res = await fetch(`${env.UMAMI_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.UMAMI_USERNAME, password: env.UMAMI_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Umami login failed: ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error('Umami login returned no token (two-factor accounts need UMAMI_API_KEY)');
  return { authorization: `Bearer ${token}` };
}

export async function topPaths(env, now = Date.now()) {
  const query = new URLSearchParams({
    type: 'path',
    startAt: String(now - 30 * DAY),
    endAt: String(now),
    limit: env.TOP_N || '20',
  });
  const res = await fetch(`${env.UMAMI_API_URL}/websites/${env.UMAMI_WEBSITE_ID}/metrics?${query}`, {
    headers: await authHeaders(env),
  });
  if (!res.ok) throw new Error(`Umami metrics failed: ${res.status} ${await res.text()}`);
  // Response rows are { x: path, y: views }; x is null for unknown paths.
  return (await res.json()).filter((r) => r.x).map((r) => trimSlash(r.x));
}

// Umami may store /pricing while the browser reports /pricing/ (REMOVE_TRAILING_SLASH).
function trimSlash(path) {
  return path.replace(/(.)\/+$/, '$1');
}

// Runs in the browser after the web-vitals IIFE, which defines self.webVitals.
export function clientScript(paths) {
  return `(function () {
  var TOP = new Set(${JSON.stringify(paths)});
  var SENT = new Set();
  function send(metric) {
    // Metrics can arrive after the user moved on, so the URL comes from the metric, not location.
    var path = new URL(metric.navigationURL || location.href).pathname.replace(/(.)\\/+$/, '$1');
    // CLS and INP are re-reported on every tab hide; Umami events can't be updated, so send once per metric id.
    if (!TOP.has(path) || !window.umami || SENT.has(metric.id)) return;
    SENT.add(metric.id);
    window.umami.track(function (props) {
      return Object.assign({}, props, {
        url: path,
        name: 'web-vital',
        data: {
          metric: metric.name,
          value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
          rating: metric.rating,
          navigationType: metric.navigationType
        }
      });
    });
  }
  var wv = self.webVitals, soft = { reportSoftNavs: true };
  // Each soft navigation gets its own LCP, CLS and INP; page load vitals end at the first soft navigation.
  wv.onLCP(send, soft);
  wv.onCLS(send, soft);
  wv.onINP(send, soft);
  // TTFB and FCP only for page loads, as in Sentry v11: soft navigation TTFB is always 0.
  wv.onTTFB(send);
  wv.onFCP(send);
})();
`;
}

// Optional: purge the old file from the Cloudflare edge cache after each sync.
export async function purgeCloudflare(env) {
  const keys = ['CF_ZONE_ID', 'CF_API_TOKEN', 'CF_PURGE_URL'];
  const set = keys.filter((k) => env[k]);
  if (!set.length) return false;
  if (set.length < keys.length) throw new Error(`Cloudflare purge needs all of ${keys.join(', ')}`);
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ files: [env.CF_PURGE_URL] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(`Cloudflare purge failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return true;
}

export async function main(env = process.env) {
  for (const key of ['UMAMI_API_URL', 'UMAMI_WEBSITE_ID']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  env = { ...env, UMAMI_API_URL: env.UMAMI_API_URL.replace(/\/+$/, '') };
  const paths = await topPaths(env);
  const dist = dirname(createRequire(import.meta.url).resolve('web-vitals'));
  const { version } = JSON.parse(await readFile(join(dist, '..', 'package.json'), 'utf8'));
  // Apache-2.0 requires the notice to travel with the bundled copy.
  const notice = `/*! web-vitals v${version} | Copyright 2020 Google LLC | Apache-2.0 | https://www.apache.org/licenses/LICENSE-2.0 */`;
  const out = env.OUT_FILE || 'out/soft-nav-vitals.js';
  await mkdir(dirname(out), { recursive: true });
  // Write then rename, so the web server never serves a half-written file.
  const iife = await readFile(join(dist, 'web-vitals.iife.js'), 'utf8');
  await writeFile(`${out}.tmp`, `${notice}\n${iife}\n${clientScript(paths)}`);
  await rename(`${out}.tmp`, out);
  console.log(`Wrote ${out} for ${paths.length} paths`);
  if (await purgeCloudflare(env)) console.log(`Purged ${env.CF_PURGE_URL} from Cloudflare`);
  return paths;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
