#!/usr/bin/env python3
"""wx-thunder snapshot: fetch HKO live APIs every 5 min, store to R2.
Key: snapshots/YYYY-MM-DD/HH-MM.json  (compact: lightning zones + rainfall + warn)
Retention: keep last 7 days (delete older prefixes).
"""
import json, os, sys, time, boto3, urllib.request
from datetime import datetime, timedelta

HKO = "https://data.weather.gov.hk/weatherAPI/opendata"
RETENTION_DAYS = 7          # snapshots older than this date prefix are purged
QUIET = "--quiet" in sys.argv

def fetch_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def main():
    ts = int(time.time())
    now = datetime.now()
    snap = {"t": now.strftime("%Y-%m-%dT%H:%M:%S+08:00")}

    try:
        snap["rhr"] = fetch_json(f"{HKO}/weather.php?dataType=rhrread&lang=tc&_={ts}")
    except Exception as e:
        snap["rhr"] = None; print(f"rhr fail: {e}", file=sys.stderr)
    try:
        snap["warn"] = fetch_json(f"{HKO}/weather.php?dataType=warnsum&lang=tc&_={ts}")
    except Exception as e:
        snap["warn"] = None; print(f"warn fail: {e}", file=sys.stderr)
    try:
        snap["rain"] = fetch_json(f"{HKO}/hourlyRainfall.php?lang=tc&_={ts}")
    except Exception as e:
        snap["rain"] = None; print(f"rain fail: {e}", file=sys.stderr)
    try:
        snap["lhl"] = json.loads(fetch(f"{HKO}/opendata.php?dataType=LHL&lang=tc&rformat=json&_={ts}"))
    except Exception as e:
        snap["lhl"] = None; print(f"lhl fail: {e}", file=sys.stderr)
    try:
        snap["fnd"] = fetch_json(f"{HKO}/weather.php?dataType=fnd&lang=tc&_={ts}")
    except Exception as e:
        snap["fnd"] = None; print(f"fnd fail: {e}", file=sys.stderr)

    # compact: keep only what the map needs
    compact = {
        "t": snap["t"],
        "ltn": [(l.get("place"), l.get("occur")) for l in (snap["rhr"] or {}).get("lightning", {}).get("data", [])],
        "wts": (snap["warn"] or {}).get("WTS"),
        "rain": [(s.get("automaticWeatherStation"), s.get("value")) for s in (snap["rain"] or {}).get("hourlyRainfall", [])],
        "rmax": [(s.get("place"), s.get("max")) for s in (snap["rhr"] or {}).get("rainfall", {}).get("data", [])],
        "temp": [(s.get("place"), s.get("value")) for s in (snap["rhr"] or {}).get("temperature", {}).get("data", [])],
        "hum": [(s.get("place"), s.get("value")) for s in (snap["rhr"] or {}).get("humidity", {}).get("data", [])],
        "lhl": [[r[1], r[2], r[3]] for r in ((snap["lhl"] or {}).get("data") or [])],
        "sea": (snap["fnd"] or {}).get("seaTemp"),
        "soil": (snap["fnd"] or {}).get("soilTemp"),
    }
    body = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))

    s3 = boto3.client("s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"])
    key = f"snapshots/{now.strftime('%Y-%m-%d')}/{now.strftime('%H-%M')}.json"
    s3.put_object(Bucket="wx-thunder", Key=key, Body=body, ContentType="application/json")
    if not QUIET:
        print(f"OK {key} {len(body)}B")

    # retention: delete date prefixes older than RETENTION_DAYS
    cutoff = (now - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d")
    for prefix in _list_prefixes(s3):
        if prefix < cutoff:
            _delete_prefix(s3, prefix)
            print(f"purged {prefix}")

def _list_prefixes(s3):
    resp = s3.list_objects_v2(Bucket="wx-thunder", Prefix="snapshots/", Delimiter="/")
    return [p["Prefix"].rstrip("/").split("/")[-1] for p in resp.get("CommonPrefixes", [])]

def _delete_prefix(s3, prefix):
    cont = True; marker = None
    while cont:
        kw = dict(Bucket="wx-thunder", Prefix=f"snapshots/{prefix}/")
        if marker: kw["StartAfter"] = marker
        resp = s3.list_objects_v2(**kw)
        keys = [o["Key"] for o in resp.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket="wx-thunder", Delete={"Objects": [{"Key": k} for k in keys]})
        cont = resp.get("IsTruncated", False)
        marker = keys[-1] if keys else None

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # non-zero exit so the cron wrapper's `|| echo FAIL` actually fires
        print(f"wx-thunder snapshot FAILED: {e}", file=sys.stderr)
        sys.exit(1)