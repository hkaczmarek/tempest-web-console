/* ------------------------------------------------------------------ *
 * Tempest Web Console - configuration
 *
 * Copy this file to  config.js  and edit it. config.js is gitignored,
 * because it holds a long-lived access token.
 *
 * Leave source as "demo" to see the console without connecting
 * anything.
 * ------------------------------------------------------------------ */

window.CONSOLE_CONFIG = {

  // "demo" or "homeassistant"
  source: "homeassistant",

  // Shown in the header bar.
  station:  "Tempest ST-00222100",
  location: "Canyon Country, CA",

  // How often to re-read the station, in seconds. The Tempest itself
  // reports about every minute, so there is nothing to gain below 30.
  refreshSeconds: 30,

  // Home Assistant's address as this browser reaches it. Leave as ""
  // when the console is served from Home Assistant itself (that is,
  // from /config/www/), so requests stay same-origin and no CORS
  // configuration is needed.
  baseUrl: "",

  // Profile -> Security -> Long-lived access tokens -> Create token.
  // Read the security note in the README before putting one here.
  token: "PASTE_YOUR_LONG_LIVED_ACCESS_TOKEN_HERE",

  /* ── Entities ──────────────────────────────────────────────────────
   * The defaults below are the WeatherFlow Forecast (ws_core)
   * integration's naming, with the station named "Wren Dr". Yours will
   * differ. In Home Assistant, Developer Tools -> States and filter on
   * your station's name to find them.
   *
   * Any entity may be set to null; its panel degrades to an en dash
   * rather than failing.
   * -------------------------------------------------------------- */
  entities: {

    // Temperature panel
    temperature:  "sensor.wren_dr_temperature",
    feelsLike:    "sensor.wren_dr_feels_like",
    humidity:     "sensor.wren_dr_relative_humidity",
    dewPoint:     "sensor.wren_dr_dew_point",

    // Wind panel
    windSpeed:     "sensor.wren_dr_wind_speed",
    windSpeedAvg:  "sensor.wren_dr_wind_speed_avg",
    windGust:      "sensor.wren_dr_wind_gust",
    windDirection: "sensor.wren_dr_wind_direction",

    // Solar panel
    solarRadiation: "sensor.wren_dr_solar_radiation",
    uvIndex:        "sensor.wren_dr_uv_index",
    sun:            "sun.sun",

    // Rainfall panel. Month and year totals are not produced by the
    // integration; point these at utility_meter helpers if you keep
    // them, or leave them null and the console shows a dash.
    precipitationToday:     "sensor.wren_dr_precipitation_today",
    precipitationYesterday: "sensor.wren_dr_precipitation_yesterday",
    precipitationRate:      "sensor.st_00222100_precipitation_intensity",
    precipitationMonth:     null,
    precipitationYear:      null,

    // Barometer panel. This must be SEA LEVEL pressure - the station's
    // raw "air pressure" reads roughly 1.7 inHg low at 1,600 feet and
    // the dial will sit pinned at Stormy if you use it.
    pressureSeaLevel: "sensor.wren_dr_pressure_sea_level",

    // Forecast panel
    weather: "weather.wren_dr",

    // Sager panel, from the zambretti_sager custom integration.
    // https://github.com/ziffmafiya/zambretti_sager
    sager: "sensor.weather_station_sager_forecast",

    // Lightning panel
    lightningLastStrike:    "sensor.wren_dr_lightning_last_strike",
    lightningLastDistance:  "sensor.wren_dr_lightning_last_distance",
    lightningCount:         "sensor.wren_dr_lightning_count",
    lightningCountHour:     "sensor.wren_dr_lightning_count_last_1_hr",
    lightningCountYesterday: null
  }
};
