// Reads the most visited paths of the last 30 days from Umami and writes a
// browser script that reports soft navigation web vitals for those paths back to Umami.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
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
  return (await res.json()).filter((r) => r.x).map((r) => r.x);
}

// Runs in the browser after the web-vitals IIFE, which defines self.webVitals.
export function clientScript(paths) {
  return `(function () {
  var TOP = new Set(${JSON.stringify(paths)});
  function send(metric) {
    // Metrics can arrive after the user moved on, so the URL comes from the metric, not location.
    var path = new URL(metric.navigationURL || location.href).pathname;
    if (!TOP.has(path) || !window.umami) return;
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
  // TTFB and FCP only make sense for page loads.
  wv.onTTFB(send);
  wv.onFCP(send);
})();
`;
}

export async function main(env = process.env) {
  for (const key of ['UMAMI_API_URL', 'UMAMI_WEBSITE_ID']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  env = { ...env, UMAMI_API_URL: env.UMAMI_API_URL.replace(/\/+$/, '') };
  const paths = await topPaths(env);
  const iife = join(dirname(createRequire(import.meta.url).resolve('web-vitals')), 'web-vitals.iife.js');
  const out = env.OUT_FILE || 'out/soft-nav-vitals.js';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${await readFile(iife, 'utf8')}\n${clientScript(paths)}`);
  console.log(`Wrote ${out} for ${paths.length} paths`);
  return paths;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
