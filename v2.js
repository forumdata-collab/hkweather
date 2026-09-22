/* ==========================================================================
   HK Weather 3D — V2 UI layer
   Loaded after core.js. Overrides the presentation functions core.js calls
   (updateHud / updateTlCount / renderInfoBar / showDetail) and owns every
   panel, sheet, the bottom nav, the natural-language status line and the
   per-dataset freshness timestamps. The data + 3D map layer in core.js is
   untouched.

   NOTE: core.js declares these top-level names — never redeclare them here:
   viewer districtEntities labelEntities showLabels sunOn dist_geo_names mode
   WTS infoCache DISTRICT_ALIAS REGION_DISTRICTS LAYER_LEGEND* TREND_META*
   liveData currentDetail tlSnapshots tlIdx tlPlaying tlTimer tlPlaySeq
   tlSlider tlTime tlCount tlPlay tlLiveBtn forecastCache swtCache sunCache
   loadingHidden hktileset(*needs defining here where marked)
   ========================================================================== */

/* ---------------- element refs (names core.js does not use) ---------------- */
const detailPanel = document.getElementById('detailPanel');
const nowPanelEl = document.getElementById('nowPanel');
const tlPanelEl = document.getElementById('tlPanel');
const alertPanelEl = document.getElementById('alertPanel');
const morePanelEl = document.getElementById('morePanel');
const backdropEl = document.getElementById('backdrop');
const hudEl = document.getElementById('hud');
const legBox = document.getElementById('legendBox');

const SHEET_IDS = { now: 'nowPanel', timeline: 'tlPanel', alerts: 'alertPanel', more: 'morePanel', district: 'detailPanel' };
const SHEET_ELS = { now: nowPanelEl, timeline: tlPanelEl, alerts: alertPanelEl, more: morePanelEl, district: detailPanel };

let v2OpenTab = null;          // 'now' | 'timeline' | 'alerts' | 'more' | 'district' | null
let v2DistrictMetric = 'temp'; // metric shown in the 18-district list
let v2LastRaw = null;          // last HKO payload seen via the wx:live event
let v2LiveOK = null;           // null=unknown, true=live data, false=fetch failed
let v2LastGood = null;         // {time, raw} of the last successful payload
let v2TlState = null;          // null=loading, true=snapshots present, false=never arrived
let v2TlSeen = -1;             // last snapshot count we painted panels for

/* ---------------- mode metadata (§8 layer switcher) ----------------
   core.js works with mode names rain|temp|feels|lightning|thunder, where
   'thunder' is the composite storm layer. The UI calls it 雷暴. */
const V2_MODE_UI = {
  rain:      { label: '雨量',   title: '雨量分布',   unit: 'mm (1 小時)' },
  temp:      { label: '溫度',   title: '氣溫分布',   unit: '°C' },
  feels:     { label: '體感',   title: '體感溫度',   unit: '°C' },
  lightning: { label: '閃電',   title: '閃電活動',   unit: '次' },
  thunder:   { label: '雷暴',   title: '雷暴綜合',   unit: '雨量＋閃電' },
};
const V2_MODE_ORDER = ['rain', 'temp', 'feels', 'lightning', 'thunder'];

/* ---------------- legend (§22: colour + text, never colour alone) ---------------- */
const LAYER_LEGEND = {
  rain: {
    title: '雨量（過去 1 小時）',
    rows: [
      ['rgba(30,58,95,0.45)', '無雨', '0 mm'],
      ['rgba(78,168,222,0.7)', '小雨', '0–2.5 mm'],
      ['rgba(87,204,153,0.72)', '中雨', '2.5–7.5 mm'],
      ['rgba(255,217,61,0.75)', '大雨', '7.5–50 mm'],
      ['rgba(239,68,68,0.8)', '暴雨', '> 50 mm'],
    ],
    note: '固定絕對刻度，可跨時間比較。分級依天文台雨量定義。',
  },
  temp: {
    title: '氣溫',
    rows: [
      ['rgba(59,130,246,0.55)', '清涼', '< 24°C'],
      ['rgba(78,168,222,0.6)', '舒適', '24–26°C'],
      ['rgba(253,126,40,0.62)', '和暖', '26–28°C'],
      ['rgba(255,160,80,0.7)', '熱', '28–30°C'],
      ['rgba(255,217,61,0.72)', '炎熱', '30–32°C'],
      ['rgba(239,68,68,0.75)', '酷熱', '≥ 32°C'],
    ],
    note: '來自天文台 27 個氣象站，非每區獨立監測。標 * 者為鄰近站推算。',
  },
  feels: {
    title: '體感溫度（估算）',
    rows: [
      ['rgba(78,168,222,0.6)', '舒適', '< 27°C'],
      ['rgba(253,126,40,0.6)', '悶熱', '27–30°C'],
      ['rgba(255,160,80,0.68)', '熱', '30–33°C'],
      ['rgba(255,217,61,0.72)', '酷熱', '33–36°C'],
      ['rgba(239,68,68,0.76)', '極熱', '36–40°C'],
      ['rgba(220,38,38,0.82)', '危險', '≥ 40°C'],
    ],
    note: '體感為氣溫＋濕度之估算（非實測）。',
  },
  lightning: {
    title: '閃電活動',
    rows: [
      ['rgba(30,58,95,0.45)', '無紀錄', '0 次'],
      ['rgba(255,217,61,0.75)', '區內有閃電', '雲對地'],
      ['rgba(168,85,247,0.72)', '多次閃電', '> 5 次'],
    ],
    note: '天文台只發放 4 大區域閃電數據，非逐區。',
  },
  thunder: {
    title: '雷暴綜合（雨量＋閃電）',
    rows: [
      ['rgba(30,58,95,0.45)', '平靜', '無雨無閃電'],
      ['rgba(78,168,222,0.65)', '有雨', '雨量 > 0'],
      ['rgba(87,204,153,0.68)', '中雨', '2.5–7.5 mm'],
      ['rgba(255,217,61,0.7)', '大雨', '7.5–50 mm'],
      ['rgba(168,85,247,0.7)', '有閃電', '雲對地閃電'],
      ['rgba(239,68,68,0.72)', '雷暴', '區內閃電或暴雨'],
    ],
    note: '綜合圖層：紅＝區內閃電／暴雨，紫＝多次閃電，黃綠＝雨量。',
  },
};
const V2_MODE_ALIAS = { storm: 'thunder' };

function applyLegend(m) {
  const key = V2_MODE_ALIAS[m] || m;
  const L = LAYER_LEGEND[key] || LAYER_LEGEND.rain;
  document.getElementById('legTitle').textContent = L.title;
  document.getElementById('legBody').innerHTML = L.rows.map(([c, name, val]) =>
    `<div class="leg-row"><span class="leg-dot" style="background:${c}"></span><span>${name}</span>` +
    `<span style="margin-left:auto;color:var(--ink-4)">${val}</span></div>`).join('');
  document.getElementById('legScaleNote').textContent = L.note;
}
applyLegend('rain');

