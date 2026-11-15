// Utilidades geográficas: distancias, punto en polígono y pertenencia a las zonas.
// Coordenadas internas de la app: [lat, lon]. GeoJSON usa [lon, lat].

export const M_POR_GRADO_LAT = 110540;
export const mPorGradoLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export function distM(a, b) {
  const x = (b[1] - a[1]) * mPorGradoLon((a[0] + b[0]) / 2);
  const y = (b[0] - a[0]) * M_POR_GRADO_LAT;
  return Math.hypot(x, y);
}

export function prepararZonas(geojson) {
  return geojson.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const poly of polys) for (const [lon, lat] of poly[0]) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    }
    return {
      nombre: f.properties.nombre,
      centro: f.properties.centro,
      polys,
      bbox: { minLat, maxLat, minLon, maxLon },
      feature: f,
    };
  });
}

function enAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function enPoligono(lon, lat, poly) {
  if (!enAnillo(lon, lat, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (enAnillo(lon, lat, poly[i])) return false;
  return true;
}

function enZona(lat, lon, z) {
  const b = z.bbox;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return false;
  return z.polys.some((p) => enPoligono(lon, lat, p));
}

// Distancia (m) desde un punto al borde más cercano de la zona.
function distBorde(lat, lon, z) {
  const kx = mPorGradoLon(lat);
  let mejor = Infinity;
  for (const poly of z.polys) for (const anillo of poly) {
    for (let i = 0; i < anillo.length - 1; i++) {
      const ax = (anillo[i][0] - lon) * kx, ay = (anillo[i][1] - lat) * M_POR_GRADO_LAT;
      const bx = (anillo[i + 1][0] - lon) * kx, by = (anillo[i + 1][1] - lat) * M_POR_GRADO_LAT;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? -(ax * dx + ay * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < mejor) mejor = d;
    }
  }
  return mejor;
}

// ¿Está el punto dentro de alguna de las zonas? tolM permite salirse unos metros del borde
// (calles que hacen de límite municipal, simplificación del polígono).
export function dentro(lat, lon, zonas, tolM = 0) {
  for (const z of zonas) if (enZona(lat, lon, z)) return true;
  if (tolM <= 0) return false;
  const dLat = tolM / M_POR_GRADO_LAT, dLon = tolM / mPorGradoLon(lat);
  for (const z of zonas) {
    const b = z.bbox;
    if (lat < b.minLat - dLat || lat > b.maxLat + dLat || lon < b.minLon - dLon || lon > b.maxLon + dLon) continue;
    if (distBorde(lat, lon, z) <= tolM) return true;
  }
  return false;
}

export function municipioDe(lat, lon, zonas) {
  for (const z of zonas) if (enZona(lat, lon, z)) return z.nombre;
  return null;
}
