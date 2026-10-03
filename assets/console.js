/* ------------------------------------------------------------------ *
 * Tempest Web Console - rendering
 *
 * Everything here reads from one object, `DATA`, whose shape is fixed by
 * assets/sources.js. Nothing in this file knows where the numbers came
 * from, so the demo source and the Home Assistant source are
 * interchangeable.
 * ------------------------------------------------------------------ */

"use strict";

let DATA = null;

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const F = "℉";

/* Value-banded colours, carried over from the Pi console's temp-colour
   patch so both screens read the same at a glance. A reading takes the hue
   of the band its value falls in; hues[i] applies below stops[i], and the
   last hue applies above the final stop.

   Set BAND_COLOURS to false to go back to plain white numerals. */
const BAND_COLOURS = true;

const TEMP_BANDS = {
  stops: [45, 60, 78, 90],
  hues:  ["#00a4b4", "#4fc3d7", "#c8c8c8", "#f0a050", "#f05e40"]
};
// Dew point is a comfort scale, not a temperature scale: dry is pleasant,
// so the low end is green rather than cold blue.
const DEW_BANDS = {
  stops: [55, 65, 70],
  hues:  ["#81c784", "#c8c8c8", "#f0a050", "#f05e40"]
};

function band(el_, value, bands) {
  if (!BAND_COLOURS) return;
  if (value === null || value === undefined || Number.isNaN(value)) {
    el_.style.color = "";
    return;
  }
  let i = 0;
  while (i < bands.stops.length && value >= bands.stops[i]) i++;
  el_.style.color = bands.hues[i];
}

// Fixed-decimal text, or an en dash when a source has no value for it.
// Several figures exist only in some sources - the barometer's daily
// extremes, month and year rainfall - so every raw toFixed goes through
// this rather than assuming a number is there.
const fixed = (v, d) =>
  (v === null || v === undefined || Number.isNaN(v)) ? "–" : v.toFixed(d);

function el(name, attrs) {
  const n = document.createElementNS(SVG, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// ── A reading, split the way the patched Pi console draws it ───────────
// Whole number at full size, the tenth reduced, the unit small and raised.
// Rounding happens once, so the parts can never disagree: 89.96 is 90.0,
// not 89 with a stray .10 after it.
function reading(el_, value, unit, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    el_.innerHTML = '<span class="whole">–</span>' +
                    (unit ? '<span class="unit">' + unit + '</span>' : '');
    return;
  }
  // One rounding, then split the result - so the whole and the fraction can
  // never disagree. 89.96 becomes 90.0, never 89 with a stray .10 beside it.
  // Rainfall wants two places, so the fraction is zero-padded rather than
  // assumed to be a single digit.
  const p = Math.pow(10, decimals);
  const r = Math.round(value * p);
  const abs = Math.abs(r);
  const whole = Math.trunc(abs / p);
  const frac = String(abs % p).padStart(decimals, "0");
  const sign = r < 0 ? "-" : "";
  el_.innerHTML =
    '<span class="whole">' + sign + whole + '</span>' +
    (decimals ? '<span class="tenth">.' + frac + '</span>' : '') +
    (unit ? '<span class="unit">' + unit + '</span>' : '');
}

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx, cy, r, from, to) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = ((to - from) % 360 + 360) % 360 > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}
function needle(cx, cy, r, deg, half) {
  const tip = polar(cx, cy, r + 11, deg);
  const a   = polar(cx, cy, r - 5, deg - half);
  const b   = polar(cx, cy, r - 5, deg + half);
  return `${tip[0].toFixed(1)},${tip[1].toFixed(1)} ` +
         `${a[0].toFixed(1)},${a[1].toFixed(1)} ` +
         `${b[0].toFixed(1)},${b[1].toFixed(1)}`;
}

