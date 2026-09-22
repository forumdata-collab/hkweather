// wx-thunder /api/history — query R2 snapshots for timeline playback
// GET /api/history?date=2026-09-22            -> all snapshots that day
// GET /api/history?start=14:00&end=16:30      -> time-window filtered
// GET /api/history?latest=1                   -> most recent snapshot
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date') || todayHK();
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const latest = url.searchParams.get('latest') === '1';

  const bucket = context.env.WX_THUNDER_R2;
  const prefix = `snapshots/${date}/`;

  try {
    // list all objects under the date prefix
    const listed = await bucket.list({ prefix });
    if (!listed.objects.length) {
      return json({ error: 'no data', date, hint: 'snapshot starts collecting after cron; check date' }, 404);
    }

    // sort by key (HH-MM.json)
    listed.objects.sort((a, b) => a.key.localeCompare(b.key));

    let keys = listed.objects.map(o => o.key);
    if (latest) keys = keys.slice(-1);

    const snaps = [];
    for (const key of keys) {
      const hhmm = key.split('/').pop().replace('.json', '');
      if (start && hhmm < start) continue;
      if (end && hhmm > end) continue;
      const obj = await bucket.get(key);
      if (!obj) continue;
      snaps.push(JSON.parse(await obj.text()));
    }
    if (!snaps.length) return json({ error: 'no data in window', date, start, end }, 404);

    return json({ ok: true, date, count: snaps.length, snaps });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

function todayHK() {
  // HKT = UTC+8
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}