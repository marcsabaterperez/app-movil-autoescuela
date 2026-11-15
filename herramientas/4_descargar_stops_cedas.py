import json, sys, time, requests
UA = {"User-Agent": "rutas-moto-prototype/0.1"}
geo = json.load(open(sys.argv[1], encoding="utf-8"))
allc = [c for f in geo["features"] for poly in ([f["geometry"]["coordinates"]] if f["geometry"]["type"]=="Polygon" else f["geometry"]["coordinates"]) for r in poly for c in r]
s, w, n, e = min(c[1] for c in allc), min(c[0] for c in allc), max(c[1] for c in allc), max(c[0] for c in allc)
q = f"""[out:json][timeout:120][bbox:{s},{w},{n},{e}];
node["highway"~"^(stop|give_way)$"]->.s;
.s out body;
way(bn.s)["highway"];
out body geom;"""
mirrors = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
data = None
for intento in range(3):
    for url in mirrors:
        try:
            r = requests.post(url, data={"data": q}, headers=UA, timeout=150); r.raise_for_status()
            data = r.json(); print("ok", url); break
        except Exception as ex: print("fallo", url, str(ex)[:100])
    if data: break
    time.sleep(15)
if not data: sys.exit(1)
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
nodos = [x for x in data["elements"] if x["type"] == "node"]
vias = [x for x in data["elements"] if x["type"] == "way"]
from collections import Counter
print("nodos", Counter(x["tags"].get("highway") for x in nodos))
print("tags direccion", Counter(x["tags"].get("direction", "-") for x in nodos).most_common(8))
print("vias", len(vias), Counter(v["tags"].get("highway") for v in vias).most_common(12))