// ── Wind: a real compass rather than four anonymous arcs ──────────────
function drawWind() {
  const cx = 150, cy = 108, r = 76;
  const g = $("w-ring");
  g.innerHTML = "";

  g.appendChild(el("circle", { cx, cy, r, fill: "none",
                               stroke: "#242424", "stroke-width": 7 }));

  // The 30° sector the wind is blowing from, picked out in green.
  const d = DATA.wind.bearing;
  g.appendChild(el("path", { d: arcPath(cx, cy, r, d - 15, d + 15), fill: "none",
                             stroke: "#9ccc65", "stroke-width": 7,
                             "stroke-linecap": "round" }));

  // Ticks every 22.5°, longer on the eight named points.
  for (let i = 0; i < 16; i++) {
    const deg  = i * 22.5;
    const long = i % 2 === 0;
    const [x1, y1] = polar(cx, cy, r - (long ? 11 : 7), deg);
    const [x2, y2] = polar(cx, cy, r - 4, deg);
    g.appendChild(el("line", { x1, y1, x2, y2, stroke: long ? "#6e6e6e" : "#3a3a3a",
                               "stroke-width": long ? 1.6 : 1 }));
  }

  // N / E / S / W outside the ring.
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([t, deg]) => {
    const [x, y] = polar(cx, cy, r + 16, deg);
    const n = el("text", { x, y: y + 5, "text-anchor": "middle", "font-size": 13,
                           "font-weight": 600, fill: t === "N" ? "#ffffff" : "#6e6e6e" });
    n.textContent = t;
    g.appendChild(n);
  });

  $("w-needle").setAttribute("points", needle(cx, cy, r, d, 5));
}

// ── Barometer: the classic aneroid face, banded and numbered ──────────
const B_LO = 28.0, B_HI = 31.0;
const bDeg = (v) => -90 + (Math.max(B_LO, Math.min(B_HI, v)) - B_LO) / (B_HI - B_LO) * 180;

function drawBarometer() {
  const cx = 160, cy = 168, r = 118;
  const bands = $("b-bands"), ticks = $("b-ticks");
  bands.innerHTML = ""; ticks.innerHTML = "";

  [[28.0, 29.0, "#7e57c2", "Stormy"],
   [29.0, 29.6, "#4fc3d7", "Rain"],
   [29.6, 30.1, "#8a8a8a", "Change"],
   [30.1, 30.6, "#9ccc65", "Fair"],
   [30.6, 31.0, "#ffca28", "Dry"]].forEach(([a, b, colour, name]) => {
    bands.appendChild(el("path", { d: arcPath(cx, cy, r, bDeg(a), bDeg(b)), fill: "none",
                                   stroke: colour, "stroke-width": 8, opacity: 0.85 }));
    const [lx, ly] = polar(cx, cy, r - 25, (bDeg(a) + bDeg(b)) / 2);
    const t = el("text", { x: lx, y: ly + 4, "text-anchor": "middle",
                           "font-size": 11, "letter-spacing": 0.5, fill: colour });
    t.textContent = name;
    bands.appendChild(t);
  });

  for (let v = 28; v <= 31; v += 0.5) {
    const deg = bDeg(v), major = Number.isInteger(v);
    const [x1, y1] = polar(cx, cy, r + 5, deg);
    const [x2, y2] = polar(cx, cy, r + (major ? 13 : 9), deg);
    ticks.appendChild(el("line", { x1, y1, x2, y2, stroke: "#7a7a7a",
                                   "stroke-width": major ? 1.8 : 1 }));
    if (major) {
      const [tx, ty] = polar(cx, cy, r + 23, deg);
      const t = el("text", { x: tx, y: ty + 4, "text-anchor": "middle",
                             "font-size": 12, "font-weight": 600, fill: "#c8c8c8" });
      t.textContent = v.toFixed(0);
      ticks.appendChild(t);
    }
  }

  $("b-needle").setAttribute("points", needle(cx, cy, r, bDeg(DATA.barometer.slp), 3.2));
}