/* ---------------- badges ---------------- */
function tempBadge(t) {
  if (t === undefined || t === null) return '';
  if (t >= 33) return '<span class="badge b-hot">酷熱</span>';
  if (t >= 30) return '<span class="badge b-warm">炎熱</span>';
  if (t >= 28) return '<span class="badge b-warm">熱</span>';
  if (t >= 24) return '<span class="badge b-ok">舒適</span>';
  return '<span class="badge b-cool">清涼</span>';
}
function humBadge(h) {
  if (!h) return '';
  if (h >= 90) return '<span class="badge b-hot">非常潮濕</span>';
  if (h >= 80) return '<span class="badge b-warm">潮濕</span>';
  if (h >= 60) return '<span class="badge b-ok">適中</span>';
  return '<span class="badge b-cool">乾爽</span>';
}
function rainBadge(r) {
  if (!r) return '<span class="badge b-ok">無雨</span>';
  if (r > 50) return '<span class="badge b-hot">暴雨</span>';
  if (r > 7.5) return '<span class="badge b-warm">大雨</span>';
  if (r > 2.5) return '<span class="badge b-ok">中雨</span>';
  return '<span class="badge b-cool">小雨</span>';
}

/* ---------------- helpers over liveData ---------------- */
function v2Names() { return districtEntities.map(d => d.name); }
function v2Val(name, metric) {
  const d = liveData[name] || {};
  if (metric === 'temp') return d.temp === undefined ? null : d.temp;
  if (metric === 'feels') return d.feels === undefined ? null : d.feels;
  if (metric === 'rain') return d.rain === undefined ? null : d.rain;
  if (metric === 'humidity') return d.hum === undefined ? (infoCache.hum || null) : d.hum;
  if (metric === 'lightning') return d.lhl || (d.lightning ? 1 : 0);
  return null;
}
function v2Stats(metric) {
  const vals = v2Names().map(n => [n, v2Val(n, metric)]).filter(([, v]) => v !== null && v !== undefined && !isNaN(v));
  if (!vals.length) return { n: 0, vals, max: null, min: null, avg: null, maxD: null, minD: null };
  const sorted = [...vals].sort((a, b) => b[1] - a[1]);
  const sum = vals.reduce((a, [, v]) => a + v, 0);
  return {
    n: vals.length, vals, sorted,
    max: sorted[0][1], min: sorted[sorted.length - 1][1], maxD: sorted[0][0], minD: sorted[sorted.length - 1][0],
    avg: Math.round((sum / vals.length) * 10) / 10,
  };
}
function v2Clock(iso) {
  if (!iso) return null;
  const s = String(iso).replace(' ', 'T');
  const d = new Date(s);
  if (isNaN(d)) { const m = String(iso).match(/(\d{2}):(\d{2})/); return m ? m[0] : null; }
  return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}
