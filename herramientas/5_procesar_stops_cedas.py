import json, sys, time, math, requests
from collections import Counter
UA = {"User-Agent": "rutas-moto-prototype/0.1"}
geo = json.load(open(sys.argv[1], encoding="utf-8"))
raw = json.load(open(sys.argv[2], encoding="utf-8"))
salida_puntos = sys.argv[3]

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
        for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]):
            if pip(lon, lat, poly[0]) and not any(pip(lon, lat, h) for h in poly[1:]): return f["properties"]["nombre"]
    return None
def dist(a, b):
    return math.hypot((b[1]-a[1]) * math.cos(math.radians(a[0])) * 111320, (b[0]-a[0]) * 110540)
def rumbo(a, b):
    y = math.sin(math.radians(b[1]-a[1])) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0]))*math.sin(math.radians(b[0])) - math.sin(math.radians(a[0]))*math.cos(math.radians(b[0]))*math.cos(math.radians(b[1]-a[1]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360

# Nodos de rotondas (para descartar los ceda el paso de entrada a rotonda)
allc = [c for f in geo["features"] for poly in ([f["geometry"]["coordinates"]] if f["geometry"]["type"]=="Polygon" else f["geometry"]["coordinates"]) for r in poly for c in r]
s, w, n, e = min(c[1] for c in allc), min(c[0] for c in allc), max(c[1] for c in allc), max(c[0] for c in allc)
q = f'[out:json][timeout:90][bbox:{s},{w},{n},{e}];way["junction"~"^(roundabout|circular)$"];out skel;'
rot = None
for url in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]:
    try:
        rq = requests.post(url, data={"data": q}, headers=UA, timeout=120); rq.raise_for_status(); rot = rq.json(); break
    except Exception as ex: print("fallo", url, str(ex)[:80])
nodos_rotonda = {nid for x in rot["elements"] for nid in x.get("nodes", [])}
print("nodos de rotonda", len(nodos_rotonda))

CONDUCIBLES = {"residential","tertiary","secondary","primary","unclassified","living_street","tertiary_link","secondary_link","primary_link","trunk_link","motorway_link","trunk"}
nodos = {x["id"]: x for x in raw["elements"] if x["type"] == "node"}
vias = [x for x in raw["elements"] if x["type"] == "way" and x["tags"].get("highway") in CONDUCIBLES]
padres = {}
for v in vias:
    for i, nid in enumerate(v["nodes"]):
        if nid in nodos: padres.setdefault(nid, []).append((v, i))

motivos = Counter(); salida = []
for nid, nd in nodos.items():
    tipo = "stop" if nd["tags"]["highway"] == "stop" else "ceda"
    m = muni(nd["lon"], nd["lat"])
    if not m: motivos["fuera"] += 1; continue
    ps = padres.get(nid, [])
    if len(ps) != 1: motivos["via ambigua o no conducible"] += 1; continue
    v, i = ps[0]
    g = [(p["lat"], p["lon"]) for p in v["geometry"]]
    last = len(g) - 1
    d = nd["tags"].get("direction", nd["tags"].get(f"{nd['tags']['highway']}:direction", ""))
    oneway = v["tags"].get("oneway", "no")
    if d == "forward": adelante = True
    elif d == "backward": adelante = False
    elif i == last: adelante = True
    elif i == 0: adelante = False
    else:
        a_inicio = sum(dist(g[k], g[k+1]) for k in range(i))
        a_final = sum(dist(g[k], g[k+1]) for k in range(i, last))
        adelante = a_final <= a_inicio
    if oneway in ("yes", "true", "1"):
        if d == "backward": motivos["contradice sentido unico"] += 1; continue
        adelante = True
    elif oneway == "-1":
        if d == "forward": motivos["contradice sentido unico"] += 1; continue
        adelante = False
    fin = v["nodes"][-1] if adelante else v["nodes"][0]
    if tipo == "ceda" and (fin in nodos_rotonda or v["tags"].get("junction") in ("roundabout", "circular")):
        motivos["ceda de rotonda"] += 1; continue
    if adelante: r = rumbo(g[i], g[i+1]) if i < last else rumbo(g[i-1], g[i])
    else: r = rumbo(g[i], g[i-1]) if i > 0 else rumbo(g[i+1], g[i])
    salida.append({"lat": round(nd["lat"], 6), "lon": round(nd["lon"], 6), "tipo": tipo, "municipio": m, "nombre": v["tags"].get("name", ""), "rumbo": round(r)})
# Quitar duplicados muy cercanos con el mismo sentido
final = []
for p in salida:
    if any(q["tipo"] == p["tipo"] and dist((p["lat"], p["lon"]), (q["lat"], q["lon"])) < 20 and min(abs(p["rumbo"]-q["rumbo"]), 360-abs(p["rumbo"]-q["rumbo"])) < 40 for q in final):
        motivos["duplicado"] += 1; continue
    final.append(p)
print("descartes", dict(motivos))
print("validos", Counter((p["municipio"], p["tipo"]) for p in final))
base = [p for p in json.load(open(salida_puntos, encoding="utf-8")) if p["tipo"] in ("rotonda", "semaforo")]
json.dump(base + final, open(salida_puntos, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("puntos.json total", len(base) + len(final))
