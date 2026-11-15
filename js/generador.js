// Generador de rutas aleatorias circulares de duración objetivo, sin salir de las zonas.
//
// Idea: se eligen puntos de paso reales (rotondas, semáforos, stops y cedas de OSM) mediante un paseo
// aleatorio desde la salida. OSRM ordena los puntos en un circuito óptimo y devuelve la
// duración. Se añaden o quitan puntos hasta acercarse a la duración objetivo, y se descarta
// cualquier punto cuyo tramo saque la ruta de las zonas seleccionadas.

import { dentro, distM, municipioDe, M_POR_GRADO_LAT, mPorGradoLon, rumbo, difAngulo, distASegmento } from './geo.js';
import { viajeCircular, viajeOrdenado } from './osrm.js';
import { textoManiobra } from './instrucciones.js';

const TOLERANCIA_BORDE_M = 40;

// Solo puntos con margen respecto al borde exterior de las zonas (150 m en las 4 direcciones).
export function filtrarCandidatos(puntos, zonas) {
  const off = 150;
  return puntos.filter((p) => {
    if (!dentro(p.lat, p.lon, zonas)) return false;
    const dLat = off / M_POR_GRADO_LAT, dLon = off / mPorGradoLon(p.lat);
    return dentro(p.lat + dLat, p.lon, zonas) && dentro(p.lat - dLat, p.lon, zonas)
      && dentro(p.lat, p.lon + dLon, zonas) && dentro(p.lat, p.lon - dLon, zonas);
  });
}

// Stops y cedas por los que pasa la ruta en el sentido de la señal (a menos de 12 m y ±50°).
export function senalesEnRuta(geometria, puntos) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [la, lo] of geometria) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
  }
  const m = 0.0003, cerca = 0.0004; // ~30-40 m
  const res = [];
  for (const p of puntos) {
    if ((p.tipo !== 'stop' && p.tipo !== 'ceda') || p.rumbo == null) continue;
    if (p.lat < minLat - m || p.lat > maxLat + m || p.lon < minLon - m || p.lon > maxLon + m) continue;
    const q = [p.lat, p.lon];
    for (let i = 0; i < geometria.length - 1; i++) {
      const a = geometria[i], b = geometria[i + 1];
      if (Math.abs(a[0] - p.lat) > cerca && Math.abs(b[0] - p.lat) > cerca && (a[0] - p.lat) * (b[0] - p.lat) > 0) continue;
      if (Math.abs(a[1] - p.lon) > cerca && Math.abs(b[1] - p.lon) > cerca && (a[1] - p.lon) * (b[1] - p.lon) > 0) continue;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      if (distASegmento(q, a, b) <= 12 && difAngulo(rumbo(a, b), p.rumbo) <= 50) { res.push({ ...p, idx: i }); break; }
    }
  }
  return res;
}

// Tramos que salen de las zonas: índices de entrada de sus extremos (0 = salida) y en qué
// fracción del tramo se produce la primera salida.
function tramosFueraDeZona(resp, zonas) {
  const n = resp.waypoints.length;
  const orden = new Array(n);
  resp.waypoints.forEach((w, i) => { orden[w.waypoint_index] = i; });
  const tramos = [];
  resp.trips[0].legs.forEach((leg, j) => {
    const cs = leg.steps.flatMap((s) => s.geometry.coordinates);
    const k = cs.findIndex((c) => !dentro(c[1], c[0], zonas, TOLERANCIA_BORDE_M));
    if (k >= 0) tramos.push({ origen: orden[j], destino: orden[(j + 1) % n], frac: k / cs.length });
  });
  return tramos;
}

const MAX_ITER_CIRCUITO = 14;
const MAX_ITER_VUELTAS = 10;
const MAX_PUNTOS_CIRCUITO = 14;