/* per-dataset freshness (§24) */
function v2Times() {
  const r = v2LastRaw || {};
  return {
    temp: v2Clock(r.rhrread?.temperature?.recordTime || r.rhrread?.updateTime),
    hum: v2Clock(r.rhrread?.humidity?.recordTime),
    rain: v2Clock(r.rainfall?.obsTime || r.rhrread?.rainfall?.endTime),
    ltn: v2Clock((r.lhl?.data || [])[0]?.[0]),
    fc: v2Clock(r.flw?.updateTime),
  };
}
/* Which districts currently carry rain / lightning? */
function v2Wet() {
  return v2Names().map(n => [n, v2Val(n, 'rain') || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}
function v2Struck() {
  return v2Names().filter(n => { const d = liveData[n] || {}; return d.lightning || d.lhl; });
}

/* ---------------- §6 natural-language status (from real data only) ---------------- */
function v2StatusLine() {
  if (v2LiveOK === false) return { cls: 'err', text: '⚠️ 天氣資料暫時無法載入，以下為最後可用數據。' };
  const wet = v2Wet(), struck = v2Struck();
  const t = v2Stats('temp'), f = v2Stats('feels');
  if (WTS) {
    const to = v2Clock(WTS.expireTime);
    return { cls: 'storm', text: `⛈ 雷暴警告生效中${to ? `（有效至 ${to}）` : ''}。${struck.length ? `${struck.length} 區有閃電活動。` : '香港部分地區有雷雨。'}` };
  }
  if (struck.length) return { cls: 'storm', text: `⛈ ${struck.length} 區有閃電活動${wet.length ? `，同時 ${wet.length} 區有雨` : ''}。` };
  if (wet.length) {
    const top = wet[0];
    return { cls: 'rain', text: `🌧 雨區影響 ${wet.length} 區，以${top[0]}最大（${top[1]} mm／1 小時）。` };
  }
  if (f.avg !== null && t.avg !== null && (f.avg - t.avg) >= 3) {
    return { cls: 'hot', text: `🥵 體感 ${f.avg}°C，比實際氣溫高 ${Math.round((f.avg - t.avg) * 10) / 10}°C，天氣悶熱。` };
  }
  if (t.avg !== null) return { cls: 'calm', text: `🌤 全港大致穩定，平均 ${t.avg}°C，暫無雨區或閃電。` };
  return { cls: 'calm', text: '🌤 暫無明顯天氣活動。' };
}

/* short form for the narrow mobile HUD strip */
function v2StatusShort() {
  const wet = v2Wet(), struck = v2Struck();
  if (v2LiveOK === false) return '⚠️ 天氣資料未能載入';
  if (WTS) return '⛈ 雷暴警告生效中';
  if (struck.length) return `⛈ ${struck.length} 區有閃電`;
  if (wet.length) return `🌧 ${wet.length} 區有雨 · 最多 ${wet[0][1]}mm`;
  const t = v2Stats('temp'), f = v2Stats('feels');
  if (f.avg !== null && t.avg !== null && (f.avg - t.avg) >= 3) return `🥵 體感 ${f.avg}°C · 悶熱`;
  if (t.avg !== null) return `🌤 全港穩定 · 平均 ${t.avg}°C`;
  return '🌤 暫無明顯天氣活動';
}

/* ---------------- §5 HUD (overrides core.updateHud) ---------------- */
function updateHud() {
  // an offline/cached display stays on screen until a live payload arrives,
  // otherwise this repaint would blank it back to "--"
  if (v2CachedShown && v2LiveOK !== true) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const t = v2Stats('temp'), f = v2Stats('feels'), wet = v2Wet(), struck = v2Struck();
  const sunny = trackingLabel();   // follows the timeline when it is not live

  const bigEl = document.getElementById('hudTemp');
  if (bigEl) bigEl.innerHTML = (t.avg !== null ? t.avg : '--') + '<span>°C</span>';
  set('hudArea', sunny ? '全港平均 · ' + sunny : '全港平均');
  if (document.getElementById('hudFeels'))
    document.getElementById('hudFeels').innerHTML = f.avg !== null
      ? `體感 <b>${f.avg}°C</b>${tempBadge(f.avg)}`
      : '體感 —';
  set('hudHum', (infoCache.hum || '--') + '%');
  set('hudRain', wet.length ? `${wet.length} 區有雨` : '無雨');
  set('hudLtn', struck.length ? `${struck.length} 區` : '無');

  const st = v2StatusLine();
  const nl = document.getElementById('hudNL');
  if (nl) { nl.className = 'nl ' + st.cls; nl.textContent = st.text; }
  set('hudNLM', v2StatusShort());

  const T = v2Times();
  const ltnTxt = T.ltn || ((v2LastRaw && v2LastRaw.lhl) ? '無紀錄' : '—');
  const tt = document.getElementById('hudTime');
  if (tt) {
    const parts = [`溫度 ${T.temp || '—'}`, `雨量 ${T.rain || '—'}`, `閃電 ${ltnTxt}`];
    tt.innerHTML = `更新 ${v2LastGood?.at || '—'}<br>${parts.join(' · ')}`;
  }
  const retry = document.getElementById('hudRetry');
  if (retry) retry.hidden = v2LiveOK !== false;

  // warning banner + nav dot (§Alerts)
  const bar = document.getElementById('warnBar');
  const badge = document.getElementById('tgForecastBadge');
  if (badge) badge.classList.toggle('on', !!WTS);
  document.body.classList.toggle('has-warn', !!WTS);
  if (bar) {
    if (WTS) {
      bar.style.display = 'block';
      bar.textContent = `⛈️ 雷暴警告 — ${WTS.actionCode === 'EXTEND' ? '延長' : WTS.actionCode} 有效至 ${v2Clock(WTS.expireTime) || '—'} · 天文台`;
    } else bar.style.display = 'none';
  }
  const chip = document.getElementById('alertChip');
  if (chip) {
    if (!navigator.onLine) { chip.className = 'chip warn'; chip.textContent = '⚡ 離線'; }
    else if (WTS) { chip.className = 'chip alert'; chip.textContent = '⛈ 雷暴警告'; }
    else if (v2LiveOK === false) { chip.className = 'chip warn'; chip.textContent = '⚠ 資料中斷'; }
    else { chip.className = 'chip ok'; chip.textContent = '🌤 無警告'; }
  }
}
function trackingLabel() {
  if (tlIdx < 0 || !tlSnapshots[tlIdx]) return null;
  return tlSnapshots[tlIdx].t.slice(11, 16) + ' 回放';
}

/* ---------------- §16 primary stats bar (overrides core.renderInfoBar) ---------------- */
function renderInfoBar() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const t = v2Stats('temp'), wet = v2Wet(), struck = v2Struck();
  set('stMax', t.max !== null ? `${t.max}°` : '—');
  set('stMin', t.min !== null ? `${t.min}°` : '—');
  set('stHum', (infoCache.hum || '--') + '%');
  set('stRain', wet.length ? `${wet[0][1]}mm` : '0mm');
  set('stLtn', struck.length ? `${struck.length} 區` : '0');
  v2RenderPanels();
}

/* ---------------- sheets (§18) ---------------- */
function v2OpenSheet(tab, keepTab) {
  Object.entries(SHEET_ELS).forEach(([k, el]) => {
    if (!el) return;
    const on = (k === tab);
    el.classList.toggle('open', on);
    el.classList.toggle('sheet-open', on);   // core.applyColors() checks this class
  });
  v2OpenTab = tab;
  const mobile = window.matchMedia('(max-width:860px)').matches;
  if (backdropEl) backdropEl.classList.toggle('open', !!tab && tab !== 'district' && mobile);
  if (!keepTab) v2SyncNav(tab);
  document.body.style.overflow = 'hidden';
}
function v2CloseSheets(except) {
  Object.entries(SHEET_ELS).forEach(([k, el]) => {
    if (!el || k === except) return;
    el.classList.remove('open', 'sheet-open');
  });
  if (!except) { v2OpenTab = null; v2SyncNav(null); }
  if (backdropEl) backdropEl.classList.remove('open');
}
function v2SyncNav(tab) {
  document.querySelectorAll('.nav button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
}
function v2Tab(tab) {
  if (tab === 'map') { v2CloseSheets(null); return; }
  const key = { now: 'now', timeline: 'timeline', alerts: 'alerts', more: 'more' }[tab];
  if (v2OpenTab === key) { v2CloseSheets(null); return; }  // tap again = back to map
  v2OpenSheet(key);
}

/* ---------------- §11 district detail ---------------- */
function showDetail(name) {
  currentDetail = name;
  const data = liveData[name] || {};
  const ent = districtEntities.find(d => d.name === name);
  const T = v2Times();
  const rows = [];
  if (data.temp !== undefined) rows.push(['🌡 氣溫', data.temp + '°C' + (data.tempEst ? ' *' : '') + tempBadge(data.temp)]);
  if (data.feels !== undefined) rows.push(['🥵 體感', data.feels + '°C' + tempBadge(data.feels)]);
  const hum = data.hum !== undefined ? data.hum : (infoCache.hum || null);
  if (hum) rows.push(['💧 濕度', hum + '%' + humBadge(hum) + (data.hum === undefined ? '<span class="badge b-cool">參考站</span>' : '')]);
  const rain = data.rain || 0;
  rows.push(['🌧 雨量（1 小時）', rain + ' mm' + rainBadge(rain)]);
  rows.push(['⚡ 閃電', data.lightning ? '<span style="color:#ffd93d">區內有閃電</span>' : (data.lhl ? data.lhl + ' 次（區域）' : '無紀錄')]);
  if (WTS) rows.push(['⛈ 雷暴警告', '<span style="color:#ffd93d">生效中</span>']);
  const body = document.getElementById('dpBody');
  const el = document.getElementById('dpName');
  if (el) el.textContent = '📍 ' + name;
  if (body) {
    body.innerHTML =
      rows.map(([k, v]) => `<div class="dp-row"><span class="dp-k">${k}</span><span class="dp-v">${v}</span></div>`).join('') +
      `<div class="bar"><i style="width:${Math.min(100, (rain / 50) * 100)}%"></i></div>` +
      `<div style="font-size:10px;color:var(--ink-4);margin-top:3px">雨量刻度：0–50 mm（暴雨）</div>` +
      buildTrend(name, mode) +
      `<div style="font-size:10px;color:var(--ink-4);margin-top:10px">氣溫更新 ${T.temp || '—'} · 雨量更新 ${T.rain || '—'}</div>` +
      (ent ? `<button class="dl-tab" id="flyBtn" style="margin-top:10px;width:100%;height:34px">🗺 地圖飛到 ${name}</button>` : '');
    const fly = document.getElementById('flyBtn');
    if (fly && ent) fly.addEventListener('click', () => {
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(ent.cx, ent.cy, 9000), duration: 1.2 });
    });
  }
  v2OpenSheet('district', true);
}

