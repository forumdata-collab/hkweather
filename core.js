/* ========== Cesium viewer ========== */
const viewer = new Cesium.Viewer('cesium', {
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, animation: false,
  timeline: false, fullscreenButton: false, infoBox: false,
  selectionIndicator: false, shadows: false,
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer')
  ),
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
});
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0d2547');
viewer.scene.skyAtmosphere.show = true;
viewer.scene.fog.enabled = true;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 150000;
viewer.scene.globe.depthTestAgainstTerrain = false;

/* ========== CSDI 3D Hong Kong (real buildings & terrain tiles) ==========
   Note: CSDI's coarse LOD tiles render black at regional zoom levels, so the
   tileset is only shown when the camera is closer than TILESET_MAX_HEIGHT. */
const TILESET_MAX_HEIGHT = 14000;
let hkTileset = null;
Cesium.Cesium3DTileset.fromUrl(
  'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json?key=3967f8f365694e0798af3e7678509421',
  { maximumScreenSpaceError: 8 }
).then(ts => {
  hkTileset = ts;
  ts.show = viewer.camera.positionCartographic.height < TILESET_MAX_HEIGHT;
  viewer.scene.primitives.add(ts);
  hideLoading();
}).catch(e => {
  console.warn('3D tileset load failed:', e);
  hideLoading('3D 圖層載入失敗，仍可查看天氣數據');
});
setTimeout(() => hideLoading(), 12000);

/* show 3D buildings only when zoomed in (avoids black coarse LOD at far zoom) */
viewer.camera.changed.addEventListener(() => {
  if (!hkTileset) return;
  const h = viewer.camera.positionCartographic.height;
  const shouldShow = h < TILESET_MAX_HEIGHT;
  if (hkTileset.show !== shouldShow) hkTileset.show = shouldShow;
});

// Fly to HK overview
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(114.1694, 22.3193, 70000),
  orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO + 0.15, roll: 0 },
  duration: 1.5
});

/* hide loading overlay when 3D tiles are ready (or after 12s timeout) */
let loadingHidden = false;
function hideLoading(msg) {
  if (loadingHidden) return;
  loadingHidden = true;
  const el = document.getElementById('loading');
  if (msg) document.getElementById('ldSub').textContent = msg;
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.style.display = 'none', 700);
  }, msg ? 300 : 0);
}

/* ========== 18-district GeoJSON overlay (weather coloring) ========== */
let districtEntities = [];   // {name, entity, labelEntity, cx, cy}
let labelEntities = [];
let showLabels = true;
let sunOn = false;
let dist_geo_names = [];
let mode = 'thunder';

async function loadDistricts() {
  const resp = await fetch('dist_geo.json', {cache:'no-store'});
  const geo = await resp.json();
  dist_geo_names = geo.districts.map(d => d.tc);
  geo.districts.forEach(d => {
    const positions = [];
    d.rings.forEach(ring => {
      ring.forEach(([lon, lat]) => positions.push(Cesium.Cartesian3.fromDegrees(lon, lat)));
    });
    const entity = viewer.entities.add({
      polygon: {
        hierarchy: positions,
        material: Cesium.Color.fromCssColorString('rgba(30,58,95,0.5)'),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('rgba(120,180,255,0.35)'),
        height: 0,
        classificationType: Cesium.ClassificationType.BOTH,
      }
    });
    entity._wxName = d.tc;
    // district label (name + temp) at centroid
    const labelEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(d.cx, d.cy, 60),
      label: {
        text: d.tc,
        font: 'bold 12px "PingFang TC","Microsoft JhengHei",sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.95)'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(15000, 1.0, 250000, 0.85),
        pixelOffset: new Cesium.Cartesian2(0, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(10,14,26,0.62)'),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
      },
      show: showLabels,
    });
    labelEntity._wxName = d.tc;
    labelEntities.push(labelEntity);
    districtEntities.push({name: d.tc, entity, labelEntity, cx: d.cx, cy: d.cy});
  });
  applyColors();
}
loadDistricts();

/* ========== Live weather ========== */
const liveData = {};   // district -> {rain, lightning, lhl, temp, hum}
let WTS = null;
let infoCache = {};    // {maxTemp, minTemp, hum, sea, soil, rainMax}

