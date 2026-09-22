# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