/* ---------------- §19/§20 loading + source status ---------------- */
function v2Sources() {
  const r = v2LastRaw || {};
  if (!v2LastRaw) {
    return [['3D 地圖（CSDI）', !!hkTileset, ''],
            ['氣溫／濕度（rhrread）', null, ''], ['雨量（hourlyRainfall）', null, ''],
            ['閃電（LHL）', null, ''], ['九日預報（flw）', null, ''],
            ['歷史快照（R2）', null, '']];
  }
  const T = v2Times();
  return [
    ['3D 地圖（CSDI）', !!hkTileset, ''],
    ['氣溫／濕度（rhrread）', !!(r.rhrread?.temperature), T.temp],
    ['雨量（hourlyRainfall）', !!r.rainfall, T.rain],
    ['閃電（LHL）', !!r.lhl, T.ltn],
    ['九日預報（flw）', !!r.flw, T.fc],
    ['歷史快照（R2）', v2TlState === null ? null : v2TlState, tlSnapshots.length ? tlSnapshots[tlSnapshots.length - 1].t.slice(11, 16) : ''],
  ];
}

/* ---------------- §12/§13 18-district list + factual comparison ---------------- */
const V2_DL_METRICS = [
  ['temp', '🌡 氣溫', v => v === null ? '—' : v + '°C'],
  ['feels', '🥵 體感', v => v === null ? '—' : v + '°C'],
  ['rain', '🌧 雨量', v => v === null ? '—' : v + ' mm'],
  ['lightning', '⚡ 閃電', v => v === null ? '—' : (v ? v + ' 次' : '0')],
  ['humidity', '💧 濕度', v => v === null ? '—' : Math.round(v) + '%'],
];
function v2DistrictListHTML() {
  const meta = V2_DL_METRICS.find(m => m[0] === v2DistrictMetric) || V2_DL_METRICS[0];
  const vals = v2Names().map(n => [n, v2Val(n, meta[0])]);
  const has = vals.filter(([, v]) => v !== null && v !== undefined && !isNaN(v));
  const sorted = [...has].sort((a, b) => b[1] - a[1]);
  const missing = vals.length - has.length;
  const fmt = meta[2];
  return `
    <div class="dl-tabs">${V2_DL_METRICS.map(([k, label]) =>
      `<button class="dl-tab" data-m="${k}" aria-pressed="${k === v2DistrictMetric}">${label}</button>`).join('')}</div>
    <div class="dl-sec">${meta[1]}排行（${sorted.length} 區有數據）</div>
    ${sorted.map(([n, v], i) => `<div class="dl-row" data-d="${n}"><span class="rank">${i + 1}</span><span class="nm">${n}</span><span class="v1">${fmt(v)}</span></div>`).join('')}
    ${missing ? `<div class="dl-note">${missing} 區暫無此項數據（該區沒有氣象站，或資料未更新）。</div>` : ''}
    <div class="dl-sec">事實對比（非評分）</div>
    ${v2CompareHTML()}
    <div class="dl-note">排行只反映已收到的觀測值；天文台並非每區設站，缺值區不會被估算填補。</div>`;
}
function v2CompareHTML() {
  const t = v2Stats('temp'), f = v2Stats('feels'), wet = v2Wet(), struck = v2Struck();
  const line = (k, v) => `<div class="dp-row"><span class="dp-k">${k}</span><span class="dp-v">${v}</span></div>`;
  return [
    t.max !== null ? line('最高氣溫', `${t.max}°C · ${t.maxD}`) : '',
    t.min !== null ? line('最低氣溫', `${t.min}°C · ${t.minD}`) : '',
    f.max !== null ? line('最高體感', `${f.max}°C · ${f.maxD}`) : '',
    wet.length ? line('最多雨量', `${wet[0][1]} mm · ${wet[0][0]}`) : line('最多雨量', '目前全港無雨'),
    line('閃電活動', struck.length ? `${struck.join('、')}（${struck.length} 區）` : '無紀錄'),
  ].join('');
}

/* ---------------- §9 storm movement (factual, from snapshots) ---------------- */
function v2StormTrackHTML() {
  if (!tlSnapshots.length) return '<div class="dl-note">歷史快照載入後，這裡會顯示雨區移動方向。</div>';
  const last = tlSnapshots[tlSnapshots.length - 1];
  const t1 = new Date(last.t.replace(' ', 'T')).getTime();
  const win = tlSnapshots.filter(s => t1 - new Date(s.t.replace(' ', 'T')).getTime() <= 3600e3);
  if (win.length < 3) return '<div class="dl-note">快照數量不足，暫未能顯示過去 60 分鐘移動。</div>';
  const first = win[0], mid = win[Math.floor(win.length / 2)];
  const pick = s => {
    let best = null;
    (s.rmax || []).forEach(([d, v]) => { if (+v > 0 && (!best || +v > best.v)) best = { d: normD(d), v: +v }; });
    return best;
  };
  const a = pick(first), b = pick(mid), c = pick(last);
  if (!a && !b && !c) return '<div class="dl-note">過去 60 分鐘全港無雨區。</div>';
  const fmt = x => x ? `${x.d}（${x.v} mm）` : '無雨';
  const ltn = (last.lhl || []).filter(r => r[0] === '雲對地' && +r[2] > 0);
  return `
    <div class="dp-row"><span class="dp-k">60 分鐘前</span><span class="dp-v">${fmt(a)}</span></div>
    <div class="dp-row"><span class="dp-k">30 分鐘前</span><span class="dp-v">${fmt(b)}</span></div>
    <div class="dp-row"><span class="dp-k">最新</span><span class="dp-v">${fmt(c)}</span></div>
    <div class="dl-note">以上為觀測回放（非預報）。雨區最強位置由各區 1 小時雨量比較得出。
    ${ltn.length ? `最新雲對地閃電區域：${ltn.map(r => r[1] + ' ' + r[2] + ' 次').join('、')}。` : ''}</div>`;
}

