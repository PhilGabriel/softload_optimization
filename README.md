# softload_optimization

Misst Web Vitals für Soft-Navigationen auf den meistbesuchten Seiten einer Umami-Website.

`sync.mjs` holt per Umami-API die Top-Pfade der letzten 30 Tage (`GET /websites/{id}/metrics?type=path`). Danach schreibt es eine Datei `soft-nav-vitals.js`. Sie enthält `web-vitals@6.2.3` und meldet für diese Pfade:

| Navigationstyp | Metriken |
|---|---|
| Page Load (`navigate`, `reload`, `back-forward`, ...) | LCP, CLS, INP, FCP, TTFB |
| Soft-Navigation (`soft-navigation`) | LCP, CLS, INP |
| bfcache-Restore (`back-forward-cache`) | LCP, CLS, INP, FCP, TTFB |

Die Werte landen als Umami-Event `web-vital` mit den Feldern `metric`, `value`, `rating` und `navigationType`. Als URL dient der Pfad der Navigation, zu der die Metrik gehört (`metric.navigationURL`). CLS steht mal 1000 im Feld `value`, weil Umami ganze Zahlen besser aggregiert. In Umami filterst du unter Events → `web-vital` nach `navigationType`.

Die Page-Load-Vitals enden mit der ersten Soft-Navigation. Spätere Layout-Shifts und Interaktionen zählen zur jeweiligen Route.

Soft-Navigationen meldet nur Chromium ab Version 151. Andere Browser liefern weiter Page-Load-Vitals.

## Konfiguration

| Variable | Pflicht | Beispiel |
|---|---|---|
| `UMAMI_API_URL` | ja | `https://api.umami.is/v1` (Cloud) oder `https://umami.example.com/api` (self-hosted) |
| `UMAMI_WEBSITE_ID` | ja | UUID der Website |
| `UMAMI_API_KEY` | entweder | API-Key |
| `UMAMI_USERNAME`, `UMAMI_PASSWORD` | oder | Login für self-hosted ohne Zwei-Faktor |
| `TOP_N` | nein | `20` (Standard) |
| `OUT_FILE` | nein | Standard: `out/soft-nav-vitals.js`, im Container `/data/soft-nav-vitals.js` |

## Ausführen

Mit Docker, Ausgabe nach `/var/www/static`:

```bash
docker build -t softload .
```

```bash
docker run --rm --user "$(stat -c %u:%g /var/www/static)" --env-file .env -v /var/www/static:/data softload
```

Ohne Docker (Node 22):

```bash
npm ci && UMAMI_API_URL=... UMAMI_WEBSITE_ID=... UMAMI_API_KEY=... npm run sync
```

Der Container läuft als Nutzer `node` (uid 1000). `--user` übernimmt den Besitzer des Zielordners, sonst scheitert das Schreiben mit EACCES. Der Container läuft einmal und beendet sich. Für tägliche Aktualisierung ein Cron-Eintrag, hier für einen Ordner von `www-data` (33:33):

```
15 3 * * * docker run --rm --user 33:33 --env-file /opt/softload/.env -v /var/www/static:/data softload
```

## Einbinden

Nach dem Umami-Tracker auf jeder Seite. Beide Skripte brauchen `defer`, der Tracker steht zuerst. Mit `async` oder Tag-Manager kann `window.umami` beim ersten FCP-Wert noch fehlen, dann geht dieser Wert verloren.

```html
<script defer src="https://umami.example.com/script.js" data-website-id="..."></script>
<script defer src="/static/soft-nav-vitals.js"></script>
```

## Tests

```bash
npm test
```
