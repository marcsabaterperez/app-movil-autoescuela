import json, time, requests, sys, math
UA = {"User-Agent": "rutas-moto-prototype/0.1"}
geo = json.load(open(sys.argv[1], encoding="utf-8"))
def rings(g):
    return g["coordinates"] if g["type"] == "Polygon" else [r for p in g["coordinates"] for r in p]
def pip(lon, lat, ring):
    ins = False; j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi: ins = not ins
        j = i
    return ins
def muni(lon, lat):
    for f in geo["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            if pip(lon, lat, poly[0]) and not any(pip(lon, lat, h) for h in poly[1:]):
                return f["properties"]["nombre"]
    return None
allc = [c for f in geo["features"] for r in rings(f["geometry"]) for c in r]
s, w, n, e = min(c[1] for c in allc), min(c[0] for c in allc), max(c[1] for c in allc), max(c[0] for c in allc)
print("bbox", s, w, n, e)
ROADS = "^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"
q = f"""[out:json][timeout:90][bbox:{s},{w},{n},{e}];
( way["junction"~"^(roundabout|circular)$"]["highway"~"{ROADS}"]["access"!~"^(private|no|military)$"];
  node["highway"="traffic_signals"]; );
out center tags;"""
mirrors = ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
data = None
for attempt in range(2):
    for url in mirrors:
        try:
            r = requests.post(url, data={"data": q}, headers=UA, timeout=120); r.raise_for_status()
            data = r.json(); print("ok", url); break
        except Exception as ex:
            print("fallo", url, str(ex)[:120])
    if data: break
    time.sleep(10)
if not data: sys.exit(1)
pts = []
for el in data["elements"]:
    if el["type"] == "way": c = el["center"]; t = "rotonda"; nombre = el.get("tags", {}).get("name", "")
    else: c = {"lat": el["lat"], "lon": el["lon"]}; t = "semaforo"; nombre = ""
    m = muni(c["lon"], c["lat"])
    if m: pts.append({"lat": round(c["lat"], 6), "lon": round(c["lon"], 6), "tipo": t, "municipio": m, "nombre": nombre})
def d(a, b):
    return math.hypot((b["lon"]-a["lon"]) * math.cos(math.radians(a["lat"])) * 111320, (b["lat"]-a["lat"]) * 110540)
kept = [p for p in pts if p["tipo"] == "rotonda"]
sem = []
for p in pts:
    if p["tipo"] == "semaforo" and all(d(p, k) > 80 for k in sem) and all(d(p, k) > 60 for k in kept):
        sem.append(p)
kept += sem
from collections import Counter
print(Counter((k["municipio"], k["tipo"]) for k in kept))
json.dump(kept, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