/* ---------------- §23 methodology ---------------- */
function v2MethodologyHTML() {
  const T = v2Times();
  return `<div class="meth">
    <h3>資料來源</h3>
    <div class="src">所有天氣資料來自<strong>香港天文台（HKO）開放數據</strong>，每 1 分鐘自動更新一次。
    本網站不自行生產或推算天氣預報。</div>
    <h3>各項數據與更新頻率</h3>
    <ul>
      <li><strong>氣溫</strong>— 天文台 27 個氣象站，每 10 分鐘（本地時間 ${T.temp || '—'}）</li>
      <li><strong>濕度</strong>— 全港只有 1 個參考站數值（${T.hum || '—'}），<em>不代表每區實測濕度</em></li>
      <li><strong>雨量</strong>— 18 區過去 1 小時雨量（${T.rain || '—'}），自動氣象站</li>
      <li><strong>閃電</strong>— 天文台只提供 4 大區域（${T.ltn || '—'}），非逐區</li>
      <li><strong>體感</strong>— 由氣溫＋濕度<strong>估算</strong>（Steadman 公式），非實測值</li>
      <li><strong>預報</strong>— 天文台官方九日預報（${T.fc || '—'}）</li>
      <li><strong>歷史時間軸</strong>— 本網站每 5 分鐘記錄一次快照，保留最近 7 日</li>
    </ul>
    <h3>體感溫度公式</h3>
    <p><code>e = (RH/100) × 6.105 × exp(17.27T / (237.7+T))</code>，<code>體感 = T + 0.33e − 4.0</code>。
    這是常用近似式，與天文台官方「暑熱指數」不同，只作參考。</p>
    <h3>已知限制</h3>
    <ul>
      <li>天文台並非每區設氣象站，部分區以鄰近站推算並標示 <code>*</code></li>
      <li>閃電只到 4 大區域，區級閃電為區域值</li>
      <li>歷史快照早期未包含氣溫／濕度，回放時會標示「僅雨量」</li>
      <li>雨量色階為固定絕對刻度，方便跨時間比較</li>
    </ul>
    <h3>3D 地圖</h3>
    <p>立體建築及地形來自 <strong>CSDI 空間數據共享平台</strong>（3D Tiles），底圖為 Esri 衛星影像。
    遠景（高度 &gt; 14 km）自動切換為平面色層，以免粗粒度立體磚遮擋畫面。</p>
    <h3>私隱</h3>
    <p>本網站不設帳戶、不收集個人資料、不使用追蹤 cookie。歷史快照只記錄天氣數據。</p>
  </div>`;
}

/* ---------------- panel bodies ---------------- */
function v2NowBodyHTML() {
  const T = v2Times(), t = v2Stats('temp'), f = v2Stats('feels');
  const st = v2StatusLine();
  const wet = v2Wet(), struck = v2Struck();
  const more = [];
  if (infoCache.sea != null) more.push(['🌊 海水溫度', infoCache.sea + '°C']);
  if (infoCache.soil != null) more.push(['🌱 土壤溫度', infoCache.soil + '°C']);
  if (infoCache.hum) more.push(['💧 濕度（參考站）', infoCache.hum + '%' + humBadge(infoCache.hum)]);
  return `
    <div class="nl ${st.cls}" style="margin:0 0 12px">${st.text}</div>
    <div class="dp-row"><span class="dp-k">🌡 全港平均氣溫</span><span class="dp-v">${t.avg !== null ? t.avg + '°C' : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🥵 全港平均體感</span><span class="dp-v">${f.avg !== null ? f.avg + '°C' + tempBadge(f.avg) : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌡 最高／最低</span><span class="dp-v">${t.max !== null ? `${t.max}°（${t.maxD}）／ ${t.min}°（${t.minD}）` : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌧 有雨區域</span><span class="dp-v">${wet.length ? `${wet.length} 區 · 最多 ${wet[0][1]} mm（${wet[0][0]}）` : '無雨'}</span></div>
    <div class="dp-row"><span class="dp-k">⚡ 閃電</span><span class="dp-v">${struck.length ? struck.join('、') : '無紀錄'}</span></div>
    <div style="font-size:10px;color:var(--ink-4);margin-top:8px">
      更新：氣溫 ${T.temp || '—'} · 濕度 ${T.hum || '—'} · 雨量 ${T.rain || '—'} · 閃電 ${T.ltn || '—'}
    </div>
    <div class="dl-sec">⛈ 雨區移動（過去 60 分鐘）</div>
    ${v2StormTrackHTML()}
    <div class="dl-sec">🗓 天文台預報</div>
    ${v2ForecastHTML()}
    <div class="dl-sec">18 區一覽</div>
    ${v2DistrictListHTML()}`;
}
function v2ForecastHTML() {
  const r = v2LastRaw || {};
  if (!r.flw) return '<div class="dl-note">預報資料暫時無法載入。</div>';
  return `<div class="src" style="font-size:11.5px;line-height:1.6;padding:9px 11px;border-radius:8px;background:rgba(255,255,255,.04)">
    <strong>${(r.flw.forecastPeriod || '').slice(0, 18)}</strong><br>${r.flw.forecastDesc || ''}
    ${r.flw.outlook ? `<br><span style="color:var(--ink-4)">📈 ${r.flw.outlook}</span>` : ''}
    <div style="font-size:10px;color:var(--ink-4);margin-top:6px">天文台官方預報，更新 ${v2Times().fc || '—'}。此為全港預報，非逐區。</div>
  </div>`;
}
function v2AlertBodyHTML() {
  const rows = [];
  if (WTS) rows.push(['⛈', `雷暴警告`, `天文台於 ${v2Clock((WTS.issueTime || WTS.updateTime)) || '—'} 發出${WTS.actionCode === 'EXTEND' ? '（延長）' : ''}，有效至 ${v2Clock(WTS.expireTime) || '—'}。${WTS.contents ? ' ' + WTS.contents.slice(0, 160) : ''}`]);
  else rows.push(['🌤', '暫無天氣警告', '天文台現時沒有發出雷暴、暴雨、熱帶氣旋等警告。']);
  const r = v2LastRaw || {};
  if (r.swt?.swt?.length) r.swt.swt.forEach(s => rows.push(['💡', '特別天氣提示', (s.advice || '') + (s.updateTime ? `（${v2Clock(s.updateTime)}）` : '')]));
  const struck = v2Struck();
  if (struck.length) rows.push(['⚡', `閃電活動：${struck.length} 區`, struck.join('、') + ' 有雲對地閃電紀錄。']);
  const wet = v2Wet();
  if (wet.length) rows.push(['🌧', `雨區：${wet.length} 區`, wet.slice(0, 6).map(([n, v]) => `${n} ${v}mm`).join('、') + (wet.length > 6 ? ' 等' : '')]);

  return rows.map(([ic, t, d]) => `<div class="al-row"><span class="al-ic">${ic}</span><div><div class="al-t">${t}</div><div class="al-d">${d}</div></div></div>`).join('') +
    `<div class="dl-sec">資料來源狀態</div>
     ${v2Sources().map(([n, ok, when]) =>
       `<div class="src-row"><span class="dot ${ok === null ? 'wait' : ok ? '' : 'bad'}"></span><span>${n}</span><span class="when">${ok === null ? '載入中' : ok ? (when || '已連線') : '未取得'}</span></div>`).join('')}
     <div class="dl-note">任一來源中斷只會令該圖層無數據，其餘功能正常運作。</div>
     ${v2LiveOK === false ? '<button class="dl-tab" id="retryBtn" style="width:100%;height:36px;margin-top:10px;border-color:rgba(239,68,68,.5);color:#ffb4b4">🔄 重新載入天氣資料</button>' : ''}`;
}
function randomiseOrder() { /* removed — alert order follows official HKO priority */ }