// ── Moon: the lit fraction drawn as two arcs ──────────────────────────
function drawMoon() {
  // The pane can be opened before the first reading arrives.
  if (!DATA || !DATA.moon) return;
  const g = $("m-dial");
  g.innerHTML = "";
  const cx = 150, cy = 72, r = 56;
  const k = DATA.moon.fraction;              // 0 new … 0.5 full … 1 new again
  const theta = k * 2 * Math.PI;
  const f  = (1 - Math.cos(theta)) / 2;      // lit fraction of the disc
  const rx = r * Math.abs(Math.cos(theta));  // the terminator's half-width
  const waxing = k < 0.5;                    // lit limb on the right

  g.appendChild(el("circle", { cx, cy, r, fill: "#101010",
                               stroke: "#2e2e2e", "stroke-width": 1 }));

  // The lit region is bounded by one limb of the disc and the terminator.
  // Which way the terminator bulges is what separates crescent from gibbous.
  const outer = waxing ? 1 : 0;
  const term  = waxing ? (f < 0.5 ? 0 : 1) : (f < 0.5 ? 1 : 0);
  g.appendChild(el("path", {
    d: `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} ` +
       `A ${rx.toFixed(2)} ${r} 0 0 ${term} ${cx} ${cy - r} Z`,
    fill: "#e4e2d8" }));
}

// ── Forecast icon ─────────────────────────────────────────────────────
/* The forecast icon was a single hardcoded partly-cloudy drawing, so it
   showed a sun at midnight. It now follows the condition token the source
   supplies, with day and night variants where the distinction matters. */
// All eight rays. The cloud in the `partly` variant is drawn after the sun
// and covers the lower-left ones, so a five-ray sun looked fine there - but
// `clear` draws the sun alone and the missing side showed.
const SUN = '<g stroke="#f0a050" stroke-width="3" stroke-linecap="round">' +
  '<line x1="40" y1="2"  x2="40" y2="9"/>' +   /* top          */
  '<line x1="56" y1="8"  x2="51" y2="13"/>' +  /* upper right  */
  '<line x1="62" y1="23" x2="55" y2="23"/>' +  /* right        */
  '<line x1="56" y1="38" x2="51" y2="33"/>' +  /* lower right  */
  '<line x1="40" y1="44" x2="40" y2="37"/>' +  /* bottom       */
  '<line x1="24" y1="38" x2="29" y2="33"/>' +  /* lower left   */
  '<line x1="18" y1="23" x2="25" y2="23"/>' +  /* left         */
  '<line x1="24" y1="8"  x2="29" y2="13"/>' +  /* upper left   */
  '</g>' +
  '<circle cx="40" cy="23" r="9" fill="#f0a050"/>';

// A crescent: the disc, with a second disc lifted out of its upper right.
const MOON = '<path d="M45 13a11 11 0 1 0 0 20 13 13 0 0 1 0-20Z" ' +
             'fill="#cfd8dc" stroke="#cfd8dc" stroke-width="2" ' +
             'stroke-linejoin="round"/>';

const CLOUD = '<path d="M17 46h26a9 9 0 0 0 .6-18 13 13 0 0 0-24.6 4A8 8 0 0 0 17 46Z" ' +
              'fill="#ffffff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>';

const DROPS = '<g stroke="#4fc3d7" stroke-width="3" stroke-linecap="round">' +
  '<line x1="22" y1="48" x2="19" y2="52"/><line x1="31" y1="48" x2="28" y2="52"/>' +
  '<line x1="40" y1="48" x2="37" y2="52"/></g>';

const BOLT = '<path d="M33 44 24 52h6l-2 7 9-9h-6l2-6Z" fill="#ffca28"/>';

