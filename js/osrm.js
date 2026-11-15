// Cliente del motor de rutas OSRM.
// Prototipo: servidor público de demostración (uso limitado, máx. ~1 petición/segundo).
// Producción: sustituir OSRM_URL por un servidor propio (OSRM/Valhalla) o un proveedor comercial.

export const OSRM_URL = 'https://router.project-osrm.org';
const PARAMS = 'steps=true&geometries=geojson&overview=full';

let ultimaPeticion = 0;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const aTexto = (puntos) => puntos.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');

async function pedir(url, signal) {
  const espera = Math.max(0, ultimaPeticion + 1100 - Date.now());
  if (espera) await esperar(espera);
  ultimaPeticion = Date.now();
  let r;
  for (let intento = 0; intento < 3; intento++) {
    r = await fetch(url, { signal });
    if (r.status !== 429 && r.status < 500) break;
    await esperar(2000 * (intento + 1));
  }
  let datos = null;
  try { datos = await r.json(); } catch { /* respuesta no JSON */ }
  if (!r.ok || !datos || datos.code !== 'Ok') {
    const msg = (datos && (datos.message || datos.code)) || `HTTP ${r.status}`;
    throw new Error(`El servidor de rutas no ha respondido correctamente (${msg}).`);
  }
  return datos;
}

// Punto de la red viaria más cercano (donde empezará realmente la ruta) y nombre de la calle.
export async function masCercano(p, signal) {
  const d = await pedir(`${OSRM_URL}/nearest/v1/driving/${aTexto([p])}?number=1`, signal);
  const w = d.waypoints[0];
  return { nombre: w.name || '', distancia: w.distance, punto: [w.location[1], w.location[0]] };
}

// Circuito optimizado (problema del viajante) que sale y vuelve al primer punto.
// puntos: [[lat, lon], ...]
export async function viajeCircular(puntos, signal) {
  return pedir(`${OSRM_URL}/trip/v1/driving/${aTexto(puntos)}?roundtrip=true&source=first&${PARAMS}`, signal);
}

// Recorrido en el orden dado, volviendo al primer punto. Se devuelve con el mismo formato que viajeCircular.
export async function viajeOrdenado(puntos, signal) {
  const d = await pedir(`${OSRM_URL}/route/v1/driving/${aTexto([...puntos, puntos[0]])}?${PARAMS}`, signal);
  return {
    code: 'Ok',
    trips: [d.routes[0]],
    waypoints: d.waypoints.slice(0, puntos.length).map((w, i) => ({ ...w, waypoint_index: i })),
  };
}