function v2TlBodyHTML() {
  if (!tlSnapshots.length) return '<div class="dl-note">今日尚未有歷史快照（每 5 分鐘記錄一次，需時累積）。</div>';
  const total = tlSnapshots.length;
  const avail = playableIndices(mode).length;
  const full = tlSnapshots.filter(s => s.temp && s.temp.length).length;
  const first = tlSnapshots[0].t.slice(11, 16), last = tlSnapshots[total - 1].t.slice(11, 16);
  return `
    <div class="dp-row"><span class="dp-k">今日快照</span><span class="dp-v">${total} 個</span></div>
    <div class="dp-row"><span class="dp-k">時間範圍</span><span class="dp-v">${first} – ${last}（今日）</span></div>
    <div class="dp-row"><span class="dp-k">含氣溫快照</span><span class="dp-v">${full} 個</span></div>
    <div class="dp-row"><span class="dp-k">此圖層可播</span><span class="dp-v">${avail} 個</span></div>
    <button class="dl-tab" id="tlReplay2" style="width:100%;height:36px;margin-top:10px">▶ 回放過去 60 分鐘</button>
    <div class="dl-note" style="margin-top:10px">
      <strong>只提供歷史回放，沒有未來預測。</strong>快照每 5 分鐘記錄一次，保留最近 7 日；
      較早的快照只有雨量與閃電，沒有氣溫（會標示「僅雨量」）。
      雨量色階為固定絕對刻度，所以不同時間的顏色可以直接比較。</div>`;
}
function v2MoreBodyHTML() {
  const a = v2Stats('temp');
  const sea = infoCache.sea, soil = infoCache.soil, hum = infoCache.hum;
  const sun = sunCache || {};
  return `
    <div class="dp-row"><span class="dp-k">🌡 最高氣溫</span><span class="dp-v">${a.max !== null ? a.max + '°C · ' + a.maxD : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌡 最低氣溫</span><span class="dp-v">${a.min !== null ? a.min + '°C · ' + a.minD : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌧 最高雨量</span><span class="dp-v">${v2Wet().length ? v2Wet()[0][1] + ' mm · ' + v2Wet()[0][0] : '0 mm'}</span></div>
    <div class="dp-row"><span class="dp-k">💧 濕度</span><span class="dp-v">${hum ? hum + '%' : '—'} <button id="humInfo" class="dl-tab" style="height:24px;padding:0 8px;font-size:10px">ⓘ 說明</button></span></div>
    <div class="dp-row"><span class="dp-k">⚡ 閃電</span><span class="dp-v">${v2Struck().length ? v2Struck().length + ' 區有紀錄' : '無紀錄'}</span></div>
    <div id="humNote" class="dl-note" hidden>
      <strong>濕度數據限制：</strong>天文台只提供 1 個全港參考站的濕度值，並非每區實測。
      本網站不會把這個數值當作個別區域的濕度，圖層與詳情會標示「參考站」。</div>
    <div class="dl-sec">次要數據</div>
    <div class="dp-row"><span class="dp-k">🌊 海水溫度</span><span class="dp-v">${sea != null ? sea + '°C' : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌱 土壤溫度</span><span class="dp-v">${soil != null ? soil + '°C' : '—'}</span></div>
    <div class="dp-row"><span class="dp-k">🌅 日出</span><span class="dp-v" id="ibSunrise">—</span></div>
    <div class="dp-row"><span class="dp-k">🌇 日落</span><span class="dp-v" id="ibSunset">—</span></div>
    <div class="dp-row"><span class="dp-k">☀️ 日照時長</span><span class="dp-v" id="ibDaylen">—</span></div>
    <div class="dl-sec">關於本網站</div>
    ${v2MethodologyHTML()}`;
}

/* render whichever panels exist; called from renderInfoBar (i.e. every refresh) */
function v2RenderPanels() {
  const wire = (root, ids) => {
    if (!root) return;
    root.querySelectorAll('[data-d]').forEach(r => r.addEventListener('click', () => {
      const n = r.dataset.d;
      const ent = districtEntities.find(d => d.name === n);
      if (ent) viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(ent.cx, ent.cy, 9000), duration: 1.2 });
      showDetail(n);
    }));
    root.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      v2DistrictMetric = b.dataset.m; v2RenderPanels();
    }));
    const rb = root.querySelector('#retryBtn');
    if (rb) rb.addEventListener('click', () => { v2LiveOK = null; refresh(); });
    const r2 = root.querySelector('#tlReplay2');
    if (r2) r2.addEventListener('click', v2Replay60);
    const hi = root.querySelector('#humInfo');
    if (hi) hi.addEventListener('click', () => { const n = root.querySelector('#humNote'); if (n) n.hidden = !n.hidden; });
  };
  const nb = document.getElementById('nowBody');
  if (nb) { nb.innerHTML = v2NowBodyHTML(); wire(nb); }
  const tb = document.getElementById('tlBody');
  if (tb) { tb.innerHTML = v2TlBodyHTML(); wire(tb); }
  const ab = document.getElementById('alertBody');
  if (ab) { ab.innerHTML = v2AlertBodyHTML(); wire(ab); }
  const mb = document.getElementById('moreBody');
  if (mb) { mb.innerHTML = v2MoreBodyHTML(); wire(mb); renderSun(); }
  updateTlCount();
}

/* ---------------- §10 timeline: axis labels + coverage (overrides core) ---------------- */
function updateTlCount() {
  const total = tlSnapshots.length;
  const axis = document.getElementById('tlAxis');
  if (!total) {
    if (axis) axis.innerHTML = '<i>--</i><i>--</i><i>--</i><i>現在</i>';
    const c = document.getElementById('tlCount');
    if (c) c.textContent = '尚無今日快照';
    return;
  }
  const avail = playableIndices(mode).length;
  const full = tlSnapshots.filter(s => s.temp && s.temp.length).length;
  const c = document.getElementById('tlCount');
  if (c) {
    c.textContent = `${total} 個歷史快照 · 此圖層 ${avail} 個可播`;
    c.title = `共 ${total} 個快照，其中 ${full} 個含氣溫數據`;
  }
  if (axis) {
    const at = i => tlSnapshots[Math.min(total - 1, Math.max(0, i))].t.slice(11, 16);
    axis.innerHTML = `<i>${at(0)}</i><i>${at(Math.floor(total / 3))}</i><i>${at(Math.floor(total * 2 / 3))}</i><i>現在</i>`;
  }
  if (tlSnapshots.length > 0) v2TlState = true;
  if (tlSnapshots.length !== v2TlSeen) {
    v2TlSeen = tlSnapshots.length;          // monotonic: cannot loop back
    setTimeout(() => v2RenderPanels(), 0);
  }
  const play = document.getElementById('tlPlay');
  if (play) play.setAttribute('aria-pressed', String(tlPlaying));
  const stamp = document.getElementById('tlTime');
  if (stamp) stamp.classList.toggle('limited', !tlPlaying && tlIdx >= 0 && !(tlSnapshots[tlIdx]?.temp || []).length);
}