const FLAKES = '<g stroke="#b3e5fc" stroke-width="2.4" stroke-linecap="round">' +
  '<line x1="22" y1="49" x2="22" y2="53"/><line x1="20" y1="51" x2="24" y2="51"/>' +
  '<line x1="32" y1="49" x2="32" y2="53"/><line x1="30" y1="51" x2="34" y2="51"/>' +
  '<line x1="42" y1="49" x2="42" y2="53"/><line x1="40" y1="51" x2="44" y2="51"/></g>';

const FOG = '<g stroke="#b0bec5" stroke-width="3" stroke-linecap="round">' +
  '<line x1="14" y1="42" x2="48" y2="42"/><line x1="18" y1="49" x2="52" y2="49"/></g>';

const WIND = '<g stroke="#9ccc65" stroke-width="3" stroke-linecap="round" fill="none">' +
  '<path d="M12 20h24a6 6 0 1 0-6-6"/><path d="M12 32h32a6 6 0 1 1-6 6"/>' +
  '<path d="M12 44h16"/></g>';

const ICONS = {
  clear:  (night) => night ? MOON : SUN,
  partly: (night) => (night ? MOON : SUN) + CLOUD,
  // Two clouds, the back one offset - superimposing the same path just
  // draws one cloud.
  cloudy: () => '<g opacity="0.5" transform="translate(14,-9) scale(0.78)">' +
                CLOUD + '</g>' + CLOUD,
  rain:   () => CLOUD + DROPS,
  storm:  () => CLOUD + BOLT,
  snow:   () => CLOUD + FLAKES,
  fog:    () => CLOUD + FOG,
  wind:   () => WIND
};

// One icon as an <svg>. Sized by the stylesheet rather than here, so the
// hourly strip and the day rows can draw the same icon at two sizes.
function iconSvg(token, night, label) {
  const build = ICONS[token] || ICONS.partly;
  return '<svg viewBox="0 0 64 60" role="img" aria-label="' +
         esc(label || token || "forecast") + (night ? " at night" : "") +
         '">' + build(night) + '</svg>';
}

const esc = (t) => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dash = (v, suffix) =>
  (v === null || v === undefined || Number.isNaN(v)) ? "\u2013" : v + (suffix || "");

/* The next few hours, as a five-column strip. */
function drawHours(hours) {
  const list = Array.isArray(hours) ? hours : [];
  if (!list.length) {
    $("f-hours").innerHTML = '<div class="fh-h" style="grid-column:1/-1">' +
                             'No hourly forecast</div>';
    return;
  }
  $("f-hours").innerHTML = list.map((h) =>
    '<div>' +
      '<div class="fh-h">' + esc(h.label) + '</div>' +
      '<div class="fh-i">' + iconSvg(h.icon, h.night, h.label) + '</div>' +
      '<div class="fh-t">' + dash(h.temp, "\u00B0") + '</div>' +
      '<div class="fh-w">' + dash(h.wind, " mph") + '</div>' +
    '</div>').join("");
}

/* The next three days, one row each. The chance of rain is shown only
   when there is one - a column of "0%" is noise, and its absence is the
   same information. */
