/* ------------------------------------------------------------------ *
 * Tempest Web Console - data sources
 *
 * A source is an async function returning the object the renderer draws.
 * Two ship here: `demo`, which returns a fixed snapshot, and
 * `homeAssistant`, which reads a live instance over its REST API.
 *
 * To drive the console from something else - a Tempest UDP bridge, a
 * Weather Underground feed, a flat JSON file - write a third function
 * that returns the same shape and point main.js at it. Nothing in
 * console.js needs to change.
 * ------------------------------------------------------------------ */

"use strict";

/* ── The shape every source returns ─────────────────────────────────
 *
 * forecast  wind text temp low high pop daily issued
 * outdoor   temp diff trend min minAt max maxAt feels feelsText
 *           humidity dew
 * wind      avg max now gust scale bearing cardinal cardinalLong
 *           beaufort
 * solar     radiation uv uvBand rise set progress remainH remainM
 *           till peakSun band
 * rain      today yesterday month year rate state
 * barometer slp low lowAt high highAt trend rate verdict
 * sager     weather when dir force temp text dial src at
 * moon      phase illum fraction rise set full
 * lightning dist when hour today yesterday
 *
 * Any numeric field may be null; the renderer draws an en dash.
 * ------------------------------------------------------------------ */

const Sources = (() => {

  // ── Shared helpers ────────────────────────────────────────────────

  /* The PiConsole spells out the leading point and abbreviates the rest:
     WSW reads "West SW", not "West South West". */
  const CARDINALS = ["North", "North NE", "North East", "East NE",
                     "East", "East SE", "South East", "South SE",
                     "South", "South SW", "South West", "West SW",
                     "West", "West NW", "North West", "North NW"];
  const SHORT = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function compass(deg) {
    const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
    return { short: SHORT[i], long: CARDINALS[i] };
  }

  // Beaufort, in mph, as the PiConsole labels it.
  function beaufort(mph) {
    const steps = [[1, "Calm"], [4, "Light Air"], [8, "Light Breeze"],
                   [13, "Gentle Breeze"], [19, "Moderate Breeze"],
                   [25, "Fresh Breeze"], [32, "Strong Breeze"],
                   [39, "Near Gale"], [47, "Gale"], [55, "Severe Gale"],
                   [64, "Storm"], [73, "Violent Storm"]];
    for (const [limit, name] of steps) if (mph < limit) return name;
    return "Hurricane Force";
  }

  function uvBand(uv) {
    if (uv < 3)  return "Low";
    if (uv < 6)  return "Moderate";
    if (uv < 8)  return "High";
    if (uv < 11) return "Very High";
    return "Extreme";
  }

  function solarBand(wm2) {
    if (wm2 < 100) return "Very Low";
    if (wm2 < 300) return "Low";
    if (wm2 < 600) return "Moderate";
    if (wm2 < 900) return "High";
    return "Very High";
  }

  /* Dew point by the Magnus formula, and feels-like by the NWS heat index
     above 80F or wind chill below 50F. Both are computed rather than read
     from better_forecast, which rounds to whole degrees and would peg the
     console's tenth digit at zero. */
  function dewPointF(tempF, rh) {
    if (tempF === null || rh === null || !(rh > 0)) return null;
    const t = (tempF - 32) * 5 / 9, a = 17.625, b = 243.04;
    const g = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * g) / (a - g) * 9 / 5 + 32;
  }

  function heatIndexF(T, RH) {
    let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + RH * 0.094);
    if ((hi + T) / 2 < 80) return hi;
    hi = -42.379 + 2.04901523 * T + 10.14333127 * RH
       - 0.22475541 * T * RH - 0.00683783 * T * T - 0.05481717 * RH * RH
       + 0.00122874 * T * T * RH + 0.00085282 * T * RH * RH
       - 0.00000199 * T * T * RH * RH;
    if (RH < 13 && T >= 80 && T <= 112) {
      hi -= (13 - RH) / 4 * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (RH > 85 && T >= 80 && T <= 87) {
      hi += (RH - 85) / 10 * ((87 - T) / 5);
    }
    return hi;
  }

  /* The Rothfusz regression is only valid in warm, HUMID air. In dry heat
     it drifts below the air temperature - 92.5 F at 27% returns 90.2 - which
     is not what "feels like" means. The NWS uses the air temperature
     whenever the index falls beneath it, and so does the station itself.
     Wind chill is clamped the same way at the other end. */
  function apparentF(tempF, rh, windMph) {
    if (tempF === null) return null;
    if (tempF >= 80 && rh !== null) {
      return Math.max(tempF, heatIndexF(tempF, rh));
    }
    if (tempF <= 50 && windMph > 3) {
      const v = Math.pow(windMph, 0.16);
      const chill = 35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v;
      return Math.min(tempF, chill);
    }
    return tempF;
  }

  /* Every source names conditions differently - WeatherFlow says
     "partly-cloudy-night", Home Assistant says "partlycloudy" - so both map
     onto one small vocabulary the renderer understands:
     clear partly cloudy rain storm snow fog wind */
  function iconToken(name) {
    const n = String(name || "").toLowerCase();
    if (/thunder|lightning/.test(n))       return "storm";
    if (/snow|sleet|hail|flurr/.test(n))   return "snow";
    if (/rain|pour|drizzl|shower/.test(n)) return "rain";
    if (/fog|mist|haz/.test(n))            return "fog";
    if (/wind/.test(n))                    return "wind";
    if (/partly|mostly|few|scattered/.test(n)) return "partly";
    if (/cloud|overcast/.test(n))          return "cloudy";
    if (/clear|sunny|fair/.test(n))        return "clear";
    return "partly";
  }

  function feelsText(f) {
    if (f === null) return "";
    if (f < 32) return "Feeling freezing";
    if (f < 45) return "Feeling cold";
    if (f < 60) return "Feeling cool";
    if (f < 75) return "Feeling mild";
    if (f < 85) return "Feeling warm";
    if (f < 95) return "Feeling hot";
    return "Feeling very hot";
  }

  const clock = (d) => d.toLocaleTimeString("en-US",
    { hour: "numeric", minute: "2-digit", hour12: true });

  /* "4 PM" - the hourly strip has five columns to fit, so the minutes
     (always :00) are dead weight. */
  const hourLabel = (d) => d.toLocaleTimeString("en-US",
    { hour: "numeric", hour12: true });

  /* "Sun 4". Today and tomorrow are named rather than dated, because that
     is how you read them. */
  const dayLabel = (d, now) => {
    const midnightOf = (x) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((midnightOf(d) - midnightOf(now)) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    /* Built by hand: Intl renders {weekday, day} as "5 Mon" in en-US, which
       reads as a time before it reads as a date. */
    return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.getDate();
  };

  /* Conditions text is the one field with no length bound, and it shares a
     row with the icon and the temperatures. The icon already says what the
     weather is, so the text only has to disambiguate. */
  const shortCond = (t) => String(t || "")
    .replace(/_/g, " ")
    .replace(/\bPossible\b/i, "")
    .replace(/\bThunderstorms?\b/i, "Storms")
    .replace(/\bPrecipitation\b/i, "Rain")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

  /* Moon phase from the date alone, so the console needs no moon
     integration. Conway's approximation of the synodic month, good to
     well under a day - plenty for a phase name and a drawn disc. */
  function moon(now = new Date()) {
    const SYNODIC = 29.530588853;
    const known = Date.UTC(2000, 0, 6, 18, 14);        // a known new moon
    const days  = (now.getTime() - known) / 86400000;
    const k = ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;  // 0..1
    const illum = Math.round((1 - Math.cos(k * 2 * Math.PI)) / 2 * 100);

    let phase;
    if      (k < 0.02 || k > 0.98) phase = "New Moon";
    else if (k < 0.23)             phase = "Waxing Crescent";
    else if (k < 0.27)             phase = "First Quarter";
    else if (k < 0.48)             phase = "Waxing Gibbous";
    else if (k < 0.52)             phase = "Full Moon";
    else if (k < 0.73)             phase = "Waning Gibbous";
    else if (k < 0.77)             phase = "Last Quarter";
    else                           phase = "Waning Crescent";

    const toFull = ((0.5 - k + 1) % 1) * SYNODIC;
    const full = new Date(now.getTime() + toFull * 86400000);

    return {
      phase, illum, fraction: k,
      rise: "—", set: "—",
      full: full.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    };
  }

  // ── Demo source ───────────────────────────────────────────────────
  // A real snapshot, so the page shows something sensible before it is
  // pointed at anything.

  async function demo() {
    return {
      forecast:  { wind: "11 mph S", text: "Partly cloudy until 3 PM today",
                   temp: 90, low: 61, high: 91, pop: 0, daily: "0%",
                   icon: "partly", night: false, issued: "1 PM",
                   hours: [
                     { label: "1 PM", temp: 90, icon: "partly", night: false, wind: 11 },
                     { label: "2 PM", temp: 91, icon: "partly", night: false, wind: 10 },
                     { label: "3 PM", temp: 91, icon: "clear",  night: false, wind: 8 },
                     { label: "4 PM", temp: 89, icon: "clear",  night: false, wind: 7 },
                     { label: "5 PM", temp: 86, icon: "clear",  night: false, wind: 6 }
                   ],
                   days: [
                     { label: "Tomorrow", cond: "Clear",  icon: "clear",  lo: 62, hi: 93, pop: 0 },
                     { label: "Mon 5",    cond: "Partly cloudy", icon: "partly", lo: 64, hi: 88, pop: 10 },
                     { label: "Tue 6",    cond: "Storms", icon: "storm",  lo: 59, hi: 75, pop: 40 }
                   ] },
      outdoor:   { temp: 89.9, diff: -2.8, trend: 3.6,
                   min: 60.7, minAt: "7:02 AM", max: 91.4, maxAt: "11:32 AM",
                   feels: 89.9, feelsText: "Feeling hot", humidity: 32, dew: 56.4 },
      wind:      { avg: 0.5, max: 11, now: 2.1, gust: 4.5, scale: 15,
                   bearing: 232, cardinal: "SW", cardinalLong: "South West",
                   beaufort: "Light Air" },
      solar:     { radiation: 888, uv: 7.7, uvBand: "High",
                   rise: "6:44 AM", set: "6:44 PM", progress: 0.49,
                   remainH: "6", remainM: "04", till: "Sunset",
                   peakSun: 2.7, band: "Moderate" },
      rain:      { today: 0, yesterday: 0, month: 0.02, year: 0.02,
                   rate: 0, state: "Currently Dry" },
      barometer: { slp: 29.95, low: 29.95, lowAt: "5:08 AM",
                   high: 29.98, highAt: "9:12 AM",
                   trend: "Steady", rate: -0.009, verdict: "Conditions unchanged" },
      sager:     { weather: "Fair", when: "no marked change", dir: "SW",
                   force: "Moderate", temp: "Steady",
                   text: "Fair weather, becoming partly cloudy. Moderate winds " +
                         "from the south-west, veering. No marked change in " +
                         "temperature over the next twelve hours.",
                   dial: "B, 3, 1, 2, 2, 4", src: "KWHP", at: "11:53 AM" },
      moon:      moon(),
      lightning: { dist: null, when: "No strikes detected",
                   hour: 0, today: 0, yesterday: 0 }
    };
  }

  // ── WeatherFlow Tempest source ────────────────────────────────────
  //
  // Reads the station straight from WeatherFlow's cloud API. Two calls
  // cover almost the whole console:
  //
  //   better_forecast        current conditions, the ten day forecast,
  //                          sunrise and sunset
  //   observations/stn/{id}  precipitation totals, lightning counts,
  //                          solar radiation
  //
  // A third, optional call to the device endpoint supplies today's
  // observed extremes. It needs a device id and is skipped without one.
  //
  // The token is a personal access token from the Tempest web app. It is
  // read-only and scoped to your own stations, which makes this source a
  // great deal safer to deploy than a Home Assistant token.

  const TEMPEST = "https://swd.weatherflow.com/swd/rest";
  /* Pressure is requested in MILLIBARS, not inHg, and converted here.
     Asking for inHg gets one decimal place back - 29.9, where the station
     actually reads 29.93 - which is useless on a dial calibrated in
     hundredths. The millibar form carries the precision (1013.3). */
  const UNITS = "units_temp=f&units_wind=mph&units_pressure=mb" +
                "&units_precip=in&units_distance=mi";

  async function tget(path) {
    const res = await fetch(TEMPEST + path);
    if (!res.ok) throw new Error("Tempest API " + res.status + " on " + path.split("?")[0]);
    return res.json();
  }

  /* Raw device observations, so the console can show today's observed
     high and low rather than the forecast's. The obs_st row is a fixed
     array of metric values; only four of its slots are wanted here.

     0 epoch   2 wind avg   3 wind gust   6 station pressure
     7 air temp   11 solar radiation

     These are raw device values and always metric - m/s, mb, C - whatever
     units the request asks for, so they are converted here. */
  const MS_TO_MPH = 2.236936;
  const MB_TO_INHG = 0.0295299831;
  const inHg = (mb) => (mb === null || mb === undefined) ? null : mb * MB_TO_INHG;

  /* Sea level pressure, computed rather than read.

     The API's own sea_level_pressure field disagrees with both the Tempest
     app and the PiConsole by about 0.02 inHg, because they reduce station
     pressure using the station's elevation PLUS the height of the device
     above ground, and the API's figure does not. Working the formula
     backwards from the app's own numbers - 28.207 inHg station, 29.938 sea
     level - gives about 499.5 m, against 497.65 m registered elevation: the
     difference is the sensor height. Both are read from /stations rather
     than assumed.

     This is the barometric formula the PiConsole uses
     (lib/derived_variables.py, SLP()), so all three now agree. */
  function seaLevelMb(stationMb, elevationM) {
    if (stationMb === null || stationMb === undefined) return null;
    const P0 = 1013.25, Rd = 287.05, gamma = 0.0065, g = 9.80665, T0 = 288.15;
    const a = (Rd * gamma) / g;
    return stationMb *
      Math.pow(1 + Math.pow(P0 / stationMb, a) * ((gamma * elevationM) / T0), 1 / a);
  }

  /* Station elevation and sensor height, read once and kept. */
  let stationMeta = { id: null, elevation: null };
  async function tempestElevation(stationId, token) {
    if (stationMeta.id === stationId) return stationMeta.elevation;
    try {
      const r = await tget("/stations?token=" + encodeURIComponent(token));
      const st = (r.stations || []).find((x) => x.station_id === Number(stationId));
      const base = st && st.station_meta && st.station_meta.elevation;
      const dev = st && (st.devices || []).find((d) => d.device_type === "ST");
      const agl = dev && dev.device_meta && dev.device_meta.agl;
      if (Number.isFinite(base)) {
        stationMeta = { id: stationId,
                        elevation: base + (Number.isFinite(agl) ? agl : 0) };
      }
    } catch (e) { /* fall back to the API's own sea_level_pressure */ }
    return stationMeta.elevation;
  }

  /* NOT day_offset. That parameter is widely cited but the endpoint ignores
     it and returns only its default recent window - measured at 111 rows
     covering the last two hours, against 1131 rows for a full day. Every
     figure derived from it was therefore computed over the wrong span.
     time_start and time_end are the documented way to ask for a range. */
  async function tempestDeviceRange(deviceId, token, startSec, endSec) {
    const rows = await tget("/observations/device/" + deviceId +
                            "?bucket=a" +
                            "&time_start=" + Math.floor(startSec) +
                            "&time_end=" + Math.floor(endSec) +
                            "&token=" + encodeURIComponent(token));
    const obs = (rows && rows.obs) || [];
    return obs
      .filter((r) => Array.isArray(r) && r.length > 11)
      .map((r) => ({
        t: new Date(r[0] * 1000),
        tempF: r[7] === null ? null : r[7] * 9 / 5 + 32,
        windMph: r[2] === null ? null : r[2] * MS_TO_MPH,
        gustMph: r[3] === null ? null : r[3] * MS_TO_MPH,
        pressMb: r[6],
        solar: r[11]
      }));
  }

  function zipObs(resp) {
    const fields = resp && resp.ob_fields;
    const row = resp && resp.obs && resp.obs[0];
    if (!Array.isArray(fields) || !Array.isArray(row)) return {};
    const out = {};
    fields.forEach((name, i) => { out[name] = row[i]; });
    return out;
  }

  /* Asking for raw observations over a long range gets silently truncated to
     the most recent slice - fine at 6 PM, quietly missing the morning by 9 PM,
     with no error and nothing in the response to say so. bucket=a asks for an
     aggregated series instead and returns the whole span. This is what the
     PiConsole itself does (lib/request_api/weatherflow_api.py, today()), and
     the column layout is unchanged.

     The caching below is the rest of that design: establish the day once,
     then keep it current from live readings, rather than re-deriving it from
     scratch on every refresh. */
  const DAY_CACHE_MS = 10 * 60 * 1000;
  let dayCache = { at: 0, day: 0, rows: [] };

  async function tempest(cfg) {
    const t = cfg.tempest || {};
    if (!t.stationId || !t.token) {
      throw new Error("Set tempest.stationId and tempest.token in config.js");
    }
    const tok = encodeURIComponent(t.token);
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);

    const elevM = await tempestElevation(t.stationId, t.token);

    const [fc, obsResp, stats] = await Promise.all([
      tget("/better_forecast?station_id=" + t.stationId + "&token=" + tok + "&" + UNITS),
      tget("/observations/stn/" + t.stationId + "?token=" + tok + "&" + UNITS)
        .catch(() => null),
      tget("/stats/station/" + t.stationId + "?token=" + tok).catch(() => null)
    ]);

    const cc  = (fc && fc.current_conditions) || {};
    const day = (fc && fc.forecast && fc.forecast.daily && fc.forecast.daily[0]) || {};
    /* Two observation endpoints exist and they are NOT interchangeable.
       /observations/station/ returns named fields but ignores the unit
       parameters, handing back Celsius and millibars whatever you ask for.
       /observations/stn/ honours them, but returns a positional array plus
       an ob_fields list naming the columns - so zip the two rather than
       indexing, which also survives WeatherFlow reordering them.

       This endpoint is the primary because better_forecast rounds:
       91.8 degrees arrives as 92, 6.52 UV as 6. Rounded figures would make
       the console's tenth digit permanently zero. */
    const obs = zipObs(obsResp);

    // Prefer a value the station reports; fall back to the other call.
    const pick = (...vals) => {
      for (const v of vals) if (v !== undefined && v !== null) return v;
      return null;
    };

    // ── Today's extremes, if a device id was supplied ────────────────
    let tMin = null, tMax = null, tMinAt = "—", tMaxAt = "—";
    let gustMax = null, peakSun = null, windDayAvg = null;
    let tempTrend = null, tempDiff24 = null;
    let pLowIn = null, pHighIn = null, pLowAt = "—", pHighAt = "—";
    let pRate3h = null;
    let minLabel = "Forecast Low", maxLabel = "Forecast High";

    if (t.deviceId) {
      try {
        const nowSec = now.getTime() / 1000;
        const midnightSec = midnight.getTime() / 1000;

        // Re-read the day occasionally rather than on every refresh; live
        // readings are merged into the extremes below in between.
        const stale = dayCache.day !== midnight.getTime() ||
                      Date.now() - dayCache.at > DAY_CACHE_MS;
        if (stale) {
          dayCache = {
            at: Date.now(),
            day: midnight.getTime(),
            rows: await tempestDeviceRange(t.deviceId, t.token, midnightSec, nowSec)
          };
        }
        const today = dayCache.rows;

        // A narrow window either side of this time yesterday is all the
        // 24-hour difference needs; no reason to pull a second whole day.
        const yesterday = await tempestDeviceRange(
          t.deviceId, t.token, nowSec - 86400 - 3600, nowSec - 86400 + 3600
        ).catch(() => []);
        const rows = today;

        const temps = rows.filter((r) => r.tempF !== null);
        if (temps.length) {
          let lo = temps[0], hi = temps[0];
          for (const r of temps) { if (r.tempF < lo.tempF) lo = r; if (r.tempF > hi.tempF) hi = r; }
          tMin = lo.tempF; tMax = hi.tempF;
          tMinAt = clock(lo.t); tMaxAt = clock(hi.t);
          minLabel = "Today's Low"; maxLabel = "Today's High";
        }

        // Trend over the last hour, and the change since this time yesterday.
        const tSeries = temps.map((r) => ({ t: r.t, v: r.tempF }));
        const hourAgo = at(tSeries, new Date(now.getTime() - 3600000), 30);
        const dayAgo = at(yesterday.filter((r) => r.tempF !== null)
                                   .map((r) => ({ t: r.t, v: r.tempF })),
                          new Date(now.getTime() - 86400000), 90);
        const nowTemp = pick(obs.air_temp, cc.air_temperature);
        if (nowTemp !== null && hourAgo !== null) tempTrend = nowTemp - hourAgo;
        if (nowTemp !== null && dayAgo !== null)  tempDiff24 = nowTemp - dayAgo;

        const gusts = rows.map((r) => r.gustMph).filter((v) => v !== null);
        if (gusts.length) gustMax = Math.max(...gusts);

        const winds = rows.map((r) => r.windMph).filter((v) => v !== null);
        if (winds.length) {
          windDayAvg = winds.reduce((a2, b2) => a2 + b2, 0) / winds.length;
        }

        /* Device observations carry STATION pressure. Each sample is reduced
           to sea level in its own right, rather than applying one offset
           taken from the current reading. */
        const press = rows.filter((r) => r.pressMb !== null).map((r) => ({
          t: r.t,
          v: elevM !== null ? inHg(seaLevelMb(r.pressMb, elevM)) : inHg(r.pressMb)
        }));
        if (press.length) {
          let lo = press[0], hi = press[0];
          for (const r of press) {
            if (r.v < lo.v) lo = r;
            if (r.v > hi.v) hi = r;
          }
          pLowIn = lo.v;  pLowAt = clock(lo.t);
          pHighIn = hi.v; pHighAt = clock(hi.t);

          const nowMb = pick(obs.station_pressure, cc.station_pressure);
          const nowIn = elevM !== null && nowMb !== null
            ? inHg(seaLevelMb(nowMb, elevM)) : inHg(nowMb);
          const then = at(press, new Date(now.getTime() - 3 * 3600000), 45);
          if (then !== null && nowIn !== null) pRate3h = (nowIn - then) / 3;
        }

        const solar = rows.filter((r) => Number.isFinite(r.solar));
        if (solar.length > 1) {
          let wh = 0;
          for (let i = 1; i < solar.length; i++) {
            const dt = (solar[i].t - solar[i - 1].t) / 3600000;
            wh += (solar[i].solar + solar[i - 1].solar) / 2 * dt;
          }
          peakSun = Math.round(wh / 1000 * 10) / 10;
        }
      } catch (e) { /* the optional call; the panels fall back to dashes */ }
    }
    if (tMin === null) { tMin = day.air_temp_low ?? null; tMax = day.air_temp_high ?? null; }

    // ── Sun ──────────────────────────────────────────────────────────
    const rise = day.sunrise ? new Date(day.sunrise * 1000) : null;
    const set  = day.sunset  ? new Date(day.sunset  * 1000) : null;
    let progress = 0, remain = 0, till = "Sunrise";
    if (rise && set) {
      progress = Math.max(0, Math.min(1, (now - rise) / (set - rise)));
      if (now < rise)     { remain = rise - now; till = "Sunrise"; }
      else if (now < set) { remain = set - now;  till = "Sunset"; }
    }

    // ── Wind ─────────────────────────────────────────────────────────
    const bearing = pick(obs.wind_dir, cc.wind_direction, 0);
    const card = compass(bearing);
    const windNow  = pick(obs.wind_avg, cc.wind_avg, 0);
    const windGust = pick(obs.wind_gust, cc.wind_gust, 0);
    const airTemp  = pick(obs.air_temp, cc.air_temperature);
    const humidity = pick(obs.rh, cc.relative_humidity);
    const apparent = apparentF(airTemp, humidity, windNow);

    /* Fold the live reading into the day's extremes. The cached day is
       re-read every ten minutes; this keeps a new high or low visible the
       moment it happens, the way an accumulating console would. */
    if (minLabel === "Today's Low" && airTemp !== null) {
      if (tMin === null || airTemp < tMin) { tMin = airTemp; tMinAt = clock(now); }
      if (tMax === null || airTemp > tMax) { tMax = airTemp; tMaxAt = clock(now); }
    }
    if (windGust !== null && (gustMax === null || windGust > gustMax)) {
      gustMax = windGust;
    }

    // ── Pressure ─────────────────────────────────────────────────────
    const stationMb = pick(obs.station_pressure, cc.station_pressure);
    const slp = elevM !== null && stationMb !== null
      ? inHg(seaLevelMb(stationMb, elevM))
      : inHg(pick(obs.sea_level_pressure, cc.sea_level_pressure));
    const trendWord = String(pick(cc.pressure_trend, "steady")).toLowerCase();
    const TRENDS = {
      falling: ["Falling", "Conditions may worsen", "Rain becoming more likely"],
      steady:  ["Steady", "Conditions unchanged", "No marked change expected"],
      rising:  ["Rising", "Conditions may improve", "Fair weather becoming more likely"]
    };
    const [pTrend, verdict, outlookText] = TRENDS[trendWord] || TRENDS.steady;

    const radiation = pick(obs.solar_radiation, cc.solar_radiation, 0);
    const uv = pick(obs.uv, cc.uv, 0);

    /* precip_accumulation is what fell during one report interval, so an
       hourly rate is that scaled up by however many intervals fit in an
       hour. report_interval is in minutes and is normally 1. */
    const interval = pick(obs.report_interval, 1) || 1;
    const rate = obs.precip_accumulation == null
      ? 0 : obs.precip_accumulation * 60 / interval;

    /* Month and year rainfall come from the stats endpoint, whose rows are
       positional arrays rather than named fields:

         ["2026-09-01", 955.8, 957.5, ... , 0.586993, 0.586993, 5, 5, 1, 0]
                                              ^ index 28, the period total

       That total is always millimetres. The endpoint accepts units_precip
       and ignores it - asking for "in" and "mm" returns identical numbers -
       so it is converted here rather than requested in inches. 0.586993 mm
       is 0.02 in, which is what the station's own console shows.

       Rows are matched by their date prefix rather than taken by position,
       so the figures stay right once the station has more than one month
       of history. */
    const PRECIP_TOTAL = 28;
    const statTotal = (rows, prefix) => {
      if (!Array.isArray(rows) || !rows.length) return null;
      const row = rows.find((r) => Array.isArray(r) &&
                                   typeof r[0] === "string" &&
                                   r[0].startsWith(prefix))
                  || rows[rows.length - 1];
      const mm = row && row[PRECIP_TOTAL];
      return Number.isFinite(mm) ? Math.round(mm / 25.4 * 100) / 100 : null;
    };
    const thisMonth = now.getFullYear() + "-" +
                      String(now.getMonth() + 1).padStart(2, "0");
    const thisYear  = String(now.getFullYear());
    /* strike_distance reads 0 when nothing has been detected, which would
       render as a confident "0 mi". Only trust it alongside a strike. */
    const strikes1h = pick(cc.lightning_strike_count_last_1hr, 0);
    const strikes3h = pick(cc.lightning_strike_count_last_3hr, 0);
    const strikeDist = (strikes1h || strikes3h) && obs.strike_distance
      ? obs.strike_distance : null;

    const title = (s) => String(s || "")
      .replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

    /* The Forecast panel must show a FORECAST. Reading current_conditions
       here made it a second copy of the Temperature panel, stamped with the
       current time instead of the hour being forecast. */
    const hourly = (fc && fc.forecast && fc.forecast.hourly) || [];
    const nowSecs = Math.floor(now.getTime() / 1000);
    const next = hourly.find((h) => h && h.time >= nowSecs) || hourly[0] || null;
    const fIcon = iconToken((next && next.icon) || cc.icon || day.icon);
    const fNight = /night/.test(String((next && next.icon) || cc.icon || ""));

    /* The strip: the next five hours from now, which is why it starts at
       the current hour rather than at index 0 - the API returns the whole
       day and the early entries are already past. */
    const fHours = hourly
      .filter((h) => h && h.time >= nowSecs)
      .slice(0, 5)
      .map((h) => ({
        label: hourLabel(new Date(h.time * 1000)),
        temp:  h.air_temperature === undefined ? null : Math.round(h.air_temperature),
        icon:  iconToken(h.icon),
        night: /night/.test(String(h.icon || "")),
        wind:  h.wind_avg === undefined ? null : Math.round(h.wind_avg)
      }));

    /* The next five days, skipping today - today's high and low are
       already on the Temperature panel, and repeating them here would
       spend a row saying nothing new. */
    const dailyAll = (fc && fc.forecast && fc.forecast.daily) || [];
    const fDays = dailyAll
      .slice(1, 6)
      .map((d) => ({
        label: dayLabel(new Date((d.day_start_local || 0) * 1000), now),
        cond:  shortCond(d.conditions),
        icon:  iconToken(d.icon),
        lo:    d.air_temp_low  === undefined ? null : Math.round(d.air_temp_low),
        hi:    d.air_temp_high === undefined ? null : Math.round(d.air_temp_high),
        pop:   d.precip_probability === undefined ? 0 : Math.round(d.precip_probability)
      }));

    return {
      forecast: {
        wind: next && next.wind_avg !== undefined
          ? Math.round(next.wind_avg) + " mph " +
            (next.wind_direction_cardinal ||
             compass(pick(next.wind_direction, bearing)).short)
          : Math.round(pick(cc.wind_avg, 0)) + " mph " + card.short,
        text: (next && next.conditions) || cc.conditions ||
              title(day.conditions) || "—",
        temp: next && next.air_temperature !== undefined
          ? next.air_temperature : airTemp,
        low:  day.air_temp_low  === undefined ? null : Math.round(day.air_temp_low),
        high: day.air_temp_high === undefined ? null : Math.round(day.air_temp_high),
        pop:  Math.round(pick(day.precip_probability, 0)),
        daily: Math.round(pick(day.precip_probability, 0)) + "%",
        icon: fIcon,
        night: fNight,
        issued: next ? clock(new Date(next.time * 1000)) : clock(now),
        hours: fHours,
        days: fDays
      },
      outdoor: {
        temp: airTemp,
        diff: tempDiff24,
        trend: tempTrend,
        min: tMin, minAt: tMinAt, max: tMax, maxAt: tMaxAt,
        minLabel, maxLabel,
        feels: apparent,
        feelsText: feelsText(apparent),
        humidity: Math.round(humidity === null ? 0 : humidity),
        dew: dewPointF(airTemp, humidity) ?? pick(cc.dew_point, null)
      },
      wind: {
        // The day's mean, not the current reading - "Wind" above already
        // shows that, and printing the same figure twice helps nobody.
        avg:  windDayAvg === null ? null : Math.round(windDayAvg * 10) / 10,
        max:  gustMax === null ? null : Math.round(gustMax),
        now:  Math.round(windNow * 10) / 10,
        gust: Math.round(windGust * 10) / 10,
        scale: Math.max(15, Math.ceil((gustMax || windGust) / 5) * 5),
        bearing: Math.round(bearing),
        cardinal: card.short,
        // wind_direction_cardinal is the abbreviation ("SW"); the dial
        // wants the spelled-out form the PiConsole shows.
        cardinalLong: card.long,
        beaufort: beaufort(windNow)
      },
      solar: {
        radiation: Math.round(radiation),
        uv: Math.round(uv * 10) / 10,
        uvBand: uvBand(uv),
        rise: rise ? clock(rise) : "—",
        set:  set  ? clock(set)  : "—",
        progress,
        remainH: String(Math.max(0, Math.floor(remain / 3600000))),
        remainM: String(Math.max(0, Math.floor((remain % 3600000) / 60000))).padStart(2, "0"),
        till,
        peakSun,
        band: solarBand(radiation)
      },
      rain: {
        today:     pick(obs.local_day_precip_accumulation,
                        cc.precip_accum_local_day, 0),
        yesterday: pick(cc.precip_accum_local_yesterday, 0),
        month: statTotal(stats && stats.stats_month, thisMonth),
        year:  statTotal(stats && stats.stats_year,  thisYear),
        rate,
        state: rate > 0 ? "Currently Raining" : "Currently Dry"
      },
      barometer: {
        slp,
        low:   (slp !== null && pLowIn  !== null && slp < pLowIn)  ? slp : pLowIn,
        lowAt: (slp !== null && pLowIn  !== null && slp < pLowIn)  ? clock(now) : pLowAt,
        high:  (slp !== null && pHighIn !== null && slp > pHighIn) ? slp : pHighIn,
        highAt:(slp !== null && pHighIn !== null && slp > pHighIn) ? clock(now) : pHighAt,
        trend: pTrend, rate: pRate3h, verdict
      },
      /* Sager needs a METAR feed the Tempest API does not carry. What the
         station itself supports is a pressure-tendency outlook, so that is
         what this reports - under its own name rather than Sager's. */
      sager: {
        title: "Pressure Outlook",
        weather: pTrend === "Steady" ? "No change" : pTrend,
        when: verdict.toLowerCase(),
        dir: card.short,
        force: beaufort(windNow),
        temp: pTrend,
        text: outlookText + ". Sea level pressure " +
              (slp === null ? "unknown" : slp.toFixed(2) + " inHg") +
              ", " + trendWord + ", wind " + card.long.toLowerCase() +
              " at " + Math.round(windNow) + " mph. A full Sager forecast " +
              "needs a METAR feed; switch to the Home Assistant source for it.",
        dial: slp === null ? "—" : slp.toFixed(2) + " inHg " + pTrend.toLowerCase(),
        src: "Tempest",
        at: cc.time ? clock(new Date(cc.time * 1000)) : clock(now)
      },
      moon: moon(now),
      /* The Tempest API reports strikes over the last hour and the last
         three hours, not per calendar day, so the panel says so rather
         than relabelling three-hour counts as "today". */
      lightning: {
        dist: strikeDist === null ? null : Math.round(strikeDist),
        when: strikes1h || strikes3h
          ? "Detected in the last three hours"
          : "No strikes detected",
        hour:  strikes1h,
        today: strikes3h,
        yesterday: null,
        hourLabel:  "Last Hour",
        todayLabel: "Last 3 Hours",
        yestLabel:  "Yesterday"
      }
    };
  }

  /* One-off helper for setup: prints your station and device ids.
     Open the console on the page and run  Sources.tempestStations("<token>") */
  async function tempestStations(token) {
    const r = await tget("/stations?token=" + encodeURIComponent(token));
    const out = (r.stations || []).map((s) => ({
      station_id: s.station_id,
      name: s.name,
      devices: (s.devices || [])
        .filter((d) => d.device_type === "ST")
        .map((d) => ({ device_id: d.device_id, serial: d.serial_number }))
    }));
    console.table(out.flatMap((s) => s.devices.map((d) => ({
      station: s.name, stationId: s.station_id, deviceId: d.device_id, serial: d.serial
    }))));
    return out;
  }

  // ── Home Assistant source ─────────────────────────────────────────

  function haClient(cfg) {
    const base = cfg.baseUrl.replace(/\/+$/, "");
    const headers = {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json"
    };

    async function get(path) {
      const res = await fetch(base + path, { headers });
      if (!res.ok) throw new Error("HA " + res.status + " on " + path);
      return res.json();
    }

    async function post(path, body) {
      const res = await fetch(base + path, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("HA " + res.status + " on " + path);
      return res.json();
    }

    return { get, post };
  }

  /* One history call covers the last 24 hours of every series the
     console derives something from, which is cheaper and more reliable
     than asking Home Assistant for a min/max helper per figure. */
  async function haHistory(api, ids, since) {
    const q = "/api/history/period/" + since.toISOString() +
              "?filter_entity_id=" + ids.join(",") +
              "&minimal_response&no_attributes&significant_changes_only";
    const series = await api.get(q);
    const out = {};
    for (const rows of series) {
      if (!rows || !rows.length) continue;
      const id = rows[0].entity_id;
      out[id] = rows
        .map((r) => ({ t: new Date(r.last_changed || r.last_updated),
                       v: parseFloat(r.state) }))
        .filter((p) => Number.isFinite(p.v));
    }
    return out;
  }

  const extremes = (points, from) => {
    const rows = points ? points.filter((p) => p.t >= from) : [];
    if (!rows.length) return { min: null, minAt: "—", max: null, maxAt: "—" };
    let lo = rows[0], hi = rows[0];
    for (const p of rows) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
    return { min: lo.v, minAt: clock(lo.t), max: hi.v, maxAt: clock(hi.t) };
  };

  // Value nearest to a given moment, or null when the window misses it.
  const at = (points, when, toleranceMin = 90) => {
    if (!points || !points.length) return null;
    let best = null, bestGap = Infinity;
    for (const p of points) {
      const gap = Math.abs(p.t - when);
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    return bestGap <= toleranceMin * 60000 ? best.v : null;
  };

  async function homeAssistant(cfg) {
    const api = haClient(cfg);
    const E = cfg.entities;
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

    const wanted = Object.values(E).filter(Boolean);
    const [states, history] = await Promise.all([
      api.get("/api/states"),
      haHistory(api, [E.temperature, E.pressureSeaLevel, E.windGust, E.solarRadiation]
                       .filter(Boolean), dayAgo)
        .catch(() => ({}))
    ]);

    const byId = {};
    for (const s of states) if (wanted.includes(s.entity_id)) byId[s.entity_id] = s;

    const num = (id, fallback = null) => {
      const s = byId[id];
      if (!s || s.state === "unknown" || s.state === "unavailable") return fallback;
      const v = parseFloat(s.state);
      return Number.isFinite(v) ? v : fallback;
    };
    const str = (id, fallback = "") => {
      const s = byId[id];
      return s && s.state !== "unknown" && s.state !== "unavailable" ? s.state : fallback;
    };
    const attrs = (id) => (byId[id] && byId[id].attributes) || {};

    // ── Forecast ────────────────────────────────────────────────────
    let daily = null, dailyList = [], hourlyList = [];
    if (E.weather) {
      try {
        const r = await api.post(
          "/api/services/weather/get_forecasts?return_response",
          { entity_id: E.weather, type: "daily" });
        dailyList = ((r.service_response || {})[E.weather] || {}).forecast || [];
        daily = dailyList[0] || null;
      } catch (e) { /* forecast is optional; the panel degrades to dashes */ }

      /* Hourly is a separate call and not every weather integration serves
         it. Its own try/catch, so a backend that only does daily still
         fills the day rows instead of emptying the whole panel. */
      try {
        const r = await api.post(
          "/api/services/weather/get_forecasts?return_response",
          { entity_id: E.weather, type: "hourly" });
        hourlyList = ((r.service_response || {})[E.weather] || {}).forecast || [];
      } catch (e) { /* no hourly from this integration */ }
    }

    const fHours = hourlyList
      .filter((h) => h && new Date(h.datetime) >= now)
      .slice(0, 5)
      .map((h) => {
        const t = new Date(h.datetime);
        return {
          label: hourLabel(t),
          temp:  h.temperature === undefined ? null : Math.round(h.temperature),
          icon:  iconToken(h.condition),
          night: String(h.condition || "") === "clear-night",
          wind:  h.wind_speed === undefined ? null : Math.round(h.wind_speed)
        };
      });

    const fDays = dailyList
      .slice(1, 6)
      .map((d) => ({
        label: dayLabel(new Date(d.datetime), now),
        cond:  shortCond(d.condition),
        icon:  iconToken(d.condition),
        lo:    d.templow     === undefined ? null : Math.round(d.templow),
        hi:    d.temperature === undefined ? null : Math.round(d.temperature),
        pop:   d.precipitation_probability == null
                 ? 0 : Math.round(d.precipitation_probability)
      }));

    const wx = attrs(E.weather);
    const fBearing = wx.wind_bearing;
    const fWind = wx.wind_speed === undefined ? "—"
      : Math.round(wx.wind_speed) + " mph " +
        (fBearing === undefined ? "" : compass(fBearing).short);

    // ── Wind ────────────────────────────────────────────────────────
    const bearing = num(E.windDirection, 0);
    const card = compass(bearing);
    const gustHistory = extremes(history[E.windGust], midnight);
    const gustNow = num(E.windGust, 0);

    // ── Temperature ─────────────────────────────────────────────────
    const temp = num(E.temperature);
    const tHist = history[E.temperature] || [];
    const tDay = extremes(tHist, midnight);
    const tThen = at(tHist, dayAgo);
    const tHourAgo = at(tHist, new Date(now.getTime() - 3600 * 1000), 30);

    // ── Solar ───────────────────────────────────────────────────────
    const sun = attrs(E.sun);
    const above = str(E.sun) === "above_horizon";
    const nextRise = sun.next_rising ? new Date(sun.next_rising) : null;
    const nextSet  = sun.next_setting ? new Date(sun.next_setting) : null;
    // Above the horizon, today's sunrise has already gone by; the sun's
    // next rising is tomorrow's, within a minute or two of today's.
    const rise = above && nextRise ? new Date(nextRise.getTime() - 86400000) : nextRise;
    const set  = above ? nextSet : (nextSet ? new Date(nextSet.getTime() - 86400000) : null);

    let progress = 0, remain = 0, till = "Sunrise";
    if (rise && set) {
      const span = set - rise;
      progress = Math.max(0, Math.min(1, (now - rise) / span));
      if (above) { remain = set - now; till = "Sunset"; }
      else       { remain = (nextRise ? nextRise - now : 0); till = "Sunrise"; }
    }
    const remainH = Math.max(0, Math.floor(remain / 3600000));
    const remainM = Math.max(0, Math.floor((remain % 3600000) / 60000));

    // Peak sun hours: the day's irradiance integrated, in kWh/m².
    let peakSun = null;
    const solarPts = (history[E.solarRadiation] || []).filter((p) => p.t >= midnight);
    if (solarPts.length > 1) {
      let wh = 0;
      for (let i = 1; i < solarPts.length; i++) {
        const dt = (solarPts[i].t - solarPts[i - 1].t) / 3600000;
        wh += (solarPts[i].v + solarPts[i - 1].v) / 2 * dt;
      }
      peakSun = Math.round(wh / 1000 * 10) / 10;
    }
    const radiation = num(E.solarRadiation, 0);
    const uv = num(E.uvIndex, 0);

    // ── Rain ────────────────────────────────────────────────────────
    const rate = num(E.precipitationRate, 0);

    // ── Barometer ───────────────────────────────────────────────────
    const slp = num(E.pressureSeaLevel);
    const pHist = history[E.pressureSeaLevel] || [];
    const pDay = extremes(pHist, midnight);
    const p3 = at(pHist, new Date(now.getTime() - 3 * 3600 * 1000), 45);
    const pRate = (slp !== null && p3 !== null) ? (slp - p3) / 3 : 0;

    let pTrend = "Steady", verdict = "Conditions unchanged";
    if (pRate <= -0.06)      { pTrend = "Falling Fast";  verdict = "Expect deteriorating conditions"; }
    else if (pRate <= -0.02) { pTrend = "Falling";       verdict = "Conditions may worsen"; }
    else if (pRate >=  0.06) { pTrend = "Rising Fast";   verdict = "Expect improving conditions"; }
    else if (pRate >=  0.02) { pTrend = "Rising";        verdict = "Conditions may improve"; }

    // ── Sager ───────────────────────────────────────────────────────
    const sg = attrs(E.sager);
    const sgRaw = str(E.sager, "");
    const sgWords = sgRaw.replace(/^sager_/, "").replace(/_/g, " ");
    const sgTitle = sgWords.charAt(0).toUpperCase() + sgWords.slice(1);

    // ── Lightning ───────────────────────────────────────────────────
    const lastStrike = str(E.lightningLastStrike, "");
    const lDist = num(E.lightningLastDistance);

    return {
      forecast: {
        wind: fWind,
        text: daily && daily.condition
          ? daily.condition.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
          : (str(E.weather, "—").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())),
        temp: daily ? daily.temperature : (wx.temperature ?? null),
        low:  daily ? Math.round(daily.templow) : null,
        high: daily ? Math.round(daily.temperature) : null,
        pop:  daily && daily.precipitation_probability != null
                ? Math.round(daily.precipitation_probability) : 0,
        daily: daily && daily.precipitation != null
                ? daily.precipitation + " in" : "0%",
        icon: iconToken(daily ? daily.condition : str(E.weather, "")),
        night: str(E.sun) === "below_horizon",
        issued: clock(now),
        hours: fHours,
        days: fDays
      },
      outdoor: {
        temp,
        diff:  (temp !== null && tThen !== null) ? temp - tThen : null,
        trend: (temp !== null && tHourAgo !== null) ? temp - tHourAgo : null,
        min: tDay.min, minAt: tDay.minAt, max: tDay.max, maxAt: tDay.maxAt,
        feels: num(E.feelsLike),
        feelsText: feelsText(num(E.feelsLike)),
        humidity: Math.round(num(E.humidity, 0)),
        dew: num(E.dewPoint)
      },
      wind: {
        avg:  Math.round(num(E.windSpeedAvg, 0) * 10) / 10,
        max:  gustHistory.max === null ? null : Math.round(gustHistory.max),
        now:  Math.round(num(E.windSpeed, 0) * 10) / 10,
        gust: Math.round(gustNow * 10) / 10,
        scale: Math.max(15, Math.ceil((gustHistory.max || 0) / 5) * 5),
        bearing: Math.round(bearing),
        cardinal: card.short, cardinalLong: card.long,
        beaufort: beaufort(num(E.windSpeed, 0))
      },
      solar: {
        radiation: Math.round(radiation),
        uv: Math.round(uv * 10) / 10,
        uvBand: uvBand(uv),
        rise: rise ? clock(rise) : "—",
        set:  set  ? clock(set)  : "—",
        progress,
        remainH: String(remainH),
        remainM: String(remainM).padStart(2, "0"),
        till,
        peakSun,
        band: solarBand(radiation)
      },
      rain: {
        today:     num(E.precipitationToday, 0),
        yesterday: num(E.precipitationYesterday, 0),
        month:     num(E.precipitationMonth, null),
        year:      num(E.precipitationYear, null),
        rate,
        state: rate > 0 ? "Currently Raining" : "Currently Dry"
      },
      barometer: {
        slp,
        low: pDay.min, lowAt: pDay.minAt,
        high: pDay.max, highAt: pDay.maxAt,
        trend: pTrend, rate: pRate, verdict
      },
      sager: {
        weather: sgTitle || "—",
        when: sg.trend ? String(sg.trend).replace(/[↑↓]+\s*/, "").toLowerCase()
                       : "no marked change",
        dir: sg.wind_direction || card.short,
        force: beaufort(sg.wind_speed ?? num(E.windSpeed, 0)),
        temp: pTrend.startsWith("Rising") ? "Rising"
            : pTrend.startsWith("Falling") ? "Falling" : "Steady",
        text: sgTitle
          ? sgTitle + ". Wind " + (sg.wind_direction || card.short) +
            " at " + (sg.wind_speed ?? "—") + " mph, pressure " +
            (sg.trend || "steady") + " (" + (sg.pressure_delta_3h ?? 0) +
            " hPa over three hours)."
          : "No Sager forecast available.",
        dial: sg.pressure_hpa ? sg.pressure_hpa + " hPa · " +
                                (sg.altitude_m ?? "?") + " m" : "—",
        src: "Zambretti & Sager",
        at: byId[E.sager] ? clock(new Date(byId[E.sager].last_updated)) : "—"
      },
      moon: moon(now),
      lightning: {
        dist: lDist === null ? null : Math.round(lDist),
        when: lastStrike
          ? "Last strike " + clock(new Date(lastStrike))
          : "No strikes detected",
        hour: num(E.lightningCountHour, 0),
        today: num(E.lightningCount, 0),
        yesterday: num(E.lightningCountYesterday, 0)
      }
    };
  }

  return { demo, tempest, tempestStations, homeAssistant,
           moon, compass, beaufort };
})();
