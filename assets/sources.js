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

  const CARDINALS = ["North", "North North East", "North East", "East North East",
                     "East", "East South East", "South East", "South South East",
                     "South", "South South West", "South West", "West South West",
                     "West", "West North West", "North West", "North North West"];
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
                   temp: 90, low: 61, high: 91, pop: 0, daily: 0, issued: "1 PM" },
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
    let daily = null;
    if (E.weather) {
      try {
        const r = await api.post(
          "/api/services/weather/get_forecasts?return_response",
          { entity_id: E.weather, type: "daily" });
        const list = ((r.service_response || {})[E.weather] || {}).forecast || [];
        daily = list[0] || null;
      } catch (e) { /* forecast is optional; the panel degrades to dashes */ }
    }

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
        issued: clock(now)
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

  return { demo, homeAssistant, moon, compass, beaufort };
})();