const TEMP2DIST = {
  '香港天文台':'中西區','京士柏':'油尖旺','黃竹坑':'南區','打鼓嶺':'北區',
  '流浮山':'元朗','大埔':'大埔','沙田':'沙田','屯門':'屯門','將軍澳':'觀塘',
  '西貢':'西貢','長洲':'離島','赤鱲角':'離島','坪洲':'離島','青衣':'葵青',
  '石崗':'元朗','荃灣可觀':'荃灣','荃灣城門谷':'荃灣','上水':'北區','元朗公園':'元朗',
  '大美督':'大埔','塔門':'大埔','深水埗':'深水埗','九龍城':'九龍城','黃大仙':'黃大仙',
  '觀塘':'觀塘','油麻地':'油尖旺','旺角':'油尖旺','尖沙咀':'油尖旺','中環碼頭':'中西區',
  '上環':'中西區','灣仔':'灣仔','鰂魚涌':'東區','北角':'東區','筲箕灣':'東區','赤柱':'南區',
  '南朗山':'南區','香港公園':'中西區','山頂':'中西區','大老山':'沙田','昂坪':'離島',
  '滘西洲':'西貢','北潭涌':'西貢','濕地公園':'元朗','水邊圍':'元朗','大埔墟':'大埔',
  // 灣仔區：唯一站係跑馬地（Happy Valley）
  '跑馬地':'灣仔','摩理臣山':'灣仔','銅鑼灣':'灣仔',
  '啟德跑道公園':'九龍城','馬鞍山':'沙田','大圍':'沙田','紅磡':'九龍城',
  '橫瀾島':'離島','北潭坳':'西貢','西貢竹角':'西貢',
};
/* 天文台區名 → geojson 區名 alias（天文台部分區名帶「區」字尾） */
const DISTRICT_ALIAS = {
  '離島區':'離島','灣仔區':'灣仔','油尖旺區':'油尖旺','深水埗區':'深水埗',
  '九龍城區':'九龍城','黃大仙區':'黃大仙','觀塘區':'觀塘','葵青區':'葵青',
  '荃灣區':'荃灣','屯門區':'屯門','元朗區':'元朗','北區':'北區','大埔區':'大埔',
  '沙田區':'沙田','西貢區':'西貢','東區':'東區','南區':'南區','中西區':'中西區',
};
function normD(name) {
  if (!name) return null;
  if (DISTRICT_ALIAS[name]) return DISTRICT_ALIAS[name];
  // strip trailing 區 if the base name exists (e.g. 離島區 → 離島)
  if (name.endsWith('區')) {
    const base = name.slice(0, -1);
    if (DISTRICT_ALIAS[base] || DISTRICT_ALIAS[base + '區']) return DISTRICT_ALIAS[base + '區'] || base;
  }
  return name;
}
function temp2district(name) { return TEMP2DIST[name] || null; }

const REGION_DISTRICTS = {
  '港島及九龍': ['中西區','灣仔','東區','南區','油尖旺','深水埗','九龍城','黃大仙','觀塘'],
  '新界東': ['沙田','大埔','北區','西貢'],
  '新界西': ['荃灣','屯門','元朗','葵青'],
  '離島': ['離島'],
};
function districtsInRegion(r) { return REGION_DISTRICTS[r] || []; }

const STN2DIST = {
  '香港天文台':'中西區','香港公園':'中西區','山頂':'中西區','上環':'中西區','中環碼頭':'中西區',
  '灣仔':'灣仔','黃竹坑':'南區','赤柱':'南區','南朗山':'南區','鰂魚涌':'東區','筲箕灣':'東區','北角':'東區',
  '油麻地':'油尖旺','旺角':'油尖旺','尖沙咀':'油尖旺','京士柏':'油尖旺','深水埗':'深水埗',
  '九龍城':'九龍城','黃大仙':'黃大仙','觀塘':'觀塘','將軍澳':'觀塘','啟德跑道公園':'九龍城','紅磡':'九龍城',
  '沙田':'沙田','大老山':'沙田','馬鞍山':'沙田','大圍':'沙田',
  '大埔':'大埔','大美督':'大埔','打鼓嶺':'北區','上水':'北區','石崗':'元朗','天水圍':'元朗','流浮山':'元朗','元朗公園':'元朗',
  '屯門':'屯門','大欖涌':'屯門','荃灣':'荃灣','青衣':'葵青','葵涌':'葵青','機場':'葵青','石蔭':'葵青',
  '西貢':'西貢','滘西洲':'西貢','北潭涌':'西貢','坪洲':'離島','長洲':'離島','昂坪':'離島','大嶼山':'離島','赤鱲角':'離島','塔門':'大埔',
};
function stationDistrict(name) {
  if (!name) return null;
  if (STN2DIST[name]) return STN2DIST[name];
  return normD(name);  // fall back to district alias (HKO sometimes returns district names directly)
}