export async function generarRuta({ salida, zonas, candidatos, obligatorios = [], objetivoSeg, tolSeg = 180, onProgreso = () => {}, signal }) {
  if (candidatos.length < 4) throw new Error('No hay suficientes puntos de paso en las zonas seleccionadas.');
  const vetados = new Set();
  let wps = [];
  let escala = 1;
  let mejor = null; // { resp, wps, diff }
  let iter = 0;
  const maxIter = MAX_ITER_CIRCUITO + MAX_ITER_VUELTAS;

  const coords = (c) => [c.lat, c.lon];
  // Stops y cedas llevan su sentido para que la ruta se encuentre la señal de frente.
  const conSentido = (c) => (c.rumbo != null ? [c.lat, c.lon, c.rumbo] : [c.lat, c.lon]);

  // Consulta OSRM y valida que no se sale de las zonas. Devuelve { malos } o { diff }.
  const evaluar = async (lista, ordenado) => {
    iter++;
    onProgreso({ it: iter, maxIter, n: lista.length, dur: mejor ? objetivoSeg - mejor.diff : null });
    const puntos = [salida, ...lista.map(conSentido)];
    let resp;
    try {
      resp = ordenado ? await viajeOrdenado(puntos, signal) : await viajeCircular(puntos, signal);
    } catch (e) {
      if (e.codigo === 'NoSegment' && e.indice > 0 && e.indice <= lista.length) return { malos: [e.indice] };
      if (e.codigo === 'NoTrips' || e.codigo === 'NoRoute') {
        // Alguna señal con sentido obligatorio deja un punto sin salida: se descarta la última añadida.
        let i = lista.map((c) => c.rumbo != null && !obligatorios.includes(c)).lastIndexOf(true);
        if (i < 0) i = lista.map((c) => c.rumbo != null).lastIndexOf(true);
        if (i >= 0) return { malos: [i + 1] };
      }
      throw e;
    }
    const tramos = tramosFueraDeZona(resp, zonas);
    if (tramos.length) {
      // Qué punto quitar de cada tramo que se sale: nunca la salida; antes un punto de relleno que un
      // obligatorio o el ancla; entre dos iguales, el más cercano al lugar donde se sale.
      const protegido = (i) => obligatorios.includes(lista[i - 1]) || lista[i - 1] === ancla;
      const malos = new Set(tramos.map((t) => {
        const extremos = [t.origen, t.destino].filter((i) => i !== 0);
        if (extremos.length === 1) return extremos[0];
        const libres = extremos.filter((i) => !protegido(i));
        if (libres.length === 1) return libres[0];
        return t.frac < 0.5 ? t.origen : t.destino;
      }));
      return { malos: [...malos] };
    }
    const diff = objetivoSeg - resp.trips[0].duration;
    if (!mejor || Math.abs(diff) < Math.abs(mejor.diff)) mejor = { resp, wps: [...lista], diff };
    return { diff };
  };
  const elegir = (desde, minD, maxD) => {
    const ocupados = [salida, ...wps.map(coords)];
    for (let intento = 0; intento < 4; intento++) {
      const pool = candidatos.filter((c) => {
        if (vetados.has(c) || wps.includes(c)) return false;
        const d = distM(desde, coords(c));
        return d >= minD && d <= maxD && ocupados.every((o) => distM(o, coords(c)) > 450);
      });
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
      minD *= 0.6; maxD *= 1.6;
    }
    return null;
  };
  const anadir = (k, minD, maxD) => {
    for (let i = 0; i < k; i++) {
      const anclas = [salida, ...wps.map(coords)];
      const desde = wps.length && Math.random() < 0.6 ? coords(wps[wps.length - 1]) : anclas[Math.floor(Math.random() * anclas.length)];
      const c = elegir(desde, minD, maxD);
      if (c) wps.push(c);
    }
  };

  // Con varias zonas marcadas, la ruta visita al menos otro municipio distinto al de salida
  // (el trayecto entre ciudades puede ir por autovía, que está permitido).
  // Ese punto de "ancla" se elige entre los alcanzables con la duración pedida y no se quita al ajustar.
  const muniSalida = municipioDe(salida[0], salida[1], zonas);
  const otros = candidatos.filter((c) => c.municipio !== muniSalida);
  const dSalida = (c) => distM(salida, coords(c));
  let alcanzables = otros.filter((c) => dSalida(c) <= objetivoSeg * 5);
  if (!alcanzables.length) alcanzables = [...otros].sort((a, b) => dSalida(a) - dSalida(b)).slice(0, 5);
  let ancla = null;
  const elegirAncla = () => {
    const libres = alcanzables.filter((c) => !vetados.has(c));
    if (!libres.length) return null;
    const munis = [...new Set(libres.map((c) => c.municipio))];
    const destino = munis[Math.floor(Math.random() * munis.length)];
    const enDestino = libres.filter((c) => c.municipio === destino);
    return enDestino[Math.floor(Math.random() * enDestino.length)];
  };
  // Puntos obligatorios (señales escasas que el usuario ha priorizado): entran desde el principio.
  wps.push(...obligatorios);
  if (zonas.length > 1 && otros.length) {
    ancla = elegirAncla();
    if (ancla) wps.push(ancla);
    anadir(2, 800, 2500);
  } else {
    anadir(obligatorios.length ? 1 : 3, 1200, 3500);
  }
  // Al recortar, se quitan antes los puntos normales; los obligatorios y el ancla, solo si no queda otra.
  const quitarUltimo = (lista) => {
    let i = lista.findLastIndex((c) => c !== ancla && !obligatorios.includes(c));
    if (i < 0) i = lista.findLastIndex((c) => c !== ancla);
    if (i >= 0) lista.splice(i, 1);
    return i >= 0;
  };
  // Fase 1: circuito optimizado por OSRM (sin repetir calles en lo posible).
  for (let it = 1; it <= MAX_ITER_CIRCUITO; it++) {
    if (!wps.length) anadir(2, 1000, 3000);
    if (!wps.length) break;
    const r = await evaluar(wps, false);
    if (r.malos) {
      for (const idx of r.malos) if (idx > 0) vetados.add(wps[idx - 1]);
      const antes = wps.length;
      wps = wps.filter((c) => !vetados.has(c));
      if (wps.length === antes) break; // el problema es la propia salida
      if (ancla && vetados.has(ancla)) { ancla = elegirAncla(); if (ancla) wps.unshift(ancla); }
      continue;
    }
    const { diff } = r;
    if (Math.abs(diff) <= tolSeg) break;
    if (diff > 0) {
      if (wps.length >= MAX_PUNTOS_CIRCUITO) break; // zona pequeña: pasar a la fase 2
      const porPunto = (objetivoSeg - diff) / (wps.length + 1);
      const k = Math.max(1, Math.min(4, Math.floor(diff / porPunto)));
      const maxD = Math.max(700, Math.min(3500, (diff / 2) * 9 * escala));
      const antes = wps.length;
      anadir(k, Math.min(800, maxD * 0.4), maxD);
      if (wps.length === antes) break; // no quedan puntos nuevos: fase 2
    } else {
      if (!quitarUltimo(wps)) {
        // Solo queda el ancla y aun así sobra tiempo: se cambia por una más cercana a la salida.
        const masCerca = alcanzables.filter((c) => !vetados.has(c) && dSalida(c) < dSalida(ancla) - 500);
        if (!masCerca.length) break;
        masCerca.sort((a, b) => dSalida(a) - dSalida(b));
        ancla = masCerca[Math.floor(Math.random() * Math.min(5, masCerca.length))];
        wps = [ancla];
        continue;
      }
      escala *= 0.5;
      if (-diff < 900) anadir(1, 400, Math.max(600, 2500 * escala));
    }
  }

  // Fase 2 (zonas pequeñas): si el circuito se queda corto, se encadenan más puntos en orden
  // aleatorio, pudiendo volver a pasar por algunas calles, hasta completar la duración.
  if (mejor && mejor.diff > tolSeg) {
    const orden = [];
    mejor.resp.waypoints.forEach((w, i) => { orden[w.waypoint_index] = i; });
    let seq = orden.slice(1).map((i) => mejor.wps[i - 1]);
    let ultimo = mejor.diff;
    let escala2 = 1;
    const paso = (minD, maxD) => {
      const desde = seq.length ? coords(seq[seq.length - 1]) : salida;
      const recientes = [salida, ...seq.slice(-3).map(coords)];
      for (let intento = 0; intento < 4; intento++) {
        const pool = candidatos.filter((c) => {
          if (vetados.has(c)) return false;
          const d = distM(desde, coords(c));
          return d >= minD && d <= maxD && recientes.every((o) => distM(o, coords(c)) > 400);
        });
        if (pool.length) { seq.push(pool[Math.floor(Math.random() * pool.length)]); return; }
        minD *= 0.6; maxD *= 1.6;
      }
    };
    for (let it = 1; it <= MAX_ITER_VUELTAS; it++) {
      if (ultimo > 0) {
        const k = Math.max(1, Math.min(4, Math.round(ultimo / 300)));
        const maxD = Math.max(700, Math.min(2500, 1500 * escala2));
        for (let i = 0; i < k; i++) paso(Math.min(600, maxD * 0.5), maxD);
      } else {
        quitarUltimo(seq);
        escala2 *= 0.5;
        if (-ultimo < 600) paso(300, Math.max(500, 1200 * escala2));
      }
      const r = await evaluar(seq, true);
      if (r.malos) {
        for (const idx of r.malos) if (idx > 0) vetados.add(seq[idx - 1]);
        seq = seq.filter((c) => !vetados.has(c));
        continue;
      }
      ultimo = r.diff;
      if (Math.abs(ultimo) <= tolSeg) break;
    }
  }

  if (!mejor) {
    throw new Error('No se ha podido crear una ruta sin salir de las zonas desde ese punto. Prueba otro punto de salida o añade zonas.');
  }
  return construirRuta(mejor.resp, mejor.wps, salida, zonas, objetivoSeg, tolSeg);
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

export function construirRuta(resp, wps, salida, zonas, objetivoSeg, tolSeg) {
  const t = resp.trips[0];
  const n = resp.waypoints.length;
  const orden = new Array(n);
  resp.waypoints.forEach((w, i) => { orden[w.waypoint_index] = i; });

  const geometria = t.geometry.coordinates.map((c) => [r5(c[1]), r5(c[0])]);

  // Maniobras: se omiten las salidas/llegadas intermedias (puntos de paso) y las "salidas de rotonda",
  // que ya están dichas en la indicación de la rotonda.
  const pasos = [];
  let idxBusqueda = 0;
  t.legs.forEach((leg, j) => {
    leg.steps.forEach((s, k) => {
      const tipo = s.maneuver.type;
      const mod = s.maneuver.modifier;
      const ultimoTramo = j === t.legs.length - 1;
      if (tipo === 'depart' && j > 0 && mod !== 'uturn') return;
      if (tipo === 'arrive' && !ultimoTramo) return;
      if (tipo === 'exit roundabout' || tipo === 'exit rotary') return;
      if ((tipo === 'new name' || tipo === 'notification') && s.distance < 30) return;
      const loc = [s.maneuver.location[1], s.maneuver.location[0]];
      // posición de la maniobra en la geometría (búsqueda hacia delante)
      let mejorI = idxBusqueda, mejorD = Infinity;
      for (let i = idxBusqueda; i < Math.min(geometria.length, idxBusqueda + 4000); i++) {
        const d = distM(loc, geometria[i]);
        if (d < mejorD) { mejorD = d; mejorI = i; }
        if (d < 2) break;
      }
      idxBusqueda = mejorI;
      // En rotondas, la vía de salida viene en el paso "exit roundabout" siguiente.
      let nombre = s.name || '', ref = s.ref || '', dist = s.distance;
      const sig = leg.steps[k + 1];
      if ((tipo === 'roundabout' || tipo === 'rotary') && sig && (sig.maneuver.type === 'exit roundabout' || sig.maneuver.type === 'exit rotary')) {
        nombre = sig.name || nombre; ref = sig.ref || (sig.name ? '' : ref); dist += sig.distance;
      }
      const paso = {
        tipo, modificador: mod || null, salida: s.maneuver.exit || null,
        nombre, ref, nombreRotonda: s.rotary_name || '',
        loc, idx: mejorI, dist: Math.round(dist),
      };
      paso.texto = textoManiobra(paso, tipo === 'arrive' && ultimoTramo);
      pasos.push(paso);
    });
  });

  // Estadísticas útiles para practicar
  const stats = { rotondas: 0, izquierda: 0, derecha: 0, cambiosSentido: 0, incorporaciones: 0 };
  const vias = new Set();
  for (const p of pasos) {
    if (['roundabout', 'rotary', 'roundabout turn'].includes(p.tipo)) stats.rotondas++;
    if (['turn', 'end of road'].includes(p.tipo)) {
      if (p.modificador === 'left' || p.modificador === 'sharp left') stats.izquierda++;
      if (p.modificador === 'right' || p.modificador === 'sharp right') stats.derecha++;
    }
    if (p.modificador === 'uturn') stats.cambiosSentido++;
    if (p.tipo === 'merge' || p.tipo === 'on ramp') stats.incorporaciones++;
  }
  for (const leg of t.legs) for (const s of leg.steps) if (s.ref) s.ref.split(';').forEach((r) => vias.add(r.trim()));
  stats.vias = [...vias].filter(Boolean).sort();

  const porMunicipio = {};
  for (let i = 0; i < geometria.length - 1; i++) {
    const a = geometria[i], b = geometria[i + 1];
    const m = municipioDe((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zonas) || 'Límite';
    porMunicipio[m] = (porMunicipio[m] || 0) + distM(a, b);
  }
  stats.porMunicipio = porMunicipio;

  const puntosPaso = orden.slice(1).map((i) => wps[i - 1]).map((c) => ({ lat: c.lat, lon: c.lon, tipo: c.tipo, nombre: c.nombre, municipio: c.municipio }));

  return {
    id: `r${Date.now().toString(36)}`,
    creada: new Date().toISOString(),
    salida: { lat: salida[0], lon: salida[1] },
    duracion: Math.round(t.duration),
    distancia: Math.round(t.distance),
    objetivoSeg: Math.round(objetivoSeg),
    ajustada: Math.abs(objetivoSeg - t.duration) <= tolSeg,
    geometria,
    pasos,
    puntosPaso,
    stats,
  };
}
