import json, sys, time, re, requests
from collections import Counter
UA = {"User-Agent": "rutas-moto-prototype/0.1"}
geo = json.load(open(sys.argv[1], encoding="utf-8"))
ruta_puntos = sys.argv[2]
P = json.load(open(ruta_puntos, encoding="utf-8"))
centros = {f["properties"]["nombre"]: f["properties"]["centro"] for f in geo["features"]}
OSRM = "https://router.project-osrm.org/table/v1/driving/"
ultimo = [0.0]
def pedir(url):
    espera = ultimo[0] + 1.2 - time.time()
    if espera > 0: time.sleep(espera)
    ultimo[0] = time.time()
    return requests.get(url, headers=UA, timeout=60).json()

def tabla(centro, sens, sentido):
    coords = ";".join([f"{centro[1]:.6f},{centro[0]:.6f}"] + [f"{s['lon']:.6f},{s['lat']:.6f}" for s in sens])
    bear = ";".join([""] + [f"{s['rumbo']},40" for s in sens])
    rad = ";".join(["unlimited"] + ["30"] * len(sens))
    if sentido == "ida": sel = "sources=0"
    else: sel = "destinations=0&sources=" + ";".join(str(i) for i in range(1, len(sens) + 1))
    return pedir(f"{OSRM}{coords}?{sel}&bearings={bear}&radiuses={rad}")

senales = [p for p in P if p["tipo"] in ("stop", "ceda")]
validas, motivos = [], Counter()
for muni, centro in centros.items():
    pend = [s for s in senales if s["municipio"] == muni]
    for k in range(0, len(pend), 80):
        bloque = pend[k:k+80]
        ok = {}
        for sentido in ("ida", "vuelta"):
            actual = list(bloque)
            while actual:
                d = tabla(centro, actual, sentido)
                if d.get("code") == "NoSegment":
                    m = re.search(r"coordinate (\d+)", d.get("message", ""))
                    i = int(m.group(1)) - 1 if m else None
                    if i is None or i < 0: print("NoSegment sin indice", d); break
                    motivos["sin calle en ese sentido"] += 1; actual.pop(i); continue
                if d.get("code") != "Ok": print("error", d.get("code"), d.get("message")); break
                if sentido == "ida": durs = d["durations"][0][1:]
                else: durs = [fila[0] for fila in d["durations"]]
                for s, t in zip(actual, durs):
                    ok.setdefault(id(s), set())
                    if t is not None: ok[id(s)].add(sentido)
                break
        for s in bloque:
            v = ok.get(id(s), set())
            if v == {"ida", "vuelta"}: validas.append(s)
            else: motivos["inalcanzable"] += 1
print("descartadas", dict(motivos))
print("validas", Counter((s["municipio"], s["tipo"]) for s in validas))
otros = [p for p in P if p["tipo"] not in ("stop", "ceda")]
json.dump(otros + validas, open(ruta_puntos, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("puntos.json total", len(otros) + len(validas))