function parseLive(raw) {
  if (!raw) return;
  // district-level rainfall (rhrread rainfall.data — 18 districts direct!)
  const rmax = raw.rhrread?.rainfall?.data || [];
  rmax.forEach(s => {
    const d = normD(s.place);  // HKO may use 離島區 while geojson uses 離島
    if (!d) return;
    const v = s.max === 'M' ? 0 : +s.max;
    liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
    liveData[d].rain = v;
  });
  // temperature stations -> district
  const temps = raw.rhrread?.temperature?.data || [];
  let tmax = null, tmin = null;
  temps.forEach(s => {
    const d = temp2district(s.place);
    if (!d) return;
    const v = +s.value;
    liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
    liveData[d].temp = v;
    if (tmax === null || v > tmax) tmax = v;
    if (tmin === null || v < tmin) tmin = v;
  });
  // fallback: districts without a station (e.g. 灣仔 when 跑馬地 offline) get the HK average
  const allD = (dist_geo_names || []);
  const tempVals = Object.values(liveData).map(x => x.temp).filter(v => v !== undefined);
  if (allD.length && tempVals.length) {
    const avg = Math.round(tempVals.reduce((a,b)=>a+b,0) / tempVals.length);
    allD.forEach(d => {
      liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
      if (liveData[d].temp === undefined) { liveData[d].temp = avg; liveData[d].tempEst = true; }
    });
  }
  // humidity
  const hums = raw.rhrread?.humidity?.data || [];
  let humSum = 0, humN = 0;
  hums.forEach(s => {
    const d = temp2district(s.place) || s.place;
    const v = +s.value;
    if (isNaN(v)) return;
    humSum += v; humN++;
    if (d && liveData[d]) liveData[d].hum = v;
  });
  // sea & soil temp (fnd)
  const fnd = raw.fnd || {};
  let sea = null, soil = null;
  if (fnd.seaTemp) sea = fnd.seaTemp.value;
  if (Array.isArray(fnd.soilTemp) && fnd.soilTemp.length) soil = fnd.soilTemp[0].value;
  // rain max district
  let rainMaxD = null, rainMaxV = 0;
  Object.keys(liveData).forEach(k => {
    if ((liveData[k].rain || 0) > rainMaxV) { rainMaxV = liveData[k].rain; rainMaxD = k; }
  });
  infoCache = {
    maxTemp: tmax, minTemp: tmin,
    hum: humN ? Math.round(humSum / humN) : null,
    sea, soil,
    rainMaxD, rainMaxV,
    rainChecked: true,
    limited: false,
  };
  /* 體感溫度 (apparent temperature, Australian BOM, calm wind)
     = T + 0.33*e - 4.00,  e = (RH/100) * 6.105 * exp(17.27T/(237.7+T))
     Per-district because temperature is per-district; humidity is city-wide. */
  const cityHum = infoCache.hum;
  if (cityHum) {
    Object.keys(liveData).forEach(k => {
      const t = liveData[k].temp;
      if (t === undefined) return;
      const e = (cityHum / 100) * 6.105 * Math.exp(17.27 * t / (237.7 + t));
      liveData[k].feels = Math.round(t + 0.33 * e - 4.0);
    });
  }
  const ltn = raw.rhrread?.lightning?.data || [];
  ltn.forEach(l => {
    if (l.occur === 'true') {
      districtsInRegion(l.place).forEach(d => {
        liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
        liveData[d].lightning = true;
      });
    }
  });
  const lhl = raw.lhl?.data || [];
  lhl.forEach(row => {
    if (row.length < 4) return;
    const [, type, region, cnt] = row;
    if (type !== '雲對地') return;
    districtsInRegion(region).forEach(d => {
      liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
      liveData[d].lhl += +cnt;
    });
  });
  const w = raw.warnsum?.WTS;
  if (w && w.code === 'WTS') WTS = w;

  /* v2 hook: announce the payload AFTER liveData/infoCache are populated, so
     the UI layer can read the parsed values (not empty ones) plus the raw
     per-dataset timestamps. */
  window.__wxRaw = raw;
  document.dispatchEvent(new CustomEvent('wx:live', { detail: raw }));
}

