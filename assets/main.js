/* ------------------------------------------------------------------ *
 * Tempest Web Console - bootstrap
 *
 * Picks a source, paints once, then refreshes on a timer. A failed
 * refresh leaves the last good reading on screen and says so in the
 * footer rather than blanking the console.
 * ------------------------------------------------------------------ */

"use strict";

(function () {
  const cfg = window.CONSOLE_CONFIG || {};
  const mode = cfg.source || "demo";
  const every = Math.max(10, cfg.refreshSeconds || 30) * 1000;
  const note = document.getElementById("note");

  // Header identity.
  if (cfg.station || cfg.location) {
    document.querySelector(".station").innerHTML =
      (cfg.station ? "<b>" + cfg.station + "</b>" : "") +
      (cfg.station && cfg.location ? " &nbsp;·&nbsp; " : "") +
      (cfg.location || "");
  }

  const SOURCES = {
    demo:          () => Sources.demo(),
    tempest:       () => Sources.tempest(cfg),
    homeassistant: () => Sources.homeAssistant(cfg)
  };
  const fetchData = SOURCES[mode] || SOURCES.demo;

  let lastGood = null;

  async function refresh() {
    try {
      const data = await fetchData();
      lastGood = data;
      TempestConsole.update(data);
      const stamp = new Date().toLocaleTimeString("en-US",
        { hour: "numeric", minute: "2-digit", hour12: true });
      note.textContent = mode === "demo"
        ? "Demo values. Copy config.example.js to config.js to read a live station."
        : "Updated " + stamp + " \u00b7 " +
          (mode === "tempest" ? "WeatherFlow Tempest API" : "Home Assistant");
      note.style.color = "";
    } catch (err) {
      console.error(err);
      // A blocked cross-origin request surfaces as a bare "Failed to fetch",
      // which tells the reader nothing. Name the likely cause instead.
      const blocked = /failed to fetch|networkerror|load failed/i.test(err.message);
      const why = blocked
        ? "the browser blocked the request - check the URL, and CORS if the " +
          "page is not served from the same host"
        : err.message;
      note.textContent = lastGood
        ? "Last update failed (" + why + ") - showing the previous reading."
        : "Could not reach the data source: " + why;
      note.style.color = "var(--hot)";
    }
  }

  TempestConsole.tick();
  setInterval(TempestConsole.tick, 1000);

  refresh();
  setInterval(refresh, every);

  // A tablet left on this page sleeps its network; repaint on wake.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
})();
