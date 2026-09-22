// wx-thunder /api/history — query R2 snapshots for timeline playback
// GET /api/history?date=2026-09-22            -> all snapshots that day
// GET /api/history?start=14:00&end=16:30      -> time-window filtered
// GET /api/history?latest=1                   -> most recent snapshot
//
// R2 read cost is one list + one get per snapshot, and a full day is 288
// snapshots (5-minute cadence). Two things keep that cheap:
//   1. the response is stored in the Cloudflare edge cache (Cache API), so any
//      number of visitors inside the TTL window share ONE burst of R2 reads —
//      a header alone is not enough, Pages Functions report cf-cache-status
//      DYNAMIC and never populate the edge cache by themselves
//   2. the per-snapshot gets run in parallel instead of sequentially
const CACHE_TTL_TODAY = 300;      // today changes every 5 minutes
const CACHE_TTL_PAST = 86400;     // a finished day can never change

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const cache = caches.default;

  const date = url.searchParams.get('date') || todayHK();
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const latest = url.searchParams.get('latest') === '1';
  const bucket = context.env.WX_THUNDER_R2;

  const isToday = date === todayHK();
  const ttl = isToday ? CACHE_TTL_TODAY : CACHE_TTL_PAST;
  // The Cache API does NOT honour Cache-Control expiry, so freshness has to come
  // from the key: today's key changes every TTL seconds, past days never change.
  const gen = isToday ? Math.floor(Date.now() / 1000 / ttl) : 'final';
  const cacheKey = new Request(
    url.origin + url.pathname + url.search + (url.search ? '&' : '?') + '__gen=' + gen,
    { method: 'GET' }
  );

  // 1. edge cache lookup
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const listed = await bucket.list({ prefix: `snapshots/${date}/` });
    if (!listed.objects.length) {
      return json({ error: 'no data', date, hint: 'snapshot starts collecting after cron; check date' }, 404, 30);
    }

    // sort by key (HH-MM.json)
    listed.objects.sort((a, b) => a.key.localeCompare(b.key));
    let keys = listed.objects.map(o => o.key);
    if (latest) keys = keys.slice(-1);

    const wanted = keys.filter(key => {
      const hhmm = key.split('/').pop().replace('.json', '');
      if (start && hhmm < start) return false;
      if (end && hhmm > end) return false;
      return true;
    });

    // fetch in small batches: 68 parallel subrequests blow past the Workers
    // concurrency/subrequest ceiling and the failures used to be swallowed by
    // .catch(() => null), silently truncating the day to whatever survived
    const BATCH = 8;
    const snaps = [];
    let missed = 0;
    for (let i = 0; i < wanted.length; i += BATCH) {
      const slice = wanted.slice(i, i + BATCH);
      const objs = await Promise.all(slice.map(key =>
        bucket.get(key).catch(err => { console.warn('r2 get failed', key, err && err.message); return null; })
      ));
      for (const o of objs) {
        if (!o) { missed++; continue; }
        try { snaps.push(JSON.parse(await o.text())); }
        catch (err) { missed++; }
      }
    }
    if (!snaps.length) return json({ error: 'no data in window', date, start, end }, 404, 30);

    const resp = json({ ok: true, date, count: snaps.length, listed: keys.length, missed, snaps }, 200, ttl);
    // 2. populate the edge cache (never block the response on it)
    context.waitUntil(cache.put(cacheKey, resp.clone()).catch(() => {}));
    return resp;
  } catch (e) {
    return json({ error: String(e) }, 500, 0);
  }
}

function todayHK() {
  // HKT = UTC+8
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function json(data, status = 200, maxAge = 0) {
  const cache = maxAge > 0
    ? `public, max-age=${maxAge}, s-maxage=${maxAge}`
    : 'no-store';
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
