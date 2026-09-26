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
    el_.innerHTML = '<span class="whole">–</span>';
    return;
  }
  const r = Number(value.toFixed(decimals));
  const whole = Math.trunc(r);
  const tenth = Math.abs(Math.round(r * 10)) % 10;
  el_.innerHTML =
    '<span class="whole">' + whole + '</span>' +
    (decimals ? '<span class="tenth">.' + tenth + '</span>' : '') +
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
function drawForecastIcon() {
  $("f-icon").innerHTML = `
    <svg viewBox="0 0 64 52" style="width:min(100%,6.4em);height:auto" role="img" aria-label="Partly cloudy">
      <g stroke="#f0a050" stroke-width="3" stroke-linecap="round">
        <line x1="40" y1="3"  x2="40" y2="9"/>
        <line x1="55" y1="9"  x2="51" y2="13"/>
        <line x1="61" y1="23" x2="55" y2="23"/>
        <line x1="25" y1="9"  x2="29" y2="13"/>
      </g>
      <circle cx="40" cy="23" r="9" fill="#f0a050"/>
      <path d="M17 46h26a9 9 0 0 0 .6-18 13 13 0 0 0-24.6 4A8 8 0 0 0 17 46Z"
            fill="#ffffff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
}

// ── Panel switcher — the three buttons the Pi console has ─────────────
const PANES = ["forecast", "sager", "moon", "lightning"];
function showPane(name) {
  PANES.forEach((p) => { $("pane-" + p).hidden = (p !== name); });
  PANES.slice(1).forEach((p) => {
    $("btn-" + p).setAttribute("aria-pressed", String(p === name));
  });
  if (name === "moon") drawMoon();
}
PANES.slice(1).forEach((p) => {
  $("btn-" + p).addEventListener("click", () => {
    showPane($("pane-" + p).hidden ? p : "forecast");
  });
});

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

  $("f-wind").textContent = f.wind;
  $("f-text").textContent = f.text;
  reading($("f-temp"), f.temp, F, 0);
  $("f-low").textContent   = f.low + F;
  $("f-high").textContent  = f.high + F;
  $("f-pop").textContent   = f.pop;
  // The sources supply this with its own unit - a percentage from one, an
  // inch total from another - so it is not given one here.
  $("f-daily").textContent = f.daily;
  $("f-issued").textContent = f.issued;
  drawForecastIcon();

  reading($("t-outdoor"), o.temp, F);
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
  $("t-hum").textContent = o.humidity;
  reading($("t-dew"), o.dew, F);
  $("t-feels-text").textContent = o.feelsText;

  $("w-avg").textContent  = w.avg;
  $("w-max").textContent  = w.max;
  $("w-now").textContent  = w.now;
  $("w-gust").textContent = w.gust;
  $("w-deg").textContent  = w.bearing + "°";
  $("w-spd").textContent  = w.avg;
  $("w-card").textContent = w.cardinalLong;
  $("w-beaufort").textContent = w.beaufort;
  const pct = (v) => Math.max(2, Math.min(100, v / w.scale * 100)).toFixed(0) + "%";
  $("w-now-bar").style.width  = pct(w.now);
  $("w-gust-bar").style.width = pct(w.gust);
  drawWind();

  $("s-rad").textContent = s.radiation;
  $("s-uv").textContent  = s.uv;
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
  $("s-psh").textContent  = s.peakSun;
  $("s-band").textContent = s.band;

  const inch = (v) => (v === null || v === undefined)
    ? '<span class="whole">–</span>'
    : '<span class="whole">' + v.toFixed(2) + '</span><span class="unit">in</span>';
  $("r-today").innerHTML     = inch(r.today);
  $("r-yesterday").innerHTML = inch(r.yesterday);
  $("r-month").innerHTML     = inch(r.month);
  $("r-year").innerHTML      = inch(r.year);
  $("r-state").textContent   = r.state;
  $("r-rate").textContent    = fixed(r.rate, 2) + " in/hr";
  // 0 – 2 in/hr across the bar; heavy rain is about 0.3, violent about 2.
  $("r-bar").style.width = Math.min(100, (r.rate || 0) / 2 * 100).toFixed(1) + "%";

  $("b-slp").textContent   = fixed(b.slp, 2);
  $("b-low").innerHTML     = '<span class="whole">' + fixed(b.low, 2) + "</span>";
  $("b-high").innerHTML    = '<span class="whole">' + fixed(b.high, 2) + "</span>";
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

// Hand the console a fresh set of values and repaint.
function update(data) {
DATA = data;
render();
}

window.TempestConsole = { update, tick };