/* compact snapshot parser (from R2 timeline) */
function parseSnapCompact(snap) {
  if (!snap) return;
  (snap.ltn || []).forEach(([place, occur]) => {
    if (occur === 'true') {
      districtsInRegion(place).forEach(d => {
        liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
        liveData[d].lightning = true;
      });
    }
  });
  (snap.rmax || []).forEach(([d0, val]) => {
    const d = normD(d0);
    if (!d) return;
    const v = val === 'M' ? 0 : +val;
    liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
    liveData[d].rain = v;
  });
  (snap.rain || []).forEach(([stn, val]) => {
    if (liveData[stn] && liveData[stn].rain) return;  // rmax already covers districts
    const d = stationDistrict(stn);
    if (!d) return;
    const v = val === 'M' ? 0 : +val;
    liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
    if (!liveData[d].rain) liveData[d].rain = v;
  });
  (snap.temp || []).forEach(([stn, val]) => {
    const d = temp2district(stn);
    if (!d) return;
    liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
    liveData[d].temp = +val;
  });
  (snap.hum || []).forEach(([stn, val]) => {
    const d = temp2district(stn) || stn;
    if (liveData[d]) liveData[d].hum = +val;
  });
  (snap.lhl || []).forEach(([type, region, cnt]) => {
    if (type !== '雲對地') return;
    districtsInRegion(region).forEach(d => {
      liveData[d] = liveData[d] || {rain:0, lightning:false, lhl:0};
      liveData[d].lhl += +cnt;
    });
  });
  WTS = snap.wts || null;
  // info cache from snapshot
  const temps = (snap.temp || []).map(([stn, v]) => +v).filter(v => !isNaN(v));
  let tmax = temps.length ? Math.max(...temps) : null;
  let tmin = temps.length ? Math.min(...temps) : null;
  let sea = snap.sea ? snap.sea.value : null;
  let soil = Array.isArray(snap.soil) && snap.soil.length ? snap.soil[0].value : null;
  const hums = (snap.hum || []).map(([stn, v]) => +v).filter(v => !isNaN(v));
  const raws = Object.entries(liveData).map(([k, v]) => [k, v.rain || 0]).sort((a,b) => b[1]-a[1]);
  const hasTemp = !!(snap.temp && snap.temp.length);
  infoCache = {
    maxTemp: tmax, minTemp: tmin,
    hum: hums.length ? Math.round(hums.reduce((a,b)=>a+b,0)/hums.length) : null,
    sea, soil,
    rainMaxD: raws.length && raws[0][1] > 0 ? raws[0][0] : null,
    rainMaxV: raws.length ? raws[0][1] : 0,
    rainChecked: true,
    limited: !hasTemp,                       // old-format snapshot
    snapTime: (snap.t || '').slice(11, 16),
  };
  // apparent temperature for snapshots too (needs per-district temp + city humidity)
  if (infoCache.hum) {
    Object.keys(liveData).forEach(k => {
      const t = liveData[k].temp;
      if (t === undefined) return;
      const e = (infoCache.hum / 100) * 6.105 * Math.exp(17.27 * t / (237.7 + t));
      liveData[k].feels = Math.round(t + 0.33 * e - 4.0);
    });
  }
}

/* severity color */
function severity(d) {
  const data = liveData[d] || {};
  if (mode === 'feels') {
    const f = data.feels;
    if (f === undefined) return 'rgba(30,58,95,0.35)';
    if (f >= 40) return 'rgba(220,38,38,0.82)';   // 酷熱
    if (f >= 36) return 'rgba(239,68,68,0.76)';
    if (f >= 33) return 'rgba(255,217,61,0.72)';
    if (f >= 30) return 'rgba(255,160,80,0.68)';
    if (f >= 27) return 'rgba(253,126,40,0.6)';
    return 'rgba(78,168,222,0.6)';
  }
  if (mode === 'humidity') {
    const h = data.hum !== undefined ? data.hum : (infoCache.hum || null);
    if (h === null) return 'rgba(30,58,95,0.35)';
    if (h >= 90) return 'rgba(139,92,246,0.72)';
    if (h >= 80) return 'rgba(59,130,246,0.7)';
    if (h >= 70) return 'rgba(34,211,238,0.68)';
    if (h >= 60) return 'rgba(132,204,22,0.65)';
    return 'rgba(251,191,36,0.65)';
  }
  if (mode === 'temp') {
    const t = data.temp;
    if (t === undefined) return 'rgba(30,58,95,0.35)';
    if (t >= 32) return 'rgba(239,68,68,0.75)';
    if (t >= 30) return 'rgba(255,217,61,0.72)';
    if (t >= 28) return 'rgba(255,160,80,0.7)';
    if (t >= 26) return 'rgba(253,126,40,0.62)';
    if (t >= 24) return 'rgba(78,168,222,0.6)';
    return 'rgba(59,130,246,0.55)';
  }
  if (mode === 'thunder') {
    if (data.lightning) return 'rgba(239,68,68,0.72)';
    if (data.lhl > 0) return 'rgba(168,85,247,0.7)';
    if (data.rain > 50) return 'rgba(239,68,68,0.75)';
    if (data.rain > 7.5) return 'rgba(255,217,61,0.7)';
    if (data.rain > 2.5) return 'rgba(87,204,153,0.68)';
    if (data.rain > 0) return 'rgba(78,168,222,0.65)';
    return 'rgba(30,58,95,0.45)';
  }
  if (mode === 'rain') {
    const r = data.rain || 0;
    if (r > 50) return 'rgba(239,68,68,0.8)';
    if (r > 7.5) return 'rgba(255,217,61,0.75)';
    if (r > 2.5) return 'rgba(87,204,153,0.72)';
    if (r > 0) return 'rgba(78,168,222,0.7)';
    return 'rgba(30,58,95,0.45)';
  }
  if (data.lightning) return 'rgba(255,217,61,0.75)';
  if (data.lhl > 5) return 'rgba(168,85,247,0.72)';
  return 'rgba(30,58,95,0.45)';
}

