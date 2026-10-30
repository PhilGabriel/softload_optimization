# softload_optimization

Per-route Core Web Vitals for single-page apps, reported into [Umami](https://umami.is).

[Deutsche Version](README.de.md)

A small server job asks Umami for your most visited paths of the last 30 days. It then writes one static JavaScript file. Your pages load that file next to the Umami tracker. On those paths it measures LCP, CLS and INP for every soft navigation (client-side route change) and sends the values back to Umami as events.



## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [What gets measured](#what-gets-measured)
- [When to use it, and when not](#when-to-use-it-and-when-not)
- [What to expect](#what-to-expect)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Embedding the script](#embedding-the-script)
- [Behind Cloudflare](#behind-cloudflare)
- [Reading the data in Umami](#reading-the-data-in-umami)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Open core and commercial use](#open-core-and-commercial-use)
- [License](#license)

## Why

Classic web vitals measure the page a user lands on. In a single-page app most of a visit happens after that: the user clicks through routes, and the app swaps content without loading a new document. Those soft navigations stayed unmeasured.

Two problems follow:

1. Pages that users only reach by clicking (settings, checkout step two, detail pages) get little or no web vitals data, however much traffic they have.
2. CLS and INP cover the whole lifetime of a page. A layout shift on a route the user opened five minutes later counts against the landing page.

Chromium 151 added soft navigation reporting to the browser. The `web-vitals` library exposes it with the `reportSoftNavs` option. This project wires that into Umami.

## How it works

```
 ┌────────────┐  1. top paths, last 30 days   ┌─────────────┐
 │   Umami    │ ─────────────────────────────▶│   sync.mjs  │  (cron, Docker)
 │    API     │                               └──────┬──────┘
 └─────▲──────┘                                      │ 2. writes
       │                                             ▼
       │ 4. event "web-vital"             soft-nav-vitals.js  (static file)
       │                                             │ 3. loaded by your pages
 ┌─────┴──────┐                                      ▼
 │   Umami    │◀──────────────────────────────  Browser: web-vitals with
 │  tracker   │                                 reportSoftNavs, only top paths
 └────────────┘
```

1. `sync.mjs` calls `GET /websites/{id}/metrics?type=path` for the last 30 days (default: top 20 paths).
2. It writes `soft-nav-vitals.js`: the `web-vitals` 6.2.3 browser build, the path list, and a short glue script. The write is atomic (temp file plus rename).
3. Optionally it purges the file from the Cloudflare cache.
4. In the browser the script reports metrics for those paths through `window.umami.track()`.

The job runs once and exits. You schedule it with cron.

## What gets measured

| Navigation type (`navigationType`) | Metrics |
|---|---|
| Page load (`navigate`, `reload`, `back-forward`, `prerender`, `restore`) | LCP, CLS, INP, FCP, TTFB |
| Soft navigation (`soft-navigation`) | LCP, CLS, INP |
| bfcache restore (`back-forward-cache`) | LCP, CLS, INP, FCP, TTFB |

- **Soft navigation LCP** runs from the interaction that triggered the navigation to the largest paint of the new route.
- **Page load CLS and INP** end at the first soft navigation. Everything after that belongs to the route where it happened.
- **TTFB and FCP** are reported for page loads and bfcache restores, never for soft navigations. A soft navigation has no document request, so its TTFB would always be 0. Sentry v11 makes the same choice.
- **One event per metric.** `web-vitals` reports CLS and INP again each time the tab is hidden. Umami events cannot be updated, so the script sends only the first report of each metric. Shifts or interactions after the user returns to the tab are not counted.
- **The path** comes from `metric.navigationURL`, not from `location`. Metrics like CLS arrive late, often after the user has moved on.

The browser decides what counts as a soft navigation. Chrome's current rules: the user started it, the URL visibly changed, and something new was painted. Not every router change qualifies. Sentry reports that about three in four route changes qualified in their app.

## When to use it, and when not

**Good fit:**

- You run a single-page app or a hybrid (Next.js, Nuxt, SvelteKit, React Router, Angular, Vue Router) and already use Umami.
- Users click through many routes per visit, or important pages are rarely entry pages.
- You want per-route numbers without a full tracing or RUM product.
- You want to keep the privacy profile of Umami: no extra cookies, no third-party service.

**Poor fit:**

- **Classic multi-page sites.** Every navigation is a page load. Soft navigation support adds nothing. Plain `web-vitals` gives you the same data.
- **Traffic is mostly Safari or Firefox.** Only Chromium 151+ reports soft navigations. Other browsers still deliver page load vitals.
- **You need to know why a route is slow.** This project reports numbers, not causes. For traces, spans and attribution use a tracing tool (for example Sentry) or the `web-vitals` attribution build.
- **Very low traffic.** Percentiles over a handful of events per route say little.
- **Strict event budgets.** A page load produces up to five events, each soft navigation up to three, each bfcache restore up to five. Check the event allowance of your Umami plan.
- **Many dynamic routes** like `/orders/12345`. Umami counts each concrete path separately, so a single detail page rarely makes the top list. See [Limitations](#limitations).

**Check first:** newer Umami API versions (seen in `@umami/api-client` 0.81) list a `performance` payload type with `lcp`, `cls`, `inp`, `fcp` and `ttfb` fields. This project does not use it. Whether your Umami tracker already collects vitals that way, and whether it separates soft navigations, is not covered here. Check before running both.

## What to expect

**Benefits:**

- **Coverage:** routes that users reach by clicking get their own LCP, CLS and INP.
- **Cleaner page load numbers:** shifts and slow interactions on later routes no longer count against the landing page.
- **Focus:** only the top paths report, which keeps the event volume and noise low.
- **Small footprint:** the generated file is about 10 KB, about 4 KB gzip. No extra network requests besides the Umami events.

**Side effects:**

- **Overall numbers improve when you mix in soft navigations.** They skip the document request and are usually faster. Sentry measured p75 LCP of 2.48 s across all navigations and 1.17 s for soft navigations alone. Your app did not get faster, the mix changed. Always filter by `navigationType`.
- **Thresholds:** the good/poor thresholds of Core Web Vitals come from page load data. Use them as orientation for soft navigations, not as a pass mark.

### Limitations

- Only Chromium 151+ reports soft navigations. The browser heuristics may still change.
- The path list updates only when `sync.mjs` runs. New pages report after the next run.
- Paths are compared exactly (trailing slash ignored). Dynamic segments are not grouped.
- CLS and INP count until the tab is first hidden. Later changes are not sent.
- If `window.umami` is missing when a metric arrives, that metric is dropped. See [Embedding the script](#embedding-the-script).
- Umami's own handling of event data decides how you can aggregate values. Percentiles may require a database query or export, depending on your Umami version.

## Requirements

- Umami (self-hosted or Umami Cloud) with API access
- Node.js 22 or Docker on the server that generates the file
- A web server or CDN that serves the generated file from your domain

## Quick start

1. Create an `.env` file from the template:

   ```bash
   cp .env.example .env
   ```

2. Build the image:

   ```bash
   docker build -t softload .
   ```

3. Run it once, writing into your static folder:

   ```bash
   docker run --rm --user "$(stat -c %u:%g /var/www/static)" --env-file .env -v /var/www/static:/data softload
   ```

4. Add the script to your pages, see [Embedding the script](#embedding-the-script).

5. Schedule a daily run, for example at 03:15 for a folder owned by `www-data` (33:33):

   ```
   15 3 * * * docker run --rm --user 33:33 --env-file /opt/softload/.env -v /var/www/static:/data softload
   ```

The container runs as user `node` (uid 1000). `--user` makes it write as the owner of the target folder. Without it, writing fails with `EACCES`.

Without Docker (Node.js 22):

```bash
npm ci
```

```bash
node --env-file=.env sync.mjs
```

## Configuration

All settings are environment variables.

| Variable | Required | Description |
|---|---|---|
| `UMAMI_API_URL` | yes | `https://api.umami.is/v1` for Umami Cloud, `https://umami.example.com/api` for self-hosted |
| `UMAMI_WEBSITE_ID` | yes | UUID of the website in Umami |
| `UMAMI_API_KEY` | one of | API key. Sent as `x-umami-api-key` and as bearer token. |
| `UMAMI_USERNAME`, `UMAMI_PASSWORD` | one of | Login for self-hosted Umami. Accounts with two-factor login need an API key. |
| `TOP_N` | no | Number of paths, default `20` |
| `EXCLUDE_REGEX` | no | Regular expression; matching paths are left out of the list, e.g. `^/(admin|login)(/|$)` |
| `OUT_FILE` | no | Output file. Default `out/soft-nav-vitals.js`, in the container `/data/soft-nav-vitals.js` |
| `CF_ZONE_ID`, `CF_API_TOKEN`, `CF_PURGE_URL` | no | Cloudflare cache purge, see [Behind Cloudflare](#behind-cloudflare) |

Exit codes: `0` on success, `1` on any error (missing variable, failed login, API error, failed purge). On an API error the old file stays untouched.

## Embedding the script

Load it on every page, after the Umami tracker:

```html
<script defer data-cfasync="false" src="https://umami.example.com/script.js" data-website-id="..."></script>
<script defer data-cfasync="false" src="/static/soft-nav-vitals.js"></script>
```

- Both tags need `defer`, and the tracker comes first. Deferred scripts run in order, so `window.umami` exists when the first metric arrives.
- With `async` or a tag manager the tracker can load late. Metrics that arrive before it, usually FCP, are lost.
- `data-cfasync="false"` keeps the Cloudflare Rocket Loader from reordering the scripts. Without Cloudflare the attribute has no effect.

## Behind Cloudflare

**Cache.** Cloudflare caches `.js` files. After a sync the edge would keep serving the old file until its cache time runs out. If all three variables are set, `sync.mjs` purges exactly that file after writing it:

- `CF_ZONE_ID`: zone ID from the domain overview in the Cloudflare dashboard
- `CF_API_TOKEN`: API token with the permission "Zone → Cache Purge → Purge" and nothing else
- `CF_PURGE_URL`: public URL of the file, for example `https://example.com/static/soft-nav-vitals.js`

If only some of them are set, the job stops with exit code 1 so that a typo does not silently disable the purge. A failed purge also ends with exit code 1. In both cases the new file is already written.

**Bot protection.** Bot Fight Mode and WAF rules can block requests that are not from a browser:

- Call Umami's API through its internal address, for example `UMAMI_API_URL=http://umami:3000/api` on the same Docker network.
- The tracker's `POST /api/send` must not receive a challenge, or events get lost. That affects all Umami data, not only this project.

**Effect on the numbers.** Cloudflare changes page load metrics (TTFB, FCP, LCP), which is what users experience. Soft navigations have no document request. Cloudflare only affects the API calls your app makes during them.

## Reading the data in Umami

Each value is a custom event named `web-vital` with these properties:

| Property | Example | Meaning |
|---|---|---|
| `metric` | `LCP` | `LCP`, `CLS`, `INP`, `FCP` or `TTFB` |
| `value` | `812` | Milliseconds. CLS is multiplied by 1000 (`17` means 0.017), because Umami handles integers better. |
| `rating` | `good` | `good`, `needs-improvement` or `poor`, from `web-vitals` |
| `navigationType` | `soft-navigation` | See [What gets measured](#what-gets-measured) |

The event URL is the path of the navigation the metric belongs to. In Umami open Events, choose `web-vital` and filter by `navigationType` and `metric`.

To keep alerts or reports about page loads stable, exclude `soft-navigation` and `back-forward-cache` rather than including specific values.

## Privacy and security

- **No new cookies or identifiers.** The script sends four properties per metric through the existing Umami tracker. Umami's own data handling applies.
- **Paths can contain personal data** if your URLs do (for example `/users/jane.doe`). Only top paths are reported, but check the list.
- **The path list is public.** The generated file contains your top paths in plain text. Anyone can read which pages are popular. Exclude sensitive paths from tracking in Umami, or do not use this project for them.
- **The API key stays on the server.** It is only used by `sync.mjs` and never written into the generated file.
- **Use a dedicated Umami user or key** with the least access your Umami version allows, and a Cloudflare token limited to cache purge.

Report security issues as described in [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Missing UMAMI_API_URL` | Variable not set or `.env` not passed. Check `--env-file`. |
| `Umami login failed: 401` | Wrong credentials, or the account uses two-factor login. Use an API key. |
| `Umami metrics failed: 404` | Wrong `UMAMI_WEBSITE_ID`, or `UMAMI_API_URL` missing `/api` (self-hosted) or `/v1` (Cloud). |
| `EACCES` when writing | Container user cannot write to the volume. Pass `--user`, see [Quick start](#quick-start). |
| `403` from the Umami API behind Cloudflare | Bot protection. Use the internal Umami address. |
| File updated, browser gets the old one | CDN or browser cache. Set the Cloudflare variables or lower the cache time for this file. |
| No `soft-navigation` events | Browser is not Chromium 151+, the route is not in the top list, or the navigation did not meet the browser's rules (no interaction, no visible paint). |
| No events at all | `window.umami` missing (load order, ad blocker) or the current path is not in the list. Open the generated file and check the path list. |

## Development

```bash
npm ci
```

```bash
npm test
```

The tests use Node's built-in test runner. They start a fake Umami server, check the query and the written file, run the browser glue code in a sandbox, and mock the Cloudflare API. No network access needed.

Project layout:

| File | Purpose |
|---|---|
| `sync.mjs` | The whole job: Umami query, file generation, Cloudflare purge |
| `sync.test.mjs` | Tests |
| `Dockerfile` | Runtime image (Node.js 22 Alpine) |
| `.env.example` | Configuration template |

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute and [CHANGELOG.md](CHANGELOG.md) for changes.

## Open core and commercial use

This repository is the open core. It is licensed under MIT and stays free: you may use, change, host and sell it, including in commercial products, as long as you keep the copyright and license notice.

Commercial services and extensions around it (hosted operation, setup, additional features) may be offered separately by the maintainer. They are not part of this repository and do not change its license. Contact: open an issue or reach out through the maintainer's GitHub profile.

## License

[MIT](LICENSE) © 2026 Phil Gabriel

The generated file contains [`web-vitals`](https://github.com/GoogleChrome/web-vitals) by Google LLC under the Apache License 2.0. The file carries that notice in its first line. Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Umami and Sentry are trademarks of their respective owners. This project is not affiliated with either.
