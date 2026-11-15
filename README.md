# PractiRuta Moto (prototipo)

App web para generar rutas aleatorias de práctica para el examen práctico de moto en
**Alcalá de Henares, Torrejón de Ardoz, Coslada y San Fernando de Henares**, con mapa,
indicaciones paso a paso, navegación GPS con voz y exportación GPX.

**Versión publicada (para el móvil):** https://marcsabaterperez.github.io/app-movil-autoescuela/

## Cómo abrirla en Windows

Necesita un servidor web local (los módulos JS y los datos no cargan abriendo el `index.html` con doble clic).
Desde la carpeta del proyecto:

```bash
python -m http.server 8850
```

Después abre http://localhost:8850 en Chrome o Edge. Hace falta conexión a internet (mapa y cálculo de rutas).

## Qué hace

1. **Zonas**: los 4 municipios, con sus límites oficiales de OpenStreetMap. Puedes marcar uno o varios.
   Con varias zonas, la ruta pasa por al menos dos municipios (el tramo entre ciudades puede ir por autovía).
2. **Salida**: Centro de exámenes DGT (Av. Europa, 6, 28806 Alcalá de Henares), tu ubicación GPS o
   "Seleccionar": tocas el mapa o buscas una dirección, y arrastras el marcador para afinar el punto exacto.
   La app indica en qué calle empezará la ruta.
3. **Duración**: 30, 45, 60 o 90 min, con ajuste opcional por tráfico (+15 % / +30 %).
4. **Generar**: crea una ruta circular (vuelve al punto de salida) sin salir de las zonas marcadas.
5. **Resultado**: duración, km, nº de rotondas, giros a izquierda y derecha, incorporaciones,
   carreteras usadas, reparto por municipio e indicaciones paso a paso.
6. **Navegación**: sigue tu posición GPS, muestra la siguiente maniobra, avisa por voz en español,
   detecta si te sales de la ruta y mantiene la pantalla encendida. "Simular recorrido" la prueba sin moverte.
7. **Guardar / GPX / Google Maps**: guarda rutas en el dispositivo, exporta GPX (OsmAnd, Wikiloc, etc.)
   o abre una versión aproximada en Google Maps (solo admite unos pocos puntos intermedios).

La app trae una **ruta de ejemplo de 60 min** (sale y vuelve al Centro de exámenes DGT, pasa por Torrejón usando la A-2):
60 min, 35,4 km, 67 rotondas. También está en `rutas/ruta_60min_centro_dgt.gpx`.

El punto del centro de exámenes es el elemento de OpenStreetMap "Centro de Exámenes DGT Alcalá de Henares"
(Avenida de Europa, 40.48600, -3.38376).

## Cómo se genera la ruta

- Puntos de paso reales: 396 rotondas y 34 cruces con semáforo de OSM dentro de los 4 municipios (`data/puntos.json`).
- Se eligen al azar con un "paseo aleatorio" desde la salida y el motor OSRM los ordena en un circuito óptimo.
- Se añaden o quitan puntos hasta quedar a ±3 min de la duración pedida.
- Cada tramo se comprueba contra los límites municipales; si uno se sale, se descarta ese punto.
- Si la zona es pequeña (por ejemplo, solo Coslada) y el circuito no llega al tiempo, se encadenan más puntos
  en orden aleatorio, pudiendo repetir alguna calle.

## Limitaciones del prototipo

- **Duraciones**: son las del router para coche, **sin tráfico ni semáforos**. En ciudad la ruta real suele durar más; usa el ajuste por tráfico.
- **Servidores públicos gratuitos**: rutas con el servidor de demostración de OSRM y mapa con las teselas de OpenStreetMap.
  Sirven para pruebas, no para una app publicada (límites de uso).
- **No son rutas oficiales de examen**: la DGT no publica sus recorridos. La app genera recorridos de práctica por las calles de esas zonas.
- Datos de OSM descargados el 15/11/2026 (`data/`). Se pueden actualizar con los scripts usados.

## Camino a Android

El código es una web estándar (HTML + JS + Leaflet), así que se puede empaquetar como app Android con **Capacitor** sin reescribirla:

1. `npm init` + `npm install @capacitor/core @capacitor/cli @capacitor/android` y `npx cap init`.
2. Copiar esta carpeta como `www/` y `npx cap add android`, luego abrir en Android Studio y generar el APK/AAB.
3. Cambiar la geolocalización del navegador por `@capacitor/geolocation` (y un plugin de ubicación en segundo plano si se quiere navegar con la pantalla apagada).
4. Para producción: servidor de rutas propio (OSRM o Valhalla con datos de la Comunidad de Madrid) o un proveedor de pago
   (Google Routes, Mapbox, HERE), teselas de un proveedor con licencia y empaquetar Leaflet en local.

Alternativa inmediata: publicarla con HTTPS (por ejemplo GitHub Pages) y abrirla en Chrome del móvil; se puede "instalar" como app (incluye `manifest.webmanifest`).

## Estructura

```
index.html               Interfaz
css/estilos.css          Estilos (escritorio y móvil)
js/app.js                Mapa, interfaz, guardado, exportación y navegación
js/generador.js          Algoritmo de rutas aleatorias
js/navegacion.js         Seguimiento GPS, avisos y salida de ruta
js/instrucciones.js      Textos de maniobras en español, iconos y formatos
js/osrm.js               Cliente del motor de rutas
js/geo.js                Geometría (distancias, punto en polígono)
data/municipios.geojson  Límites de los 4 municipios (OSM)
data/puntos.json         Rotondas y semáforos usados como puntos de paso (OSM)
data/rutas_ejemplo.json  Ruta de ejemplo de 60 min
rutas/                   Rutas exportadas en GPX
```

Datos de mapa © colaboradores de OpenStreetMap (licencia ODbL).