/* label text follows the ACTIVE layer (not always temperature) */
function labelText(name, data) {
  const d = data || {};
  if (mode === 'temp') {
    if (d.temp !== undefined) return `${name} ${d.temp}°${d.tempEst ? '*' : ''}`;
    // older snapshots carry rainfall only — show that instead of a useless dash
    if (d.rain !== undefined) return `${name} ${d.rain}mm`;
    return `${name} —`;
  }
  if (mode === 'rain') {
    return `${name} ${d.rain ? d.rain + 'mm' : '0'}`;
  }
  if (mode === 'feels') {
    if (d.feels !== undefined) return `${name} ${d.feels}°`;
    if (d.rain !== undefined) return `${name} ${d.rain}mm`;
    return `${name} —`;
  }
  if (mode === 'humidity') {
    const h = d.hum !== undefined ? d.hum : (infoCache.hum || null);
    return h ? `${name} ${h}%` : `${name} —`;
  }
  if (mode === 'lightning') {
    if (d.lightning) return `${name} ⚡ 有`;
    return d.lhl ? `${name} ${d.lhl}次` : `${name} —`;
  }
  // thunder composite: temperature + active alert marker
  let s = d.temp !== undefined ? d.temp + '°' + (d.tempEst ? '*' : '') : '';
  if (d.lightning) s += ' ⚡';
  else if (d.rain > 0) s += ' ' + d.rain + 'mm';
  if (!s && d.rain !== undefined) s = d.rain + 'mm';
  return s ? `${name} ${s}` : name;
}

let currentDetail = null;
function applyColors() {
  districtEntities.forEach(({name, entity, labelEntity}) => {
    entity.polygon.material = Cesium.Color.fromCssColorString(severity(name));
    if (labelEntity) {
      const data = liveData[name] || {};
      const hasData = data.temp !== undefined || data.rain !== undefined || data.lightning || data.lhl;
      labelEntity.label.text = labelText(name, data);
      labelEntity.label.fillColor = hasData
        ? Cesium.Color.WHITE
        : Cesium.Color.fromCssColorString('rgba(255,255,255,0.55)');
      // mark estimated values visually
      labelEntity.label.font = data.tempEst
        ? 'italic bold 12px "PingFang TC","Microsoft JhengHei",sans-serif'
        : 'bold 12px "PingFang TC","Microsoft JhengHei",sans-serif';
    }
  });
  // keep the open detail panel in sync with refreshed data
  if (detailPanel && detailPanel.classList.contains('sheet-open') && currentDetail) {
    showDetail(currentDetail);
  }
  scheduleLabelUpdate();
}

/* ========== Label collision avoidance (hide overlapping labels) ========== */
let labelUpdateTimer = null;
let labelUpdateScheduled = false;
function scheduleLabelUpdate() {
  if (labelUpdateScheduled) return;
  labelUpdateScheduled = true;
  clearTimeout(labelUpdateTimer);
  labelUpdateTimer = setTimeout(() => { labelUpdateScheduled = false; updateLabelCollision(); }, 160);
}
function screenPos(lon, lat) {
  const ST = Cesium.SceneTransforms;
  const fn = ST.wgs84ToWindowCoordinates || ST.worldToWindowCoordinates;
  try {
    return fn.call(ST, viewer.scene, Cesium.Cartesian3.fromDegrees(lon, lat, 60));
  } catch(e) { return null; }
}
function updateLabelCollision() {
  if (!districtEntities.length) return;
  if (!showLabels) { labelEntities.forEach(e => e.show = false); return; }
  const items = [];
  districtEntities.forEach(({name, labelEntity, cx, cy}) => {
    if (!labelEntity) return;
    const win = screenPos(cx, cy);
    if (!win) { labelEntity.show = false; return; }
    const d = liveData[name] || {};
    // priority: lightning > heavy rain > extreme temp
    let prio = 0;
    if (d.lightning) prio += 1000;
    if (d.lhl) prio += Math.min(d.lhl, 300) + 200;
    if (d.rain) prio += d.rain * 8;
    if (d.temp !== undefined) prio += Math.abs(d.temp - 26) * 3;
    items.push({labelEntity, x: win.x, y: win.y, prio, name});
  });
  items.sort((a, b) => b.prio - a.prio);
  // text width estimate: 區名 (up to 4 CJK chars) + temp ≈ 56-78px wide, 18px tall
  const placed = [];
  items.forEach(it => {
    const label = it.labelEntity.label;
    const txt = label.text ? label.text.getValue() : '';
    const w = Math.min(96, 22 + (txt.length * 9));
    const clash = placed.some(p =>
      Math.abs(p.x - it.x) < (p.w + w) / 2 + 4 &&
      Math.abs(p.y - it.y) < 19
    );
    it.labelEntity.show = !clash;
    if (!clash) placed.push({x: it.x, y: it.y, w});
  });
}

