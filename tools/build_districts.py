#!/usr/bin/env python3
"""Build dist_geo.json from the REAL 18-district administrative boundary geojson.
Source: https://gist.githubusercontent.com/kenchu/e36fe5b402b2acf584eb921fcc46ace0/raw/hk_district_boundary.geojson
"""
import json, os, time

OUT = "/tmp/wx-thunder"
os.makedirs(OUT, exist_ok=True)

d = json.load(open("/tmp/hk_districts.geojson"))
EN = {"中西區":"Central & Western","灣仔":"Wan Chai","東區":"Eastern","南區":"Southern",
"油尖旺":"Yau Tsim Mong","深水埗":"Sham Shui Po","九龍城":"Kowloon City","黃大仙":"Wong Tai Sin",
"觀塘":"Kwun Tong","荃灣":"Tsuen Wan","屯門":"Tuen Mun","元朗":"Yuen Long",
"北區":"North","大埔":"Tai Po","西貢":"Sai Kung","沙田":"Sha Tin","葵青":"Kwai Tsing","離島":"Islands"}

districts = []
for f in d["features"]:
    props = f["properties"]
    tc = props["地區"]
    geom = f["geometry"]
    polys = []
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    rings = []
    for poly in polys:
        ring = poly[0]  # exterior ring
        if ring and len(ring) >= 4:
            rings.append([[round(p[0], 6), round(p[1], 6)] for p in ring])
    if not rings:
        continue
    # centroid from ring points
    all_pts = [pt for ring in rings for pt in ring]
    cx = sum(p[0] for p in all_pts) / len(all_pts)
    cy = sum(p[1] for p in all_pts) / len(all_pts)
    districts.append({
        "tc": tc, "en": EN.get(tc, props.get("District", tc)),
        "cx": round(cx, 6), "cy": round(cy, 6), "rings": rings,
    })

districts.sort(key=lambda d: d["tc"])
with open(f"{OUT}/dist_geo.json", "w") as f:
    json.dump({"districts": districts, "built": time.strftime("%Y-%m-%dT%H:%M:%S+08:00")}, f, ensure_ascii=False)

print(f"Wrote dist_geo.json: {len(districts)} real admin districts")
for d in districts:
    print(f"  {d['tc']} ({d['en']}) — {len(d['rings'])} ring, {len(d['rings'][0])} pts")