/* §10 replay the last 60 minutes */
function v2Replay60() {
  const total = tlSnapshots.length;
  if (total < 3) { showToast('歷史快照不足，暫時未能回放'); return; }
  const t1 = new Date(tlSnapshots[total - 1].t.replace(' ', 'T')).getTime();
  let start = total - 1;
  for (let i = total - 1; i >= 0; i--) {
    if (t1 - new Date(tlSnapshots[i].t.replace(' ', 'T')).getTime() > 3600e3) break;
    start = i;
  }
  const seq = playableIndices(mode).filter(i => i >= start);
  if (seq.length < 2) { showToast('過去 60 分鐘在此圖層沒有足夠快照'); return; }
  tlPlaySeq = seq;
  if (tlPlaying) { tlPlaying = false; clearInterval(tlTimer); }
  let pos = 0;
  applySnapshot(seq[pos]);
  tlPlaying = true;
  if (tlSnapshots.length > 0) v2TlState = true;
  if (tlSnapshots.length !== v2TlSeen) {
    v2TlSeen = tlSnapshots.length;          // monotonic: cannot loop back
    setTimeout(() => v2RenderPanels(), 0);
  }
  const play = document.getElementById('tlPlay');
  if (play) { play.textContent = '⏸'; play.setAttribute('aria-pressed', 'true'); }
  document.getElementById('tlLive')?.classList.remove('active');
  showToast(`▶ 回放最近 60 分鐘（${seq.length} 個快照 · ${V2_MODE_UI[mode]?.label || mode}）`);
  tlTimer = setInterval(() => {
    pos++;
    if (pos < tlPlaySeq.length) applySnapshot(tlPlaySeq[pos]);
    else {
      tlPlaying = false; clearInterval(tlTimer);
      const p = document.getElementById('tlPlay');
      if (p) { p.textContent = '▶'; p.setAttribute('aria-pressed', 'false'); }
    }
  }, 900);
}

/* ---------------- layer switcher (§8) ---------------- */
function v2PaintLayerButtons() {
  document.querySelectorAll('#layerMenu .seg[data-mode]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.getElementById('tgLabels')?.setAttribute('aria-pressed', String(!!showLabels));
  document.getElementById('tgSun')?.setAttribute('aria-pressed', String(!!sunOn));
  document.getElementById('tgLegend')?.setAttribute('aria-pressed', String(legBox?.classList.contains('open')));
}
function v2SetMode(m) {
  const key = V2_MODE_ALIAS[m] || m;
  mode = key;
  applyColors();
  applyLegend(key);
  v2PaintLayerButtons();
  updateHud();
  renderInfoBar();
  showToast(`圖層：${V2_MODE_UI[key]?.title || key}`);
}

/* ---------------- interactions ---------------- */
document.querySelectorAll('#layerMenu .seg[data-mode]').forEach(b =>
  b.addEventListener('click', () => v2SetMode(b.dataset.mode)));
document.getElementById('tgLabels')?.addEventListener('click', e => {
  showLabels = !showLabels;
  labelEntities.forEach(x => x.show = showLabels);
  scheduleLabelUpdate();
  v2PaintLayerButtons();
});
document.getElementById('tgSun')?.addEventListener('click', () => {
  sunOn = !sunOn;
  viewer.scene.globe.enableLighting = sunOn;
  // the terminator follows the real time of day (Cesium uses viewer.clock)
  if (sunOn) viewer.clock.currentTime = Cesium.JulianDate.now();
  v2PaintLayerButtons();
  const c = sunCache || {};
  showToast(sunOn
    ? `日夜光照：開（天文台日出 ${c.rise || '—'} / 日落 ${c.set || '—'}）`
    : '日夜光照：關');
});
document.getElementById('tgLegend')?.addEventListener('click', () => {
  legBox?.classList.toggle('open');
  v2PaintLayerButtons();
});
document.getElementById('tlReplay')?.addEventListener('click', v2Replay60);
document.getElementById('hudRetry')?.addEventListener('click', () => { v2LiveOK = null; refresh(); });
document.getElementById('btnMore')?.addEventListener('click', () => v2OpenSheet('more'));
document.getElementById('alertChip')?.addEventListener('click', () => v2OpenSheet('alerts'));
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => v2Tab(b.dataset.tab)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => v2CloseSheets(null)));
backdropEl?.addEventListener('click', () => v2CloseSheets(null));

/* keyboard shortcuts (§21) */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const map = { '1': 'rain', '2': 'temp', '3': 'feels', '4': 'lightning', '5': 'thunder' };
  if (map[e.key]) v2SetMode(map[e.key]);
  else if (e.key === ' ') { e.preventDefault(); document.getElementById('tlPlay')?.click(); }
  else if (e.key === 'l' || e.key === 'L') document.getElementById('tlLive')?.click();
  else if (e.key === 'r' || e.key === 'R') v2Replay60();
  else if (e.key === 'Escape') v2CloseSheets(null);
  else if (e.key === 'g' || e.key === 'G') legBox?.classList.toggle('open');
});

/* draggable bottom sheet (§18) */
document.querySelectorAll('.sheet .grab').forEach(g => {
  const sheet = g.closest('.sheet');
  let y0 = 0, dy = 0, dragging = false;
  const start = e => { dragging = true; y0 = (e.touches ? e.touches[0].clientY : e.clientY); dy = 0; sheet.classList.add('dragging'); };
  const move = e => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    dy = Math.max(0, y - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (dy > 90) v2CloseSheets(null);
  };
  g.addEventListener('touchstart', start, { passive: true });
  g.addEventListener('touchmove', move, { passive: true });
  g.addEventListener('touchend', end);
  g.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
});