/* ========== Auto-refresh live from HKO ========== */
async function fetchLive() {
  const ts = Date.now();
  const nowHK = new Date(Date.now() + 8 * 3600 * 1000);
  const y = nowHK.getUTCFullYear(), m = nowHK.getUTCMonth() + 1, d = nowHK.getUTCDate();
  const [rhr, warn, rain, lhl, fnd, flw, swt, srs] = await Promise.all([
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=LHL&lang=tc&rformat=json&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=flw&lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=swt&lang=tc&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
    fetch(`https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=SRS&lang=tc&rformat=json&station=HKO&year=${y}&month=${m}&day=${d}&_=${ts}`, {cache:'no-store'}).then(r=>r.json()).catch(()=>null),
  ]);
  return {rhrread: rhr, warnsum: warn, rainfall: rain, lhl, fnd, flw, swt, srs};
}

async function refresh() {
  let raw;
  try {
    raw = await fetchLive();
  } catch(e) {
    try { raw = await fetch('live.json', {cache:'no-store'}).then(r=>r.json()); } catch(e2) { return; }
  }
  parseLive(raw);
  setForecastSwt(raw);
  applyColors();
  updateHud();
  renderInfoBar();
}
function updateHud() {
  const ts = new Date().toLocaleTimeString('zh-HK',{hour:'2-digit',minute:'2-digit'});
  const bar = document.getElementById('warnBar');
  // badge on the forecast toggle whenever a warning is in force (mobile has no visible panel)
  const badge = document.getElementById('tgForecastBadge');
  if (badge) badge.style.display = WTS ? 'block' : 'none';
  document.body.classList.toggle('has-warn', !!WTS);
  if (WTS) {
    bar.style.display='block';
    bar.textContent = `⛈️ 雷暴警告 — ${WTS.actionCode==='EXTEND'?'延長':WTS.actionCode} 有效至 ${new Date(WTS.expireTime).toLocaleTimeString('zh-HK')} · 天文台`;
    document.getElementById('hudTime').textContent = `更新 ${ts} · 🔴 雷暴警告生效中`;
  } else {
    bar.style.display='none';
    document.getElementById('hudTime').textContent = `更新 ${ts} · 🟢 暫無雷暴警告`;
  }
}

/* forecast + SWT + sun panels */
let forecastCache = null, swtCache = null, sunCache = null;
function renderForecast() {
  const bar = document.getElementById('forecastBar');
  if (!forecastCache) { bar.classList.remove('has-data'); return; }
  bar.classList.add('has-data');
  document.getElementById('fbPeriod').textContent = '🗓️ ' + forecastCache.period;
  document.getElementById('fbDesc').innerHTML = '<span class="fb-label">明日：</span>' + forecastCache.desc;
  document.getElementById('fbOutlook').textContent = '📈 ' + forecastCache.outlook;
}
function renderSWT() {
  const bar = document.getElementById('swtBar');
  if (!swtCache || !swtCache.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.textContent = '💡 特別天氣提示：' + swtCache.map(s => s.advice || '').join('；');
}
function setForecastSwt(raw) {
  if (raw?.flw) {
    forecastCache = {
      period: raw.flw.forecastPeriod || '',
      desc: raw.flw.forecastDesc || '',
      outlook: raw.flw.outlook || '',
    };
  }
  if (raw?.swt?.swt && Array.isArray(raw.swt.swt)) swtCache = raw.swt.swt;
  // sunrise / sunset / day length (HKO SRS)
  if (raw?.srs?.data && raw.srs.data.length) {
    const row = raw.srs.data[0];   // [YYYY-MM-DD, RISE, TRANSIT, SET]
    const rise = row[1], set = row[3];
    sunCache = { rise, set, transit: row[2], daylen: dayLength(rise, set) };
  }
  renderForecast();
  renderSWT();
  renderSun();
}
/* 日照時長 = 日落 - 日出 */
function dayLength(rise, set) {
  if (!rise || !set) return null;
  const [rh, rm] = rise.split(':').map(Number);
  const [sh, sm] = set.split(':').map(Number);
  let mins = (sh * 60 + sm) - (rh * 60 + rm);
  if (mins < 0) mins += 1440;
  return `${Math.floor(mins / 60)}小時${String(mins % 60).padStart(2, '0')}分`;
}
function renderSun() {
  const c = sunCache || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ibSunrise', c.rise || '—');
  set('ibSunset', c.set || '—');
  set('ibDaylen', c.daylen || '—');
}
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
/* a hidden tab must not keep polling (each timeline poll = one R2 read burst) */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  refresh();
  if (typeof loadTimeline === 'function') loadTimeline();
});

/* ========== Timeline playback ========== */
const tlSlider = document.getElementById('tlSlider');
const tlTime = document.getElementById('tlTime');
const tlCount = document.getElementById('tlCount');
const tlPlay = document.getElementById('tlPlay');
const tlLiveBtn = document.getElementById('tlLive');
let tlSnapshots = [], tlIdx = -1, tlPlaying = false, tlTimer = null;
let tlPlaySeq = [];          // indices that actually carry data for the active layer

