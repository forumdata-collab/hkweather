# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-09-22

UI/UX overhaul (V2). Data ingestion and the 3D map are preserved; presentation was
split out of the single-file app.

### Added
- HUD with a large current temperature, feels-like, humidity / rain / lightning and a
  natural-language status line generated only from received values.
- Per-dataset freshness timestamps (temperature, rainfall, lightning, forecast) instead
  of one shared "updated" time.
- Compact linear layer switcher (雨量／溫度／體感／閃電／雷暴綜合) replacing the vertical menu.
- 18-district list with per-metric ranking + factual comparisons; selecting a district flies
  the camera and opens its panel.
- Storm track: strongest-rain district 60 / 30 minutes ago versus now, from snapshots.
- Timeline axis labels with real snapshot times and a「回放 60 分」button; historical-only,
  never presented as a forecast.
- Five-tab mobile bottom navigation (地圖／即時／時間軸／警告／更多) and draggable bottom sheets.
- "Data & Methodology" panel: sources, update cadence, feels-like formula, humidity and
  lightning limitations, 3D basemap provenance.
- Per-source status list, retry action, and an offline mode that shows the last known
  values labelled「最後可用資料」.
- PWA: manifest, service worker, app icons.
- Accessibility: keyboard shortcuts, focus-visible outline, `aria-pressed`/`aria-selected`
  state, `aria-live` status, ≥44 px touch targets, `prefers-reduced-motion`, and text labels
  alongside every colour scale.

### Changed
- Colour scales now pair each colour with a level name (小雨／中雨／大雨／暴雨, 清涼→酷熱).
- Mobile HUD collapsed to a pill; the map keeps ~65–75 % of the viewport.
- Service worker fetches the shell network-first — a cache-first shell silently served stale
  JS after deploys.

### Fixed
- `parseLive` announced the payload before `liveData` was populated (cached offline values
  came out null).
- Alert chip now distinguishes 資料中斷 / 離線 from 無警告.

## [1.0.0] - 2026-09-22

First public release.

### Added
- 3D Hong Kong map on Cesium 1.119 — CSDI Lands Department 3D Visualisation Map tiles (real buildings and terrain) over ArcGIS World Imagery, with the tileset zoom-gated below 14 km camera height so its coarse LOD cannot black out the regional view.
- 18 administrative-district polygons (real boundary dataset) used as the weather colour layer; `tools/build_districts.py` regenerates `dist_geo.json`.
- Windy-style layer menu: 雷暴綜合 / 雨量 / 溫度 / 體感溫度 / 閃電, each with its own legend.
- District labels showing the **active layer's** value (`28°`, `12mm`, `71%`, `⚡`) with screen-space collision avoidance so labels never overlap.
- Timeline: R2-stored 5-minute snapshots with scrub and playback, served by the `functions/api/history.js` Pages Function.
- Apparent-temperature (feels-like) layer using the Australian BOM formula, derived per district from district temperature + city humidity.
- Sunrise / sunset / daylight-length from the HKO `SRS` API, plus a day/night terminator toggle driven by the real sun position.
- Mobile-first UI: below 860 px every panel becomes an on-demand bottom sheet opened from three top-right trigger buttons.
- Keyboard shortcuts: `1-5` layers, `Space` play/pause, `L` labels, `D` day/night, `Esc` close sheets.
- `tools/snapshot.py` collector with 7-day retention.

### Notes
- Rainfall and temperature scales are **fixed absolute** scales so colours are comparable across the timeline.
- Snapshots that predate a data field are displayed with an explicit "limited data" note instead of back-filled values.

[1.0.0]: https://github.com/forumdata-collab/hkweather/releases/tag/v1.0.0
