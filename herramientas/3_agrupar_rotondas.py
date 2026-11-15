# Une en un solo punto los tramos de una misma rotonda (en OSM una rotonda suele estar partida en varias vías).
# Uso: python 3_agrupar_rotondas.py ../data/puntos.json
import json, math, sys
ruta = sys.argv[1]
p = json.load(open(ruta, encoding="utf-8"))
def d(a, b): return math.hypot((b["lon"]-a["lon"])*math.cos(math.radians(a["lat"]))*111320, (b["lat"]-a["lat"])*110540)
rot = [x for x in p if x["tipo"] == "rotonda"]; resto = [x for x in p if x["tipo"] != "rotonda"]
grupos = []
for r in rot:
    for g in grupos:
        if d(r, g[0]) < 90 and g[0]["municipio"] == r["municipio"]: g.append(r); break
    else: grupos.append([r])
salida = [{"lat": round(sum(x["lat"] for x in g)/len(g), 6), "lon": round(sum(x["lon"] for x in g)/len(g), 6), "tipo": "rotonda",
           "municipio": g[0]["municipio"], "nombre": next((x["nombre"] for x in g if x["nombre"]), "")} for g in grupos]
json.dump(salida + resto, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("rotondas", len(salida), "otros", len(resto))