/* does this snapshot carry data for the given layer? */
function snapHasData(snap, m) {
  if (!snap) return false;
  if (m === 'temp' || m === 'feels') return !!(snap.temp && snap.temp.length);
  if (m === 'humidity') return !!(snap.hum && snap.hum.length);
  if (m === 'rain') return !!((snap.rmax && snap.rmax.length) || (snap.rain && snap.rain.length));
  if (m === 'lightning') return !!((snap.ltn && snap.ltn.length) || (snap.lhl && snap.lhl.length));
  return true;   // thunder composite accepts any snapshot
}
function playableIndices(m) {
  return tlSnapshots.map((s, i) => i).filter(i => snapHasData(tlSnapshots[i], m));
}
/* keep the counter in sync with the active layer's real coverage */
function updateTlCount() {
  const total = tlSnapshots.length;
  if (!total) return;
  const avail = playableIndices(mode).length;
  const full = tlSnapshots.filter(s => s.temp && s.temp.length).length;
  if (avail === total) {
    tlCount.textContent = `${total} 個快照`;
  } else {
    tlCount.textContent = `${total} 個快照（此圖層 ${avail} 個可播）`;
  }
  tlCount.title = `共 ${total} 個快照，其中 ${full} 個含溫度數據`;
}
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function todayHK() { return new Date(Date.now()+8*3600*1000).toISOString().slice(0,10); }

async function loadTimeline() {
  try {
    const resp = await fetch(`/api/history?date=${todayHK()}`, {cache:'no-store'});
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.snaps?.length) return;
    tlSnapshots = data.snaps;
    tlSlider.max = tlSnapshots.length - 1;
    updateTlCount();
  } catch(e) { console.warn('timeline fail', e); }
}
loadTimeline();
setInterval(() => { if (!document.hidden) loadTimeline(); }, 300000);

function applySnapshot(idx) {
  if (idx < 0 || idx >= tlSnapshots.length) return;
  tlIdx = idx;
  Object.keys(liveData).forEach(k => delete liveData[k]);
  WTS = null;
  const snap = tlSnapshots[idx];
  parseSnapCompact(snap);
  const hasTemp = !!(snap.temp && snap.temp.length);
  tlTime.textContent = snap.t.slice(11, 16) + (hasTemp ? '' : ' ⚠ 僅雨量');
  tlTime.style.color = hasTemp ? 'rgba(255,255,255,.8)' : '#ffd93d';
  tlSlider.value = idx;
  applyColors();
  updateHud();
  renderInfoBar();
}

tlSlider.addEventListener('input', () => {
  tlLiveBtn.classList.remove('active');
  applySnapshot(+tlSlider.value);
});
tlPlay.addEventListener('click', () => {
  if (tlPlaying) {
    tlPlaying = false; clearInterval(tlTimer); tlPlay.textContent = '▶';
    return;
  }
  const seq = playableIndices(mode);
  if (seq.length < 2) {
    showToast('此圖層暫無足夠歷史快照可播放（舊快照未包含該數據）');
    return;
  }
  tlPlaySeq = seq;
  let pos = seq.indexOf(tlIdx);
  if (pos < 0) pos = 0;
  applySnapshot(seq[pos]);
  tlPlaying = true;
  tlLiveBtn.classList.remove('active');
  tlPlay.textContent = '⏸';
  if (seq.length < tlSnapshots.length) {
    showToast(`回放 ${seq.length} 個含「${(LAYER_LEGEND[mode]||{}).title || mode}」數據嘅快照`);
  }
  tlTimer = setInterval(() => {
    pos++;
    if (pos < tlPlaySeq.length) applySnapshot(tlPlaySeq[pos]);
    else { tlPlaying = false; clearInterval(tlTimer); tlPlay.textContent = '▶'; }
  }, 800);
});
tlLiveBtn.addEventListener('click', () => {
  tlLiveBtn.classList.add('active');
  if (tlPlaying) { tlPlaying = false; clearInterval(tlTimer); tlPlay.textContent = '▶'; }
  Object.keys(liveData).forEach(k => delete liveData[k]);
  WTS = null;
  tlTime.textContent = '—';
  tlTime.style.color = 'rgba(255,255,255,.8)';
  refresh();
});

function snapDistrictValue(snap, name, metric) {
  if (!snap) return null;
  let temp = null, rain = null, ltnCount = 0;
  (snap.temp || []).forEach(([stn, v]) => { if (temp2district(stn) === name) temp = +v; });
  (snap.rmax || []).forEach(([d, v]) => { if (normD(d) === name) rain = +v; });
  if (rain === null) (snap.rain || []).forEach(([stn, v]) => { if (stationDistrict(stn) === name) rain = +v; });
  (snap.lhl || []).forEach(([type, region, cnt]) => {
    if (type === '雲對地' && districtsInRegion(region).includes(name)) ltnCount += +cnt;
  });
  const hums = (snap.hum || []).map(([, v]) => +v).filter(v => !isNaN(v));
  const hum = hums.length ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length) : null;
  let feels = null;
  if (temp !== null && hum) {
    const e = (hum / 100) * 6.105 * Math.exp(17.27 * temp / (237.7 + temp));
    feels = Math.round(temp + 0.33 * e - 4.0);
  }
  if (metric === 'temp')      return temp;
  if (metric === 'feels')     return feels;
  if (metric === 'rain')      return rain;
  if (metric === 'humidity')  return hum;
  if (metric === 'lightning') return ltnCount || null;
  return temp !== null ? temp : rain;
}

