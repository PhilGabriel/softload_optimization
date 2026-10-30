# softload_optimization

Core Web Vitals pro Route für Single-Page-Apps, gemeldet an [Umami](https://umami.is).

[English version](README.md)

Ein kleiner Server-Job fragt Umami nach den meistbesuchten Pfaden der letzten 30 Tage. Daraus schreibt er eine statische JavaScript-Datei. Deine Seiten laden sie neben dem Umami-Tracker. Auf diesen Pfaden misst sie LCP, CLS und INP für jede Soft-Navigation, also jeden Routenwechsel im Client. Die Werte gehen als Events zurück an Umami.



## Inhalt

- [Warum](#warum)
- [Funktionsweise](#funktionsweise)
- [Was gemessen wird](#was-gemessen-wird)
- [Wann sinnvoll, wann nicht](#wann-sinnvoll-wann-nicht)
- [Was du erwarten kannst](#was-du-erwarten-kannst)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
- [Konfiguration](#konfiguration)
- [Skript einbinden](#skript-einbinden)
- [Hinter Cloudflare](#hinter-cloudflare)
- [Daten in Umami lesen](#daten-in-umami-lesen)
- [Datenschutz und Sicherheit](#datenschutz-und-sicherheit)
- [Fehlersuche](#fehlersuche)
- [Entwicklung](#entwicklung)
- [Open Core und kommerzielle Nutzung](#open-core-und-kommerzielle-nutzung)
- [Lizenz](#lizenz)

## Warum

Klassische Web Vitals messen die Einstiegsseite. In einer Single-Page-App passiert der Großteil eines Besuchs danach. Nutzer klicken durch Routen, die App tauscht Inhalte aus und lädt kein neues Dokument. Diese Soft-Navigationen blieben bisher ungemessen.

Daraus entstehen zwei Probleme:

1. Seiten, die Nutzer nur per Klick erreichen, bekommen kaum Web-Vitals-Daten. Das gilt für Einstellungen, den zweiten Checkout-Schritt oder Detailseiten, egal wie viel Traffic sie haben.
2. CLS und INP gelten für die gesamte Lebensdauer einer Seite. Ein Layout-Shift auf einer Route, die der Nutzer fünf Minuten später öffnet, belastet die Einstiegsseite.

Chromium 151 meldet Soft-Navigationen direkt aus dem Browser. Die Bibliothek `web-vitals` macht das über die Option `reportSoftNavs` nutzbar. Dieses Projekt verbindet beides mit Umami.

## Funktionsweise

```
 ┌────────────┐  1. Top-Pfade, letzte 30 Tage  ┌─────────────┐
 │   Umami    │ ──────────────────────────────▶│   sync.mjs  │  (Cron, Docker)
 │    API     │                                └──────┬──────┘
 └─────▲──────┘                                       │ 2. schreibt
       │                                              ▼
       │ 4. Event "web-vital"              soft-nav-vitals.js  (statische Datei)
       │                                              │ 3. von deinen Seiten geladen
 ┌─────┴──────┐                                       ▼
 │   Umami    │◀───────────────────────────────  Browser: web-vitals mit
 │  Tracker   │                                  reportSoftNavs, nur Top-Pfade
 └────────────┘
```

1. `sync.mjs` ruft `GET /websites/{id}/metrics?type=path` für die letzten 30 Tage ab. Standard sind die Top 20 Pfade.
2. Der Job schreibt `soft-nav-vitals.js`. Die Datei enthält den Browser-Build von `web-vitals` 6.2.3, die Pfadliste und ein kurzes Verbindungsskript. Er schreibt erst in eine temporäre Datei und benennt sie dann um.
3. Optional leert er den Cloudflare-Cache für diese Datei.
4. Im Browser meldet das Skript die Werte für diese Pfade über `window.umami.track()`.

Der Job läuft einmal und beendet sich. Den Takt bestimmt Cron.

## Was gemessen wird

| Navigationstyp (`navigationType`) | Metriken |
|---|---|
| Page Load (`navigate`, `reload`, `back-forward`, `prerender`, `restore`) | LCP, CLS, INP, FCP, TTFB |
| Soft-Navigation (`soft-navigation`) | LCP, CLS, INP |
| bfcache-Restore (`back-forward-cache`) | LCP, CLS, INP, FCP, TTFB |

- **LCP einer Soft-Navigation** läuft von der auslösenden Interaktion bis zum größten Paint der neuen Route.
- **CLS und INP des Page Loads** enden mit der ersten Soft-Navigation. Alles danach zählt zur Route, auf der es passiert.
- **TTFB und FCP** meldet das Skript für Page Loads und bfcache-Restores, nie für Soft-Navigationen. Eine Soft-Navigation hat keinen Dokument-Request, ihr TTFB läge immer bei 0. Sentry v11 entscheidet genauso.
- **Ein Event pro Metrik.** `web-vitals` meldet CLS und INP bei jedem Ausblenden des Tabs erneut. Umami-Events lassen sich nicht ändern, deshalb sendet das Skript nur die erste Meldung jeder Metrik. Shifts und Interaktionen nach der Rückkehr in den Tab zählen nicht.
- **Den Pfad** liefert `metric.navigationURL`, nicht `location`. Werte wie CLS kommen spät, oft erst nach dem nächsten Routenwechsel.

Der Browser entscheidet, was als Soft-Navigation gilt. Chrome verlangt derzeit drei Dinge: Der Nutzer hat sie ausgelöst, die URL hat sich sichtbar geändert, und etwas Neues wurde gezeichnet. Nicht jeder Routenwechsel erfüllt das. Bei Sentry erfüllten es nach eigener Angabe etwa drei von vier Routenwechseln.

## Wann sinnvoll, wann nicht

**Passt gut:**

- Du betreibst eine Single-Page-App oder einen Hybrid wie Next.js, Nuxt, SvelteKit, React Router, Angular oder Vue Router und nutzt Umami.
- Nutzer klicken pro Besuch durch viele Routen, oder wichtige Seiten sind selten Einstiegsseiten.
- Du willst Zahlen pro Route ohne ein komplettes Tracing- oder RUM-Produkt.
- Du willst das Datenschutzprofil von Umami behalten: keine zusätzlichen Cookies, kein Drittanbieter.

**Passt schlecht:**

- **Klassische Multi-Page-Sites.** Jede Navigation ist ein Page Load. Soft-Navigationen gibt es dort nicht, reines `web-vitals` liefert dieselben Daten.
- **Traffic überwiegend aus Safari oder Firefox.** Nur Chromium ab 151 meldet Soft-Navigationen. Andere Browser liefern weiter Page-Load-Werte.
- **Du willst wissen, warum eine Route langsam ist.** Das Projekt liefert Zahlen, keine Ursachen. Für Traces, Spans und Attribution brauchst du ein Tracing-Tool wie Sentry oder den Attribution-Build von `web-vitals`.
- **Sehr wenig Traffic.** Perzentile über eine Handvoll Events pro Route sagen wenig aus.
- **Knappes Event-Budget.** Ein Page Load erzeugt bis zu fünf Events, jede Soft-Navigation bis zu drei, jeder bfcache-Restore bis zu fünf. Prüfe das Event-Kontingent deines Umami-Tarifs.
- **Viele dynamische Routen** wie `/orders/12345`. Umami zählt jeden konkreten Pfad einzeln, eine einzelne Detailseite schafft es selten in die Top-Liste. Siehe [Grenzen](#grenzen).

**Vorher prüfen:** Neuere Versionen der Umami-API kennen einen Payload-Typ `performance` mit den Feldern `lcp`, `cls`, `inp`, `fcp` und `ttfb`; das zeigt `@umami/api-client` 0.81. Dieses Projekt nutzt ihn nicht. Ob dein Umami-Tracker darüber schon Vitals sammelt und ob er Soft-Navigationen trennt, prüft dieses Projekt nicht. Kläre das, bevor du beides parallel betreibst.

## Was du erwarten kannst

**Nutzen:**

- **Abdeckung:** Routen, die Nutzer per Klick erreichen, bekommen eigene Werte für LCP, CLS und INP.
- **Saubere Page-Load-Werte:** Shifts und langsame Interaktionen auf späteren Routen belasten die Einstiegsseite nicht mehr.
- **Fokus:** Nur die Top-Pfade melden. Das hält Event-Menge und Rauschen klein.
- **Wenig Gewicht:** Die erzeugte Datei hat rund 10 KB, gzip-komprimiert rund 4 KB. Außer den Umami-Events entstehen keine Netzwerkanfragen.

**Nebenwirkungen:**

- **Gesamtwerte verbessern sich, sobald Soft-Navigationen einfließen.** Sie sparen den Dokument-Request und sind meist schneller. Sentry maß für LCP ein p75 von 2,48 s über alle Navigationen und 1,17 s nur für Soft-Navigationen. Die App wurde nicht schneller, nur die Mischung hat sich geändert. Filtere deshalb immer nach `navigationType`.
- **Schwellenwerte:** Die Grenzen für „good“ und „poor“ stammen aus Page-Load-Daten. Für Soft-Navigationen taugen sie zur Orientierung, nicht als Bestehensgrenze.

### Grenzen

- Nur Chromium ab 151 meldet Soft-Navigationen. Die Heuristiken im Browser können sich noch ändern.
- Die Pfadliste ändert sich nur, wenn `sync.mjs` läuft. Neue Seiten melden ab dem nächsten Lauf.
- Das Skript vergleicht Pfade exakt und ignoriert nur den Schrägstrich am Ende. Dynamische Segmente fasst es nicht zusammen.
- CLS und INP zählen bis zum ersten Ausblenden des Tabs. Spätere Änderungen sendet das Skript nicht.
- Fehlt `window.umami` beim Eintreffen einer Metrik, geht dieser Wert verloren. Siehe [Skript einbinden](#skript-einbinden).
- Wie du die Werte aggregieren kannst, hängt von deiner Umami-Version ab. Für Perzentile brauchst du je nach Version eine Datenbankabfrage oder einen Export.

## Voraussetzungen

- Umami, self-hosted oder Umami Cloud, mit API-Zugang
- Node.js 22 oder Docker auf dem Server, der die Datei erzeugt
- Ein Webserver oder CDN, der die Datei unter deiner Domain ausliefert

## Schnellstart

1. Lege eine `.env` aus der Vorlage an:

   ```bash
   cp .env.example .env
   ```

2. Baue das Image:

   ```bash
   docker build -t softload .
   ```

3. Starte es einmal und schreibe in deinen Static-Ordner:

   ```bash
   docker run --rm --user "$(stat -c %u:%g /var/www/static)" --env-file .env -v /var/www/static:/data softload
   ```

4. Binde das Skript in deine Seiten ein, siehe [Skript einbinden](#skript-einbinden).

5. Plane einen täglichen Lauf ein, etwa um 03:15 Uhr für einen Ordner von `www-data` (33:33):

   ```
   15 3 * * * docker run --rm --user 33:33 --env-file /opt/softload/.env -v /var/www/static:/data softload
   ```

Der Container läuft als Nutzer `node` (uid 1000). `--user` übernimmt den Besitzer des Zielordners. Ohne den Parameter scheitert das Schreiben mit `EACCES`.

Ohne Docker, mit Node.js 22:

```bash
npm ci
```

```bash
node --env-file=.env sync.mjs
```

## Konfiguration

Alle Einstellungen sind Umgebungsvariablen.

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `UMAMI_API_URL` | ja | `https://api.umami.is/v1` für Umami Cloud, `https://umami.example.com/api` für self-hosted |
| `UMAMI_WEBSITE_ID` | ja | UUID der Website in Umami |
| `UMAMI_API_KEY` | entweder | API-Key. Geht als `x-umami-api-key` und als Bearer-Token raus. |
| `UMAMI_USERNAME`, `UMAMI_PASSWORD` | oder | Login für self-hosted Umami. Konten mit Zwei-Faktor-Login brauchen einen API-Key. |
| `TOP_N` | nein | Anzahl der Pfade, Standard `20` |
| `OUT_FILE` | nein | Ausgabedatei. Standard `out/soft-nav-vitals.js`, im Container `/data/soft-nav-vitals.js` |
| `CF_ZONE_ID`, `CF_API_TOKEN`, `CF_PURGE_URL` | nein | Cloudflare-Cache leeren, siehe [Hinter Cloudflare](#hinter-cloudflare) |

Exit-Codes: `0` bei Erfolg, `1` bei jedem Fehler. Fehler sind fehlende Variablen, ein gescheiterter Login, API-Fehler oder ein gescheiterter Purge. Bei einem API-Fehler bleibt die alte Datei unverändert.

## Skript einbinden

Lade es auf jeder Seite nach dem Umami-Tracker:

```html
<script defer data-cfasync="false" src="https://umami.example.com/script.js" data-website-id="..."></script>
<script defer data-cfasync="false" src="/static/soft-nav-vitals.js"></script>
```

- Beide Tags brauchen `defer`, der Tracker steht zuerst. Deferred Scripts laufen in Reihenfolge, deshalb existiert `window.umami` beim ersten Messwert.
- Mit `async` oder einem Tag-Manager lädt der Tracker eventuell später. Werte, die vorher eintreffen, gehen verloren. Meist betrifft das FCP.
- `data-cfasync="false"` verhindert, dass der Cloudflare Rocket Loader die Reihenfolge ändert. Ohne Cloudflare hat das Attribut keine Wirkung.

## Hinter Cloudflare

**Cache.** Cloudflare cacht `.js`-Dateien. Nach einem Sync liefert die Edge die alte Datei aus, bis die Cache-Zeit abläuft. Sind alle drei Variablen gesetzt, leert `sync.mjs` nach dem Schreiben genau diese Datei aus dem Cache:

- `CF_ZONE_ID`: Zone-ID aus der Domain-Übersicht im Cloudflare-Dashboard
- `CF_API_TOKEN`: API-Token nur mit der Berechtigung „Zone → Cache Purge → Purge“
- `CF_PURGE_URL`: öffentliche URL der Datei, etwa `https://example.com/static/soft-nav-vitals.js`

Sind nur einige der drei gesetzt, bricht der Job mit Exit-Code 1 ab. So schaltet ein Tippfehler den Purge nicht still ab. Ein gescheiterter Purge endet ebenfalls mit Exit-Code 1. In beiden Fällen ist die neue Datei schon geschrieben.

**Bot-Schutz.** Bot Fight Mode und WAF-Regeln können Anfragen blockieren, die nicht aus einem Browser kommen:

- Rufe die Umami-API über die interne Adresse auf, etwa `UMAMI_API_URL=http://umami:3000/api` im selben Docker-Netz.
- `POST /api/send` des Trackers darf keine Challenge bekommen, sonst gehen Events verloren. Das betrifft alle Umami-Daten, nicht nur dieses Projekt.

**Wirkung auf die Werte.** Cloudflare verändert Page-Load-Metriken wie TTFB, FCP und LCP. Genau das erleben die Nutzer. Soft-Navigationen haben keinen Dokument-Request. Cloudflare wirkt dort nur auf die API-Aufrufe deiner App.

## Daten in Umami lesen

Jeder Wert ist ein Custom Event namens `web-vital` mit diesen Eigenschaften:

| Eigenschaft | Beispiel | Bedeutung |
|---|---|---|
| `metric` | `LCP` | `LCP`, `CLS`, `INP`, `FCP` oder `TTFB` |
| `value` | `812` | Millisekunden. CLS steht mal 1000 im Feld (`17` heißt 0,017), weil Umami ganze Zahlen besser verarbeitet. |
| `rating` | `good` | `good`, `needs-improvement` oder `poor`, berechnet von `web-vitals` |
| `navigationType` | `soft-navigation` | Siehe [Was gemessen wird](#was-gemessen-wird) |

Die Event-URL ist der Pfad der Navigation, zu der die Metrik gehört. In Umami öffnest du Events, wählst `web-vital` und filterst nach `navigationType` und `metric`.

Für stabile Alarme und Auswertungen über Page Loads schließe `soft-navigation` und `back-forward-cache` aus, statt einzelne Werte einzuschließen.

## Datenschutz und Sicherheit

- **Keine neuen Cookies oder Kennungen.** Das Skript sendet vier Eigenschaften pro Metrik über den vorhandenen Umami-Tracker. Für die Verarbeitung gelten die Regeln von Umami.
- **Pfade können personenbezogene Daten enthalten**, wenn deine URLs das tun, etwa `/users/max.mustermann`. Das Skript meldet nur Top-Pfade, prüfe die Liste trotzdem.
- **Die Pfadliste ist öffentlich.** Die erzeugte Datei enthält deine Top-Pfade im Klartext. Jeder kann sehen, welche Seiten beliebt sind. Nimm sensible Pfade in Umami vom Tracking aus oder nutze das Projekt dort nicht.
- **Der API-Key bleibt auf dem Server.** Nur `sync.mjs` nutzt ihn, die erzeugte Datei enthält ihn nie.
- **Nutze einen eigenen Umami-Nutzer oder Key** mit den geringsten Rechten, die deine Umami-Version erlaubt. Der Cloudflare-Token braucht nur Cache Purge.

Sicherheitslücken meldest du wie in [SECURITY.md](SECURITY.md) beschrieben.

## Fehlersuche

| Symptom | Ursache und Lösung |
|---|---|
| `Missing UMAMI_API_URL` | Variable fehlt oder `.env` wurde nicht übergeben. Prüfe `--env-file`. |
| `Umami login failed: 401` | Falsche Zugangsdaten, oder das Konto nutzt Zwei-Faktor-Login. Nimm einen API-Key. |
| `Umami metrics failed: 404` | Falsche `UMAMI_WEBSITE_ID`, oder in `UMAMI_API_URL` fehlt `/api` (self-hosted) bzw. `/v1` (Cloud). |
| `EACCES` beim Schreiben | Der Container-Nutzer darf nicht ins Volume schreiben. Übergib `--user`, siehe [Schnellstart](#schnellstart). |
| `403` von der Umami-API hinter Cloudflare | Bot-Schutz. Nutze die interne Umami-Adresse. |
| Datei aktualisiert, Browser bekommt die alte | CDN- oder Browser-Cache. Setze die Cloudflare-Variablen oder senke die Cache-Zeit für diese Datei. |
| Keine `soft-navigation`-Events | Browser ist nicht Chromium 151+, die Route fehlt in der Top-Liste, oder die Navigation erfüllt die Browser-Regeln nicht (keine Interaktion, kein sichtbarer Paint). |
| Gar keine Events | `window.umami` fehlt (Ladereihenfolge, Adblocker), oder der aktuelle Pfad steht nicht in der Liste. Öffne die erzeugte Datei und prüfe die Pfadliste. |

## Entwicklung

```bash
npm ci
```

```bash
npm test
```

Die Tests nutzen den eingebauten Test-Runner von Node. Sie starten einen simulierten Umami-Server, prüfen Abfrage und geschriebene Datei, führen das Browser-Skript in einer Sandbox aus und simulieren die Cloudflare-API. Sie brauchen keinen Netzzugang.

Aufbau:

| Datei | Zweck |
|---|---|
| `sync.mjs` | Der ganze Job: Umami-Abfrage, Datei erzeugen, Cloudflare-Purge |
| `sync.test.mjs` | Tests |
| `Dockerfile` | Laufzeit-Image (Node.js 22 Alpine) |
| `.env.example` | Vorlage für die Konfiguration |

Wie du beitragen kannst, steht in [CONTRIBUTING.md](CONTRIBUTING.md). Änderungen stehen in [CHANGELOG.md](CHANGELOG.md).

## Open Core und kommerzielle Nutzung

Dieses Repository ist der offene Kern. Es steht unter MIT und bleibt frei. Du darfst es nutzen, ändern, hosten und verkaufen, auch in kommerziellen Produkten. Bedingung ist, dass Copyright- und Lizenzhinweis erhalten bleiben.

Der Maintainer kann kommerzielle Leistungen und Erweiterungen getrennt anbieten, etwa Hosting, Einrichtung oder Zusatzfunktionen. Sie gehören nicht zu diesem Repository und ändern seine Lizenz nicht. Kontakt: Eröffne ein Issue oder schreib über das GitHub-Profil des Maintainers.

## Lizenz

[MIT](LICENSE) © 2026 Phil Gabriel

Die erzeugte Datei enthält [`web-vitals`](https://github.com/GoogleChrome/web-vitals) von Google LLC unter der Apache License 2.0. Den Hinweis trägt die Datei in ihrer ersten Zeile. Details stehen in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Umami und Sentry sind Marken ihrer jeweiligen Inhaber. Dieses Projekt gehört zu keinem von beiden.