/* map picking: hover tooltip + click to open detail */
const tooltip3d = document.getElementById('tooltip3d');
const v2Handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
v2Handler.setInputAction(m => {
  const picked = viewer.scene.pick(m.endPosition);
  if (Cesium.defined(picked) && picked.id && picked.id.polygon && picked.id._wxName) {
    const name = picked.id._wxName, data = liveData[name] || {};
    const T = v2Times();
    tooltip3d.innerHTML =
      `<div class="tt">📍 ${name}</div>` +
      `<div class="tr"><span class="tk">🌡 氣溫</span><span class="tv">${data.temp !== undefined ? data.temp + '°C' : '—'}</span></div>` +
      `<div class="tr"><span class="tk">🥵 體感</span><span class="tv">${data.feels !== undefined ? data.feels + '°C' : '—'}</span></div>` +
      `<div class="tr"><span class="tk">🌧 雨量</span><span class="tv">${data.rain ? data.rain + ' mm' : '0 mm'}</span></div>` +
      `<div class="tr"><span class="tk">⚡ 閃電</span><span class="tv">${data.lightning ? '是' : (data.lhl ? data.lhl + ' 次' : '無')}</span></div>` +
      `<div class="tn">點擊查看詳情 · 資料 ${T.temp || '—'}</div>`;
    tooltip3d.style.display = 'block';
    tooltip3d.style.left = Math.min(window.innerWidth - 245, m.endPosition.x + 14) + 'px';
    tooltip3d.style.top = Math.max(8, m.endPosition.y - 10) + 'px';
    viewer.scene.canvas.style.cursor = 'pointer';
  } else {
    tooltip3d.style.display = 'none';
    viewer.scene.canvas.style.cursor = 'default';
  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
v2Handler.setInputAction(c => {
  const picked = viewer.scene.pick(c.position);
  if (Cesium.defined(picked) && picked.id && picked.id.polygon && picked.id._wxName) showDetail(picked.id._wxName);
  else v2CloseSheets(null);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

/* label refresh on camera move */
viewer.camera.moveEnd.addEventListener(scheduleLabelUpdate);
viewer.camera.changed.addEventListener(scheduleLabelUpdate);

/* §28: show the last known state (clearly labelled) when there is no live data */
let v2CachedShown = false;
function v2ShowCached(why) {
  if (v2CachedShown) return true;   // never overwrite with a later, vaguer message
  let c = null;
  try { c = JSON.parse(localStorage.getItem('wxLastGood') || 'null'); } catch (e) {}
  if (!c) return false;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const num = x => (typeof x === 'number' && !isNaN(x)) ? x : null;
  const bigEl = document.getElementById('hudTemp');
  if (bigEl) bigEl.innerHTML = (num(c.temp) ?? '--') + '<span>°C</span>';
  const fEl = document.getElementById('hudFeels');
  if (fEl) fEl.innerHTML = num(c.feels) !== null ? `體感 <b>${c.feels}°C</b>` : '體感 —';
  set('hudHum', (c.hum || '--') + '%');
  set('hudRain', c.wet ? `${c.wet} 區有雨` : '無雨');
  set('hudLtn', c.struck ? `${c.struck} 區` : '無');
  const nl = document.getElementById('hudNL');
  if (nl) { nl.className = 'nl err'; nl.textContent = `${why} — 顯示最後可用天氣資料（${c.at}）。`; }
  set('hudNLM', `⚠️ 最後資料 ${c.at}`);
  const tt = document.getElementById('hudTime');
  if (tt) tt.innerHTML = `最後更新 ${c.at}（非即時）<br>溫度 ${c.times?.temp || '—'} · 雨量 ${c.times?.rain || '—'}`;
  ['stMax', 'stMin', 'stHum', 'stRain', 'stLtn'].forEach((id, i) => {
    const vals = [num(c.max) !== null ? c.max + '°' : '—', num(c.min) !== null ? c.min + '°' : '—',
                  (c.hum || '--') + '%', c.wetMax ? c.wetMax + 'mm' : '0mm', c.struck ? c.struck + ' 區' : '0'];
    const el = document.getElementById(id); if (el) el.textContent = vals[i];
  });
  v2CachedShown = true;
  return true;
}

/* ---------------- live data hooks (§19/§20/§24) ---------------- */
document.addEventListener('wx:live', ev => {
  const raw = ev.detail || {};
  v2LastRaw = raw;
  const r = raw.rhrread || null;
  const okTemp = !!(r && r.temperature && r.temperature.data && r.temperature.data.length);
  if (okTemp) v2CachedShown = false;
  v2LiveOK = okTemp;
  document.getElementById('ldWx').textContent = okTemp ? '✓ 完成' : '⚠ 未取得';
  document.getElementById('ldWx').className = okTemp ? 'ok' : 'bad';
  const ltn = document.getElementById('ldLtn');
  if (ltn) { ltn.textContent = raw.lhl ? '✓ 完成' : '⚠ 未取得'; ltn.className = raw.lhl ? 'ok' : 'bad'; }
  if (okTemp) {
    const now = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
    const t = v2Stats('temp'), f = v2Stats('feels'), w = v2Wet(), s = v2Struck();
    v2LastGood = { at: now, raw };
    try {
      localStorage.setItem('wxLastGood', JSON.stringify({
        at: now, temp: t.avg, max: t.max, min: t.min, maxD: t.maxD, minD: t.minD,
        feels: f.avg, hum: infoCache.hum, wet: w.length, wetMax: w[0] ? w[0][1] : 0, wetD: w[0] ? w[0][0] : null,
        struck: s.length, times: v2Times(),
      }));
    } catch (e) {}
  }
  updateHud();
});
document.getElementById('ldBar').style.width = '35%';
setTimeout(() => { const b = document.getElementById('ldBar'); if (b) b.style.width = '70%'; }, 2500);
let v2MapTries = 0;
const v2MapPoll = setInterval(() => {
  const el = document.getElementById('ldMap');
  if (!el) return;
  if (hkTileset) { el.textContent = '✓ 完成'; el.className = 'ok'; clearInterval(v2MapPoll); return; }
  if (++v2MapTries > 14) { el.textContent = '⚠ 3D 未載入'; el.className = 'bad'; clearInterval(v2MapPoll); }
}, 1500);
/* if nothing live arrives (offline / blocked), fall back to the cached state */
setTimeout(() => {
  if (v2LiveOK === null) { v2LiveOK = false; updateHud(); v2ShowCached('⚠️ 未能連接天文台'); }
}, 14000);
/* if no snapshot ever arrives, say so instead of showing "loading" forever */
setTimeout(() => { if (v2TlState === null) { v2TlState = false; v2RenderPanels(); } }, 25000);

/* offline handling (§28) */
function v2Offline(on) {
  if (on) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('wxLastGood') || 'null'); } catch (e) {}
    showToast(cached ? `⚠️ 離線 — 顯示最後資料（${cached.at}）` : '⚠️ 離線');
    const chip = document.getElementById('alertChip');
    if (chip) { chip.className = 'chip warn'; chip.textContent = '⚡ 離線'; }
  } else refresh();
  updateHud();
}
if (!navigator.onLine) setTimeout(() => v2ShowCached('⚡ 離線'), 600);
window.addEventListener('offline', () => v2Offline(true));
window.addEventListener('online', () => v2Offline(false));

/* clock in the header */
setInterval(() => {
  const el = document.getElementById('hdrClock');
  if (el) el.textContent = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}, 10000);

/* ---------------- boot ---------------- */
applyLegend(mode);
v2PaintLayerButtons();
updateHud();
renderInfoBar();
setTimeout(() => { applyColors(); updateTlCount(); }, 1200);
console.log('%c HK Weather 3D V2 ', 'background:#4ea8de;color:#04121e;font-weight:700', 'UI layer ready');

/* PWA (§28) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update().catch(() => {}))
      .catch(() => {});
  });
}