const TREND_META = {
  temp:      {label:'今日溫度走勢', unit:'°',  color:'#ff9f43'},
  feels:     {label:'今日體感走勢', unit:'°',  color:'#f87171'},
  rain:      {label:'今日雨量走勢', unit:'mm', color:'#4ea8de'},
  lightning: {label:'今日閃電走勢', unit:'次', color:'#a855f7'},
  humidity:  {label:'今日濕度走勢', unit:'%',  color:'#22d3ee'},
  thunder:   {label:'今日溫度走勢', unit:'°',  color:'#ff9f43'},
};

function buildTrend(name, m) {
  const metric = (m === 'thunder') ? 'temp' : (TREND_META[m] ? m : 'temp');
  const meta = TREND_META[metric];
  const pts = [];
  tlSnapshots.forEach(s => {
    const v = snapDistrictValue(s, name, metric);
    if (v !== null && v !== undefined && !isNaN(v)) pts.push({t: (s.t || '').slice(11, 16), v: +v});
  });
  // in live mode, extend the series to "now" so the chart ends at the current reading
  const liveVal = snapLiveValue(name, metric);
  if (liveVal !== null && document.getElementById('tlLive').classList.contains('active')) {
    const lastT = pts.length ? pts[pts.length - 1].t : null;
    const nowT = new Date().toLocaleTimeString('zh-HK', {hour:'2-digit', minute:'2-digit', hour12:false});
    if (lastT !== nowT) pts.push({t: '現在', v: liveVal});
  }
  if (pts.length < 2) {
    return `<div class="trend-box"><div class="trend-head"><span>${meta.label}</span></div>
      <div class="trend-empty">資料不足（今日只有 ${pts.length} 個數據點）</div></div>`;
  }
  const W = Math.max(150, (detailPanel.clientWidth || 224) - 28), H = 54, PAD = 7;
  const vals = pts.map(p => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const flat = (hi - lo) < 1e-9;                 // a flat series would otherwise sit on the floor
  const sp = flat ? 1 : (hi - lo);
  const x = i => PAD + i * (W - PAD * 2) / (pts.length - 1);
  const y = v => flat ? (H / 2) : (H - PAD - ((v - lo) / sp) * (H - PAD * 2));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const first = pts[0], last = pts[pts.length - 1];
  const delta = last.v - first.v;
  const arrow = delta > 0 ? '▲' : (delta < 0 ? '▼' : '');
  const dcol = delta > 0 ? '#f87171' : (delta < 0 ? '#5bb8f0' : 'rgba(255,255,255,.4)');
  const dl = Math.abs(delta);
  const deltaTxt = delta === 0 ? '' : `${arrow}${dl % 1 ? dl.toFixed(1) : dl}`;
  const uid = 'g' + Math.random().toString(36).slice(2, 7);
  const rangeTxt = flat ? `全程 ${hi}${meta.unit}` : `高 ${hi} / 低 ${lo}${meta.unit}`;
  return `<div class="trend-box">
    <div class="trend-head"><span>${meta.label}</span><b>${last.v}${meta.unit} <span style="color:${dcol}">${deltaTxt}</span></b></div>
    <svg class="trend-svg" viewBox="0 0 ${W.toFixed(0)} ${H}" width="${W.toFixed(0)}" height="${H}">
      <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${meta.color}" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="${meta.color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${uid})"/>
      <path d="${line}" fill="none" stroke="${meta.color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2.6" fill="${meta.color}"/>
      <circle cx="${x(0).toFixed(1)}" cy="${y(first.v).toFixed(1)}" r="2" fill="${meta.color}" opacity="0.55"/>
    </svg>
    <div class="trend-foot"><span>${first.t}</span><span>${rangeTxt}</span><span>${last.t}</span></div>
  </div>`;
}

/* current (live) value for the same metric, for the trend's last point */
function snapLiveValue(name, metric) {
  const d = liveData[name] || {};
  if (metric === 'temp')      return d.temp !== undefined ? d.temp : null;
  if (metric === 'feels')     return d.feels !== undefined ? d.feels : null;
  if (metric === 'rain')      return d.rain !== undefined ? d.rain : null;
  if (metric === 'humidity')  return d.hum !== undefined ? d.hum : (infoCache.hum || null);
  if (metric === 'lightning') return d.lhl ? d.lhl : null;
  return null;
}
