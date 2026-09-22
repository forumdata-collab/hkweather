# 香港天氣地圖 3D (HK Weather Map 3D)

> Real-time Hong Kong weather on a 3D Cesium globe — 18-district temperature / rainfall / lightning / feels-like layers, a 3D basemap from the Lands Department, and a 5-minute snapshot timeline you can scrub and replay.

**Live:** https://hkweather.we1co.me

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020)](https://pages.cloudflare.com/)
[![Cesium](https://img.shields.io/badge/Cesium-1.119-48b)](https://cesium.com/)
[![Data](https://img.shields.io/badge/Data-HKO%20Open%20Data%20%2B%20CSDI-blue)](https://data.weather.gov.hk/weatherAPI/doc/HKO_Open_Data_API_Documentation.pdf)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## ✨ Features

| Feature | Implementation detail |
|---|---|
| 3D 香港地圖 | CSDI 地政總署 3D Visualisation Map (Cesium 3D Tiles) for real buildings/terrain; ArcGIS World Imagery as the regional basemap |
| 18 行政區色層 | Real Administrative District Boundary polygons, drawn as Cesium entities and re-coloured per layer |
| 圖層切換 | Segmented control: 雨量 / 溫度 / 體感 / 閃電 / **雷暴綜合** (desktop = right rail, mobile = horizontal scroll bar) |
| 區名 + 數值標籤 | Every district shows its name plus the **active layer's** value (`28°`, `12mm`, `71%`, `⚡`), with screen-space **collision avoidance** |
| 時間軸回放 | R2-stored 5-minute snapshots, scrub or play back; each snapshot restores the full district state |
| 體感溫度 | Australian BOM apparent temperature `AT = T + 0.33e − 4.00`, computed per district from district temperature + city humidity |
| 日出 / 日落 / 日照 | HKO `SRS` API, shown per day in the overview panel |
| 日夜日照 | `globe.enableLighting` + `dynamicAtmosphereLighting` with the real sun position (day/night terminator) |
| 手機優先 UI | Below 860 px: five-tab bottom nav (地圖／即時／時間軸／警告／更多) + **draggable** bottom sheets; the map keeps ~65–75 % of the viewport |
| 鍵盤操作 | `1-5` layers · `Space` play/pause · `L` live · `R` replay last 60 min · `G` legend · `Esc` close |
| 自動更新 | Live data refetched from HKO every 60 s; snapshot timeline every 5 min (both paused while the tab is hidden) |
| 天氣狀況摘要 | Natural-language line generated **only** from received values (警告 / 雨區 / 閃電 / 悶熱 / 穩定) |
| 18 區列表與對比 | Sortable per-metric ranking of the 18 districts + factual extremes (最高／最低氣溫、最多雨量、閃電區域) — no scoring, no invented values |
| 雨區移動 | Storm track built from the snapshot window: where the strongest rain was 60 / 30 min ago vs now |
| 資料時間戳 | Every dataset carries its own observation time (氣溫 22:00 · 雨量 21:45 · 閃電 …) instead of one shared timestamp |
| 資料來源與限制 | In-app methodology panel: HKO endpoints, update cadence, the feels-like formula, single-station humidity caveat, 4-region lightning caveat |
| 錯誤與離線 | Per-source status list + retry; when HKO is unreachable the last known values are shown and labelled「最後可用資料（HH:MM）」 |
| PWA | Installable — manifest + service worker (network-first shell, cached fallback), app icons |

## 🏗 Architecture

The presentation was split from the data/3D layer so UI work cannot break ingestion:

| File | Responsibility |
|---|---|
| `index.html` | Shell markup: HUD, layer switcher, timeline, stat bar, bottom nav, sheets |
| `core.js` | **Data + 3D map layer** — Cesium viewer, CSDI 3D Tiles (zoom-gated), 18-district entities, HKO parsing, feels-like, snapshot timeline, label collision. Emits a `wx:live` event with the raw payload |
| `v2.js` | **UI layer** — HUD, per-dataset timestamps, natural-language status, layer switcher, 18-district list/comparison, storm track, sheets + bottom nav, methodology, offline fallback |
| `styles.css` | All styling, mobile breakpoint at 860 px |
| `sw.js` + `manifest.webmanifest` | PWA shell |
| `functions/api/history.js` | R2 timeline API (rotating edge cache + batched reads) |
| `tools/snapshot.py` | 5-minute R2 snapshot cron (7-day retention) |

`v2.js` overrides the presentation functions `core.js` calls (`updateHud`, `updateTlCount`, `renderInfoBar`, `showDetail`) and must not redeclare the data-layer globals.

## 📡 Data sources

All free, public and CORS-enabled — the browser fetches HKO directly.

| dataType | Provides | Notes |
|---|---|---|
| `rhrread` | 27 station temperatures, **18-district rainfall**, humidity | rainfall is already per-district (no station mapping needed) |
| `fnd` | sea temperature (北角), soil temperature | |
| `flw` | tonight/tomorrow forecast + outlook | |
| `swt` | 特別天氣提示 | |
| `warnsum` | `WTS` thunderstorm warning | banner + toggle badge |
| `LHL` | lightning counts by 4 region | needs `rformat=json` |
| `SRS` | sunrise / sunset / transit | needs `station=HKO&year=&month=&day=` |

Base: `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=X&lang=tc`

3D basemap: CSDI Lands Department 3D Visualisation Map (Cesium 3D Tiles).
District boundaries: Administrative District Boundary of Hong Kong (18 districts, GeoJSON).

## 🏗️ Architecture

```
index.html              single-file app (Cesium via CDN import map, no build step)
dist_geo.json           18 districts: name + centroid + ring coordinates
functions/api/history.js Pages Function → /api/history?date=YYYY-MM-DD  (reads R2)
wrangler.toml           CF Pages config + R2 binding (WX_THUNDER_R2 → bucket wx-thunder)
tools/snapshot.py        cron every 5 min: fetch HKO → compact JSON → R2 snapshots/YYYY-MM-DD/HH-MM.json
tools/build_districts.py regenerates dist_geo.json from the district boundary GeoJSON
```

Snapshot shape (compact — only what the map needs):

```json
{
  "t": "2026-09-22T21:10:02+08:00",
  "ltn": [["港島及九龍", "true"]],
  "wts": { "code": "WTS", "actionCode": "EXTEND", "expireTime": "..." },
  "rain": [["流浮山", "0"]],
  "rmax": [["中西區", 0]],
  "temp": [["京士柏", 27]],
  "hum":  [["香港天文台", 73]],
  "lhl":  [["雲對地", "新界東", 12]],
  "sea":  { "place": "北角", "value": 27 },
  "soil": [{ "place": "香港天文台", "value": 30.1 }]
}
```

Retention: 7 days (`snapshot.py` purges older date prefixes).

**設計取捨（刻意保留）**
- **Fixed (absolute) colour scales** — a colour must mean the same value across the whole timeline, otherwise replaying snapshots is unreadable. The legend says so explicitly.
- **The CSDI tileset is zoom-gated** (`show` only below 14 km camera height): its coarse LOD renders black at regional zoom and would hide the imagery.
- **Old snapshots are never back-filled.** Snapshots predating a field are shown with an explicit in-panel note and a `⚠ 僅雨量` marker rather than fabricated values.
- **Humidity is not a per-district layer** — HKO reports it from a single station, so it lives in the overview/detail panels instead of pretending to be a map layer.

## 🧪 Testing

Manual browser checks (the app is a single static file — open `index.html` after `python3 -m http.server`):

```bash
# data endpoints reachable + shaped as expected
curl -s 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['temperature']['data']),'temp stations'); print(len(d['rainfall']['data']),'districts')"

# district geometry integrity
python3 -c "import json; g=json.load(open('dist_geo.json')); print(len(g['districts']),'districts'); assert len(g['districts'])==18"

# timeline API (after deploy)
curl -s 'https://hkweather.we1co.me/api/history?latest=1' | head -c 200

# 3D basemap tileset reachable
curl -s -o /dev/null -w '%{http_code}\n' 'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json?key=3967f8f365694e0798af3e7678509421'
```

Expected: 27 temp stations, 18 rainfall districts, 18 districts in `dist_geo.json`, HTTP 200 for the tileset.

## 🚀 Deploy

Cloudflare Pages project `wx-thunder`, custom domain `hkweather.we1co.me`.

```bash
export CLOUDFLARE_API_TOKEN=...      # token with Pages + R2 permissions
export CLOUDFLARE_ACCOUNT_ID=...
wrangler pages deploy . --project-name=wx-thunder --branch=main
```

The R2 binding must be attached to the project once:

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/wx-thunder" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  --data '{"deployment_configs":{"production":{"r2_buckets":{"WX_THUNDER_R2":{"name":"wx-thunder"}}}}}'
```

Snapshot collector (cron, every 5 minutes):

```bash
# .env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
*/5 * * * * set -a && . ~/.hermes/.env && set +a && /usr/bin/python3 /path/to/tools/snapshot.py
```

## 📜 License

MIT — see [LICENSE](LICENSE).

Weather data © Hong Kong Observatory (HKO Open Data). 3D map © The Government of the Hong Kong SAR (Lands Department, via CSDI). District boundaries from the public Administrative District Boundary dataset. This is an **unofficial** project and is not affiliated with the HKO or the Lands Department; always refer to official HKO warnings for safety-critical decisions.

---

See [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md)
