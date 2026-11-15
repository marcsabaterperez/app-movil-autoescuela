import json, time, requests, sys
UA = {"User-Agent": "rutas-moto-prototype/0.1"}
NAMES = ["Alcalá de Henares", "Torrejón de Ardoz", "Coslada", "San Fernando de Henares"]
out = []
for n in NAMES:
    r = requests.get("https://nominatim.openstreetmap.org/search", params={
        "q": f"{n}, Comunidad de Madrid, España", "format": "jsonv2", "polygon_geojson": 1,
        "polygon_threshold": 0.00003, "limit": 5, "featureType": "settlement"}, headers=UA, timeout=60)
    r.raise_for_status()
    res = [x for x in r.json() if x.get("osm_type") == "relation" and x.get("type") == "administrative"]
    if not res:
        print("NO RESULT", n, [ (x.get('osm_type'), x.get('type'), x.get('display_name')) for x in r.json()]); continue
    x = res[0]
    g = x["geojson"]
    npts = sum(len(ring) for poly in (g["coordinates"] if g["type"]=="MultiPolygon" else [g["coordinates"]]) for ring in poly)
    print(n, x["osm_id"], x["display_name"], g["type"], npts, "centro", x["lat"], x["lon"])
    out.append({"type": "Feature", "properties": {"nombre": n, "osm_relation": x["osm_id"], "centro": [float(x["lat"]), float(x["lon"])]}, "geometry": g})
    time.sleep(1.2)
json.dump({"type": "FeatureCollection", "features": out}, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
