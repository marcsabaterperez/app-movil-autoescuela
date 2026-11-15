# Herramientas de datos

Scripts en Python (necesitan `requests`) que generaron los ficheros de `data/` a partir de OpenStreetMap
(Nominatim y Overpass) y del servidor de rutas OSRM. Ejecutar en orden desde esta carpeta:

```bash
python 1_limites_municipios.py ../data/municipios.geojson
python 2_rotondas_semaforos.py ../data/municipios.geojson ../data/puntos.json
python 3_agrupar_rotondas.py ../data/puntos.json
python 4_descargar_stops_cedas.py ../data/municipios.geojson senales_raw.json
python 5_procesar_stops_cedas.py ../data/municipios.geojson senales_raw.json ../data/puntos.json
python 6_validar_stops_cedas.py ../data/municipios.geojson ../data/puntos.json
```

Los servidores públicos de Overpass fallan a menudo (502/504): los scripts prueban varios espejos.
