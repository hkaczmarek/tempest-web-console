# Tempest Web Console

A browser replica of the [WeatherFlow PiConsole](https://github.com/peted-davis/WeatherFlow_PiConsole)
screen, driven by Home Assistant. Six panels, live dials, and the half-size
decimal treatment — in any browser, on any device, with no Raspberry Pi
required.

![The console](docs/screenshot.png)

No build step, no framework, no dependencies. Four static files and a config
you fill in.

---

## Contents

- [What this is](#what-this-is)
- [Quick start](#quick-start)
- [Connecting it to Home Assistant](#connecting-it-to-home-assistant)
- [Security](#security)
- [The panels](#the-panels)
- [Values the console derives itself](#values-the-console-derives-itself)
- [Running it on a wall tablet](#running-it-on-a-wall-tablet)
- [Customising](#customising)
- [Using a different data source](#using-a-different-data-source)
- [Known gaps](#known-gaps)
- [Credits](#credits)

---

## What this is

The WeatherFlow PiConsole is an excellent piece of software, but it is a Kivy
application: it runs on one machine, on one screen, and you have to be in front
of that screen to read it. This project reproduces the same layout as a web
page, so the console is available on a phone, a wall tablet, a desktop browser,
or a Home Assistant dashboard tab.

It is **not** a port of the PiConsole. It shares the layout, the panel colours,
and the number formatting; it reads its data from Home Assistant rather than
from the Tempest's UDP broadcasts, and it computes several figures the
PiConsole gets from WeatherFlow's API.

Panels:

| | | |
|---|---|---|
| **Forecast** | **Temperature** | **Wind Speed** |
| **Solar / UV** | **Rainfall** | **Barometer** |

Plus **Sager**, **Moon** and **Lightning**, which swap into the Forecast slot
from the buttons at the bottom left — the same behaviour the PiConsole has.

![The Moon panel](docs/screenshot-moon.png)

---

## Quick start

Clone it and open `index.html`. That's the whole first step.

```bash
git clone https://github.com/hkaczmarek/tempest-web-console.git
cd tempest-web-console
```

Opened straight from the filesystem it shows a fixed demo snapshot, so you can
see the layout before wiring anything up. The clock is live; everything else is
frozen.

To serve it locally instead:

```bash
python3 -m http.server 8777
# then http://localhost:8777
```

---

## Connecting it to Home Assistant

```bash
cp config.example.js config.js
```

Then edit `config.js`. There are three things to set: where Home Assistant is,
a token, and the entity map.

### 1. Where to put the files

**Recommended — serve it from Home Assistant itself.** Copy the repo into
`/config/www/tempest-console/` and it is served at:

```
http://homeassistant.local:8123/local/tempest-console/index.html
```

Leave `baseUrl: ""` in that case. Requests are then same-origin, which means
nothing to configure for CORS and no mixed-content warnings over HTTPS.

**Anywhere else** — a NAS, a Pi, GitHub Pages, a folder on your desktop — set
`baseUrl` to your Home Assistant URL:

```js
baseUrl: "http://192.168.1.50:8123",
```

and tell Home Assistant to accept requests from wherever the page is served, in
`configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - http://192.168.1.99:8777
```

Restart Home Assistant after that. Without it the browser blocks every request
and the console shows a CORS error in the footer.

### 2. A long-lived access token

In Home Assistant: click your user name in the sidebar → **Security** tab →
scroll to **Long-lived access tokens** → **Create token**. Copy it into
`config.js`.

Read [Security](#security) before you do. A token is a password.

### 3. The entity map

`config.example.js` ships with the entity IDs from the
[WeatherFlow Forecast](https://github.com/briis/weatherflow_forecast) (`ws_core`)
integration, for a station named "Wren Dr". Yours will be named after your own
station.

Find them in **Developer Tools → States**, filtering on your station's name.

```js
entities: {
  temperature: "sensor.your_station_temperature",
  ...
}
```

Any entity can be set to `null`. Its figure shows an en dash rather than
breaking the panel, so you can bring the console up with a partial map and fill
in the rest later.

#### Which integration?

Home Assistant has two WeatherFlow integrations and they expose different
things:

| | Core `weatherflow` | `weatherflow_forecast` (ws_core) |
|---|---|---|
| Live observations | yes (UDP, local) | yes (cloud API) |
| Sea-level pressure | **no** — station pressure only | yes |
| Precipitation today / yesterday | no | yes |
| Lightning count last 1 hr / 3 hr | no | yes |
| Forecast entity | no | yes |

The console wants the second one for the barometer, rainfall and forecast
panels. If you run both, mix freely — `precipitationRate` in the shipped
example comes from the core integration because it updates faster.

> **The barometer needs sea-level pressure, not station pressure.** The Tempest
> reports raw barometric pressure, which at any elevation reads low — about
> 1.7 inHg low at 1,600 feet. Point `pressureSeaLevel` at station pressure and
> the needle sits pinned at "Stormy" permanently.

---

## Security

`config.js` contains a long-lived token, which grants **full access** to your
Home Assistant — every entity, every service, every light and lock. Anyone who
can read that file can control your house.

Consequences worth being deliberate about:

- **`config.js` is gitignored.** Do not remove that line, and do not commit the
  file. If you ever do, revoke the token in Home Assistant immediately;
  rewriting git history is not enough, because the commit may already have been
  fetched.
- **Anything served from `/config/www/` is public to anyone who can reach your
  Home Assistant, without logging in.** That is how the `/local/` path works.
  So putting `config.js` there exposes the token to your whole LAN, and to the
  internet if Home Assistant is exposed. That is usually acceptable on a trusted
  home network and unacceptable otherwise.
- **Do not put this on the public internet as-is.** If you want the console
  reachable from outside, put it behind the same authentication as Home
  Assistant itself, or behind a reverse proxy that requires a login.
- **Create a dedicated user** for the console rather than using your own
  account's token. Home Assistant tokens cannot be scoped to read-only, but a
  separate user at least lets you revoke this one without signing yourself out
  everywhere.

The console only ever issues `GET /api/states`, `GET /api/history/period` and
one `POST` to `weather.get_forecasts`. It never writes. But the token it
carries is not similarly limited, and that is what matters.

---

## The panels

| Panel | Shows | Source |
|---|---|---|
| **Forecast** | Condition, forecast wind, today's high/low, chance of rain | `weather.*` entity, plus a `weather.get_forecasts` call |
| **Temperature** | Outdoor, 24 hr difference, hourly trend, today's min/max with timestamps, feels-like, humidity, dew point | Live sensors; min/max/trend derived from history |
| **Wind Speed** | Compass with the 30° sector the wind is from, current, gust, average, today's max gust, Beaufort | Live sensors; max gust from history; Beaufort computed |
| **Solar / UV** | Irradiance, UV index with band, sunrise/sunset arc, daylight remaining, peak sun hours | Live sensors, `sun.sun`, peak sun hours integrated from history |
| **Rainfall** | Today, yesterday, month, year, rate with an intensity scale | Live sensors |
| **Barometer** | Sea-level pressure on a banded aneroid face, today's low/high, 3-hour trend | Live sensor; extremes and trend from history |
| **Sager** | Outlook, expected change, wind direction and force, temperature trend, the underlying sentence | [`zambretti_sager`](https://github.com/ziffmafiya/zambretti_sager) custom integration |
| **Moon** | Phase name, illumination, drawn disc, next full moon | Computed from the date — no integration needed |
| **Lightning** | Last strike distance and time, counts for the last hour / today / yesterday | Live sensors |

---

## Values the console derives itself

Several figures on the PiConsole come from WeatherFlow's API, which Home
Assistant does not expose. Rather than asking you to build a template sensor
for each, the console fetches **one** 24-hour history window at startup and on
every refresh, then computes:

| Figure | How |
|---|---|
| Today's min/max temperature and pressure | Extremes since local midnight, with the timestamp of each |
| 24 hour difference | Current reading minus the nearest sample to 24 hours ago |
| Hourly trend | Current reading minus the nearest sample to one hour ago |
| Today's max gust | Maximum of the gust series since midnight |
| Peak sun hours | Trapezoidal integration of irradiance since midnight, in kWh/m² |
| Pressure trend and verdict | Rate of change over the last three hours |
| Wind dial scale | Rounded up from today's max gust, so the bars stay readable in both a calm week and a windy one |
| Moon phase | Synodic month from a known new moon — no moon integration required |

That is a single `/api/history/period` call covering four entities, which is
cheaper than four template sensors recomputing on every state change.

Home Assistant's recorder must be keeping those entities for this to work. If
you have `exclude`d them, the affected figures show an en dash and everything
else carries on.

---

## Running it on a wall tablet

The layout collapses to two columns below 1000px and one column below 640px, so
it works on a phone as-is.

For a dedicated tablet:

- **Fully Kiosk Browser** (Android) — set the start URL, enable "Keep screen
  on" and "Fullscreen", and set "Auto-reload on idle" to 0 since the page
  refreshes itself.
- **iPad** — open in Safari, Share → Add to Home Screen. It launches without
  browser chrome.
- **Raspberry Pi** — `chromium-browser --kiosk --incognito <url>` from an
  autostart entry.

The console repaints when the tab becomes visible again, so a tablet that
sleeps its network wakes up showing current numbers rather than stale ones.

---

## Customising

### Colours

Every colour is a custom property at the top of `assets/console.css`:

```css
--warm:   #f0a050;   /* Temperature panel */
--green:  #9ccc65;   /* Wind panel */
--cool:   #4fc3d7;   /* Rainfall panel */
--violet: #b39ddb;   /* Barometer panel */
--sky:    #8ab4f8;   /* Forecast panel */
--gold:   #ffca28;   /* Solar panel */
```

The panel accents map to those in the `.p-*` rules just below.

### Size

One variable drives the whole type scale:

```css
--u: clamp(12px, 1.22vw, 21px);
```

Raise the middle term for a bigger console on a given screen, or the last for a
higher ceiling on a large display.

### The decimal treatment

The half-size tenth and the small raised unit are the `.read` rules:

```css
.read .whole { font-size: var(--size); }
.read .tenth { font-size: calc(var(--size) * 0.55); }
.read .unit  { font-size: calc(var(--size) * 0.34); vertical-align: super; }
```

`reading()` in `assets/console.js` rounds **once** and derives both parts from
that single rounded value, so the whole and the tenth can never disagree — 89.96
renders as `90.0`, never as `89` with a stray `.10` beside it.

### The dials

`.dial` caps the SVG at 360px wide. They are drawn from panel width, so without
that cap they set the height of their whole grid row and every panel beside them
stretches to match. Raise it for bigger dials and more whitespace elsewhere.

---

## Using a different data source

A source is an async function returning one fixed object shape, documented at
the top of `assets/sources.js`. Two ship with the project:

```js
Sources.demo()                 // a fixed snapshot
Sources.homeAssistant(config)  // reads a live instance
```

To drive the console from something else — a Tempest UDP listener, Weather
Underground, a flat JSON file on a NAS — write a third function returning the
same shape and point `assets/main.js` at it. Nothing in `console.js` knows or
cares where the numbers came from.

Any numeric field may be `null`; the renderer draws an en dash.

---

## Known gaps

- **Moonrise and moonset show a dash.** Phase and illumination are computed from
  the date, which needs nothing; rise and set times need the observer's latitude
  and longitude and a proper ephemeris. If you have a moon integration, map
  those two fields to it.
- **Month and year rainfall totals** are not produced by either WeatherFlow
  integration. Point `precipitationMonth` and `precipitationYear` at
  `utility_meter` helpers if you keep them; otherwise both show a dash.
- **Sunrise and sunset may be a minute or two out.** When the sun is above the
  horizon, today's sunrise has already passed, so the console takes `sun.sun`'s
  `next_rising` and subtracts a day. The difference from the true time is
  under two minutes and invisible at the displayed precision.
- **The forecast panel needs `weather.get_forecasts`**, which requires Home
  Assistant 2023.9 or newer. On older versions the panel degrades to dashes and
  the rest of the console is unaffected.
- **No unit switching.** Everything is imperial, matching the PiConsole's US
  configuration. The conversions are not in the code at all, so metric would be
  real work rather than a flag.

---

## Credits

- [WeatherFlow PiConsole](https://github.com/peted-davis/WeatherFlow_PiConsole)
  by Peter Davis — the original, and the design this follows.
- [weatherflow_forecast](https://github.com/briis/weatherflow_forecast) by Bjarne
  Riis — the Home Assistant integration most of the data comes from.
- [zambretti_sager](https://github.com/ziffmafiya/zambretti_sager) — the Sager
  and Zambretti forecasts.
- [Inter](https://rsms.me/inter/) by Rasmus Andersson.

## Licence

MIT. See [LICENSE](LICENSE).