function drawDays(days) {
  const list = Array.isArray(days) ? days : [];
  if (!list.length) {
    $("f-days").innerHTML = '<div class="fd-c">No daily forecast</div>';
    return;
  }
  $("f-days").innerHTML = list.map((d) =>
    '<div class="fc-day">' +
      '<div>' +
        '<div class="fd-n">' + esc(d.label) + '</div>' +
        '<div class="fd-c">' + esc(d.cond) +
          (d.pop > 0 ? ' <span class="fd-pop">' + d.pop + '%</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="fd-i">' + iconSvg(d.icon, false, d.label) + '</div>' +
      '<div class="fd-hl">' +
        '<span class="fd-lo">' + dash(d.lo, "\u00B0") + '</span>' +
        '<span class="dim"> / </span>' +
        '<span class="fd-hi">' + dash(d.hi, "\u00B0") + '</span>' +
      '</div>' +
    '</div>').join("");
}

// ── Clock ─────────────────────────────────────────────────────────────
function tick() {
  const now = new Date();
  $("c-date").textContent = now.toLocaleDateString("en-US",
    { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  $("c-time").textContent = now.toLocaleTimeString("en-US",
    { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

// ── Paint ─────────────────────────────────────────────────────────────
function render() {
  const f = DATA.forecast, o = DATA.outdoor, w = DATA.wind,
        s = DATA.solar, r = DATA.rain, b = DATA.barometer,
        sg = DATA.sager, m = DATA.moon, l = DATA.lightning;

  drawHours(f.hours);
  drawDays(f.days);

  reading($("t-outdoor"), o.temp, F);
  band($("t-outdoor"), o.temp, TEMP_BANDS);
  reading($("t-diff"), o.diff, F);
  // Only label a direction when there is a figure to have one.
  if (o.diff !== null && o.diff !== undefined) {
    $("t-diff").insertAdjacentHTML("beforeend",
      ` <span class="stamp ${o.diff >= 0 ? "trend-up" : "trend-down"}">` +
      `${o.diff >= 0 ? "warmer" : "colder"}</span>`);
  }
  reading($("t-min"), o.min, F);
  reading($("t-max"), o.max, F);
  $("t-min-at").textContent = o.minAt;
  $("t-max-at").textContent = o.maxAt;
  // Observed extremes where the source has them, forecast figures where it
  // does not, so the panel never claims more than it knows.
  $("t-min-label").textContent = o.minLabel || "Today's Low";
  $("t-max-label").textContent = o.maxLabel || "Today's High";
  reading($("t-trend"), o.trend, F + "/hr");
  if (o.trend !== null && o.trend !== undefined) {
    $("t-trend").classList.add(o.trend >= 0 ? "trend-up" : "trend-down");
    $("t-trend").firstChild.textContent =
      (o.trend >= 0 ? "+" : "") + $("t-trend").firstChild.textContent;
  }
  reading($("t-feels"), o.feels, F);
  band($("t-feels"), o.feels, TEMP_BANDS);
  $("t-hum").textContent = o.humidity;
  reading($("t-dew"), o.dew, F);
  band($("t-dew"), o.dew, DEW_BANDS);
  $("t-feels-text").textContent = o.feelsText;

  $("w-avg").textContent  = w.avg;
  $("w-max").textContent  = w.max;
  reading($("w-now"),  w.now,  "mph");
  reading($("w-gust"), w.gust, "mph");
  $("w-deg").textContent  = w.bearing + "°";
  $("w-spd").textContent  = w.avg;
  $("w-card").textContent = w.cardinalLong;
  $("w-beaufort").textContent = w.beaufort;
  const pct = (v) => Math.max(2, Math.min(100, v / w.scale * 100)).toFixed(0) + "%";
  $("w-now-bar").style.width  = pct(w.now);
  $("w-gust-bar").style.width = pct(w.gust);
  drawWind();

  reading($("s-rad"), s.radiation, "W/m²", 0);
  reading($("s-uv"),  s.uv,  "");
  $("s-uv-band").textContent = s.uvBand;
  $("s-uv-band").style.background = "#ef6c00";
  $("s-uv-band").style.color = "#ffffff";
  $("s-rise").textContent = s.rise;
  $("s-set").textContent  = s.set;
  // Trace the arc up to the sun's position, and sit the sun on it.
  const track = $("s-track"), len = track.getTotalLength();
  const done  = $("s-done");
  done.style.strokeDasharray  = len;
  done.style.strokeDashoffset = len * (1 - s.progress);
  const pt = track.getPointAtLength(len * s.progress);
  $("s-sun").setAttribute("cx", pt.x);
  $("s-sun").setAttribute("cy", pt.y);
  $("s-remain-h").textContent = s.remainH;
  $("s-remain-m").textContent = s.remainM;
  $("s-till").textContent = s.till;
  reading($("s-psh"), s.peakSun, "hr");
  $("s-band").textContent = s.band;

  reading($("r-today"),     r.today,     "in", 2);
  reading($("r-yesterday"), r.yesterday, "in", 2);
  reading($("r-month"),     r.month,     "in", 2);
  reading($("r-year"),      r.year,      "in", 2);
  $("r-state").textContent   = r.state;
  $("r-rate").textContent    = fixed(r.rate, 2) + " in/hr";
  // 0 – 2 in/hr across the bar; heavy rain is about 0.3, violent about 2.
  $("r-bar").style.width = Math.min(100, (r.rate || 0) / 2 * 100).toFixed(1) + "%";

  $("b-slp").textContent   = fixed(b.slp, 2);
  reading($("b-low"),  b.low,  "", 2);
  reading($("b-high"), b.high, "", 2);
  $("b-low-at").textContent  = b.lowAt;
  $("b-high-at").textContent = b.highAt;
  $("b-trend").innerHTML   = '<span class="whole">' + b.trend + "</span>";
  $("b-rate").textContent  = (b.rate === null || b.rate === undefined) ? "–"
    : (b.rate < 0 ? "−" : "+") + Math.abs(b.rate).toFixed(3) + " inHg/hr";
  $("b-verdict").textContent = b.verdict;
  drawBarometer();

  $("sg-title").textContent   = sg.title || "Sager Forecast";
  $("sg-weather").textContent = sg.weather;
  $("sg-when").textContent    = sg.when;
  $("sg-dir").textContent     = sg.dir;
  $("sg-force").textContent   = sg.force;
  $("sg-temp").textContent    = sg.temp;
  $("sg-text").textContent    = sg.text;
  $("sg-dial").textContent    = sg.dial;
  $("sg-src").textContent     = sg.src;
  $("sg-at").textContent      = sg.at;

  $("m-phase").textContent = m.phase;
  $("m-illum").textContent = m.illum;
  $("m-rise").textContent  = m.rise;
  $("m-set").textContent   = m.set;
  $("m-full").textContent  = m.full;

  $("l-dist").textContent   = l.dist === null ? "—" : l.dist;
  $("l-dist-u").textContent = l.dist === null ? "" : "mi";
  $("l-when").textContent = l.when;
  // Sources count strikes over different windows; each names its own.
  const dash = (v) => (v === null || v === undefined) ? "–" : v;
  $("l-hour").textContent  = dash(l.hour);
  $("l-today").textContent = dash(l.today);
  $("l-yest").textContent  = dash(l.yesterday);
  $("l-hour-label").textContent  = l.hourLabel  || "Last Hour";
  $("l-today-label").textContent = l.todayLabel || "Today";
  $("l-yest-label").textContent  = l.yestLabel  || "Yesterday";
}

// ── Panel switcher — the three buttons the Pi console has ────────────────
// Sager, Moon and Lightning each swap into the Forecast slot. Pressing the
// lit button again goes back to Forecast, which is what the Pi does.
const PANES = ["forecast", "sager", "moon", "lightning"];

function showPane(name) {
  PANES.forEach((p) => { $("pane-" + p).hidden = (p !== name); });
  PANES.slice(1).forEach((p) => {
    $("btn-" + p).setAttribute("aria-pressed", String(p === name));
  });
  if (name === "moon") drawMoon();
}

PANES.slice(1).forEach((p) => {
  const btn = $("btn-" + p);
  if (!btn) return;
  btn.addEventListener("click", () => {
    showPane($("pane-" + p).hidden ? p : "forecast");
  });
});

// Hand the console a fresh set of values and repaint.
function update(data) {
  DATA = data;
  render();
  // The moon is drawn on demand rather than every refresh, so redraw it
  // here if it is the pane currently on screen.
  if (!$("pane-moon").hidden) drawMoon();
}

window.TempestConsole = { update, tick };
