// PractiRuta Moto: interfaz, mapa, generación, rutas guardadas y navegación GPS.

import { prepararZonas, dentro, distM } from './geo.js';
import { filtrarCandidatos, generarRuta, construirRuta, senalesEnRuta } from './generador.js';
import { Navegador } from './navegacion.js';
import { iconoManiobra, formatoDist, formatoDur } from './instrucciones.js';
import { masCercano } from './osrm.js';
import { crearHoja } from './hoja.js';

const COLORES = {
  'Alcalá de Henares': '#e4572e',
  'Torrejón de Ardoz': '#2b7bb9',
  'Coslada': '#8e44ad',
  'San Fernando de Henares': '#1f9d74',
};
const CORTO = {
  'Alcalá de Henares': 'Alcalá',
  'Torrejón de Ardoz': 'Torrejón',
  'Coslada': 'Coslada',
  'San Fernando de Henares': 'San Fernando',
};
const CLAVE_RUTAS = 'practiruta.rutas.v1';

// Coordenadas del elemento de OpenStreetMap "Centro de Exámenes DGT Alcalá de Henares" (Avenida de Europa).
const CENTRO_DGT = {
  nombre: 'Centro de exámenes DGT',
  direccion: 'Av. Europa, 6, 28806 Alcalá de Henares, Madrid',
  punto: [40.4859968, -3.3837625],
};

// Señales que se pueden priorizar. Sin ninguna marcada (o con todas) la ruta mezcla de todo,
// semáforos incluidos.
const ICONO_ROTONDA = '<svg class="senal" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="#1d6fe0"/><circle cx="8" cy="8" r="3.2" fill="none" stroke="#fff" stroke-width="1.8"/></svg>';
const ICONO_STOP = '<svg class="senal" viewBox="0 0 16 16" aria-hidden="true"><polygon points="5,0.5 11,0.5 15.5,5 15.5,11 11,15.5 5,15.5 0.5,11 0.5,5" fill="#d62839" stroke="#fff" stroke-width="1"/><rect x="3.5" y="7" width="9" height="2" rx="0.5" fill="#fff"/></svg>';
const ICONO_CEDA = '<svg class="senal" viewBox="0 0 16 16" aria-hidden="true"><polygon points="1,2 15,2 8,15" fill="#fff" stroke="#d62839" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const PRIORIDADES = [
  { clave: 'rotondas', nombre: 'Rotondas', tipos: ['rotonda'], color: '#1d6fe0', icono: ICONO_ROTONDA },
  { clave: 'stops', nombre: 'Stops', tipos: ['stop'], color: '#d62839', icono: ICONO_STOP },
  { clave: 'cedas', nombre: 'Cedas', tipos: ['ceda'], color: '#e08a00', icono: ICONO_CEDA },
];
const NOMBRE_TIPO = { rotonda: 'rotonda', semaforo: 'cruce con semáforo', stop: 'stop', ceda: 'ceda el paso' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const estado = {
  zonas: [],
  seleccion: new Set(),
  puntos: [],
  modoSalida: 'dgt',
  puntoMapa: null,
  calleMapa: null,
  puntoGps: null,
  prioridad: new Set(),
  duracionMin: 60,
  ajuste: 0,
  ruta: null,
  ejemplos: [],
  generando: null,
  nav: null,
};
window.practiruta = estado; // depuración

let mapa, capasZona = {}, capaRuta, marcadorSalida, marcadorPos, circuloPrecision, hoja;

// ---------- Utilidades de interfaz ----------
let temporizadorAviso;
function aviso(texto, ms = 4500) {
  const el = $('#aviso');
  el.textContent = texto; el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, ms);
}

const voz = {
  activa: true,
  decir(texto, urgente = false) {
    if (!this.activa || !('speechSynthesis' in window)) return;
    if (urgente) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-ES';
    const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('es-es'))
      || speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('es'));
    if (v) u.voice = v;
    u.rate = 1.03;
    speechSynthesis.speak(u);
  },
};

// ---------- Carga ----------
async function cargarDatos() {
  const [geo, puntos] = await Promise.all([
    fetch('data/municipios.geojson', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/puntos.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  estado.zonas = prepararZonas(geo);
  estado.puntos = puntos;
  estado.zonas.forEach((z) => estado.seleccion.add(z.nombre));
  // Rutas de ejemplo: se guardan como respuesta OSRM y se reconstruyen aquí, sin conexión.
  try {
    const r = await fetch('data/rutas_ejemplo.json', { cache: 'no-cache' });
    if (r.ok) {
      const crudas = await r.json();
      estado.ejemplos = crudas.map((e, i) => {
        const ruta = construirRuta(e.osrm, e.puntosPaso, [e.salida.lat, e.salida.lon], estado.zonas, e.objetivoSeg, 180);
        return Object.assign(ruta, {
          id: `ejemplo-${i}`, nombre: e.nombre, nombreSalida: e.nombreSalida, creada: e.creada,
          objetivoMin: e.objetivoMin, ajuste: e.ajuste, zonas: e.zonas,
        });
      });
    }
  } catch { /* opcional */ }
}

// Encuadra el mapa sin que la hoja inferior del móvil tape la ruta.
function encuadrar(limites, animar = true) {
  const movil = window.innerWidth <= 760 && !document.body.classList.contains('navegando');
  const alto = movil ? $('#panel').offsetHeight : 0;
  const opciones = movil ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, alto + 20] } : { padding: [30, 30] };
  mapa.fitBounds(limites, { ...opciones, animate: animar });
}

function iniciarMapa() {
  mapa = L.map('mapa', { zoomControl: false, preferCanvas: true }).setView([40.455, -3.43], 12);
  mapa.attributionControl.setPrefix(false); // sin el enlace "Leaflet"; se mantiene el aviso obligatorio de OpenStreetMap
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  // Prototipo: teselas estándar de OpenStreetMap. Producción: proveedor con licencia de uso intensivo.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);

  for (const z of estado.zonas) {
    capasZona[z.nombre] = L.geoJSON(z.feature, { interactive: false, style: () => estiloZona(z.nombre) }).addTo(mapa);
  }
  capaRuta = L.layerGroup().addTo(mapa);
  encuadrar(L.featureGroup(Object.values(capasZona)).getBounds(), false);
  window.addEventListener('resize', () => mapa.invalidateSize());

  mapa.on('click', (e) => {
    if (estado.modoSalida !== 'mapa' || estado.nav) return;
    fijarPuntoMapa([e.latlng.lat, e.latlng.lng]);
  });
}

function estiloZona(nombre) {
  const activa = estado.seleccion.has(nombre);
  return {
    color: COLORES[nombre], weight: activa ? 2.5 : 1, opacity: activa ? 0.9 : 0.35,
    fillColor: COLORES[nombre], fillOpacity: activa ? 0.07 : 0.02, dashArray: activa ? null : '4 4',
  };
}

const zonasSeleccionadas = () => estado.zonas.filter((z) => estado.seleccion.has(z.nombre));

// ---------- Configuración ----------
function construirConfig() {
  const cont = $('#zonas');
  for (const z of estado.zonas) {
    const lbl = document.createElement('label');
    lbl.className = 'chip activo';
    lbl.style.setProperty('--c', COLORES[z.nombre]);
    lbl.innerHTML = `<input type="checkbox" checked><span class="punto"></span>${z.nombre}`;
    lbl.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) estado.seleccion.add(z.nombre); else estado.seleccion.delete(z.nombre);
      lbl.classList.toggle('activo', e.target.checked);
      capasZona[z.nombre].setStyle(estiloZona(z.nombre));
      actualizarSalida();
    });
    cont.appendChild(lbl);
  }

  document.querySelectorAll('[data-salida]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-salida]').forEach((x) => {
      x.classList.toggle('activo', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
    estado.modoSalida = b.dataset.salida;
    if (estado.modoSalida === 'gps') pedirGps();
    if (estado.modoSalida === 'dgt') mapa.setView(CENTRO_DGT.punto, Math.max(mapa.getZoom(), 15));
    if (estado.modoSalida === 'mapa') {
      if (estado.puntoMapa) mapa.setView(estado.puntoMapa, Math.max(mapa.getZoom(), 16));
      if (window.innerWidth <= 760) {
        hoja.plegar();
        aviso('Toca el mapa donde quieras empezar. Abre el panel para buscar una dirección.');
      }
    }
    actualizarSalida();
  }));
  $('#form-buscar').addEventListener('submit', (e) => { e.preventDefault(); buscarDireccion($('#txt-buscar').value); });
  document.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-dur]').forEach((x) => x.classList.toggle('activo', x === b));
    estado.duracionMin = Number(b.dataset.dur);
  }));
  $('#sel-ajuste').addEventListener('change', (e) => { estado.ajuste = Number(e.target.value); });

  const contPrioridad = $('#prioridades');
  for (const pr of PRIORIDADES) {
    const lbl = document.createElement('label');
    lbl.className = 'chip';
    lbl.style.setProperty('--c', pr.color);
    lbl.innerHTML = `<input type="checkbox">${pr.icono}${pr.nombre}`;
    lbl.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) estado.prioridad.add(pr.clave); else estado.prioridad.delete(pr.clave);
      lbl.classList.toggle('activo', e.target.checked);
      actualizarAyudaPrioridad();
    });
    contPrioridad.appendChild(lbl);
  }
  actualizarAyudaPrioridad();
  $('#btn-generar').addEventListener('click', generar);
  actualizarSalida();
}

// Prioridad efectiva: ninguna marcada o todas marcadas = sin preferencia (lista vacía).
function prioridadActiva() {
  if (estado.prioridad.size === 0 || estado.prioridad.size === PRIORIDADES.length) return [];
  return PRIORIDADES.filter((p) => estado.prioridad.has(p.clave));
}

const listaNatural = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

function actualizarAyudaPrioridad() {
  const activas = prioridadActiva();
  $('#ayuda-prioridad').textContent = activas.length
    ? `La ruta pasará sobre todo por ${listaNatural(activas.map((p) => p.nombre.toLowerCase()))}. Los stops y cedas se cruzan siempre de frente, en el sentido de la señal.`
    : 'Sin preferencia: la ruta mezcla rotondas, stops, cedas y semáforos. Marca una o dos opciones para darles prioridad.';
}

function puntoSalida() {
  if (estado.modoSalida === 'dgt') return CENTRO_DGT.punto;
  if (estado.modoSalida === 'gps') return estado.puntoGps;
  return estado.puntoMapa;
}

function nombreSalida() {
  if (estado.modoSalida === 'dgt') return 'el centro de exámenes DGT';
  if (estado.modoSalida === 'gps') return 'mi ubicación';
  return (estado.calleMapa && estado.calleMapa.nombre) || 'el punto elegido';
}

const iconoSalida = (clase = '') => L.divIcon({ className: '', html: `<div class="marcador-salida ${clase}">S</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

function actualizarSalida() {
  const modo = estado.modoSalida;
  $('#selector-salida').hidden = modo !== 'mapa';
  mapa.getContainer().classList.toggle('seleccionando', modo === 'mapa');
  const info = $('#info-salida');
  const p = puntoSalida();
  const fuera = p && !dentro(p[0], p[1], zonasSeleccionadas(), 30);
  let html;
  if (modo === 'dgt') html = '';
  else if (modo === 'gps') html = p ? 'Ubicación obtenida. La ruta empezará donde estás.' : 'Buscando tu ubicación...';
  else if (!p) html = 'Toca el mapa donde quieras empezar o busca una dirección. Después puedes arrastrar el marcador para afinar el punto.';
  else {
    const c = estado.calleMapa;
    const calle = c ? `<strong>${esc(c.nombre || 'Calle sin nombre')}</strong>` : '<strong>Buscando la calle...</strong>';
    const aviso = c && c.distancia > 25 ? `<br>La ruta empezará en la calle más cercana, a ${Math.round(c.distancia)} m.` : '';
    html = `${calle}${aviso}<br>Arrastra el marcador naranja para ajustar el punto exacto.`;
  }
  if (fuera) html += '<br>Está fuera de las zonas seleccionadas.';
  info.innerHTML = html;
  info.classList.toggle('error', !!fuera);

  if (marcadorSalida) { marcadorSalida.remove(); marcadorSalida = null; }
  if (!p) return;
  if (modo === 'mapa') {
    marcadorSalida = L.marker(p, { draggable: true, autoPan: true, zIndexOffset: 2000, icon: iconoSalida('eleccion') })
      .addTo(mapa).bindTooltip('Salida elegida: arrástrala para ajustarla');
    marcadorSalida.on('dragend', () => { const ll = marcadorSalida.getLatLng(); fijarPuntoMapa([ll.lat, ll.lng]); });
  } else if (!estado.ruta || distM(p, [estado.ruta.salida.lat, estado.ruta.salida.lon]) > 30) {
    marcadorSalida = L.marker(p, { icon: iconoSalida() }).addTo(mapa).bindTooltip(modo === 'dgt' ? `${CENTRO_DGT.nombre}, ${CENTRO_DGT.direccion}` : 'Tu ubicación');
  }
}

// Fija la salida elegida por el usuario y consulta la calle donde empezará la ruta.
let consultaCalle = 0;
async function fijarPuntoMapa(p) {
  if (!dentro(p[0], p[1], zonasSeleccionadas())) {
    aviso('Ese punto está fuera de las zonas seleccionadas.');
    actualizarSalida();
    return;
  }
  estado.puntoMapa = p;
  estado.calleMapa = null;
  actualizarSalida();
  const id = ++consultaCalle;
  try {
    const c = await masCercano(p);
    if (id === consultaCalle) { estado.calleMapa = c; actualizarSalida(); }
  } catch {
    if (id === consultaCalle) { estado.calleMapa = { nombre: '', distancia: 0 }; actualizarSalida(); }
  }
}

// Búsqueda de direcciones con Nominatim (OpenStreetMap), limitada a las zonas seleccionadas.
async function buscarDireccion(texto) {
  const q = texto.trim();
  const ul = $('#resultados');
  if (q.length < 3) { ul.innerHTML = '<li class="nada">Escribe al menos 3 letras.</li>'; return; }
  const zonas = zonasSeleccionadas();
  if (!zonas.length) { ul.innerHTML = '<li class="nada">Marca al menos una zona.</li>'; return; }
  const b = zonas.reduce((a, z) => ({
    minLat: Math.min(a.minLat, z.bbox.minLat), maxLat: Math.max(a.maxLat, z.bbox.maxLat),
    minLon: Math.min(a.minLon, z.bbox.minLon), maxLon: Math.max(a.maxLon, z.bbox.maxLon),
  }), { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 });
  ul.innerHTML = '<li class="nada">Buscando...</li>';
  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: '8', countrycodes: 'es', 'accept-language': 'es', bounded: '1',
    viewbox: `${b.minLon},${b.maxLat},${b.maxLon},${b.minLat}`,
  });
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    const datos = await r.json();
    const dentroZona = datos.filter((x) => dentro(Number(x.lat), Number(x.lon), zonas));
    if (!dentroZona.length) { ul.innerHTML = '<li class="nada">Sin resultados dentro de las zonas seleccionadas.</li>'; return; }
    ul.innerHTML = '';
    for (const x of dentroZona) {
      const li = document.createElement('li');
      li.textContent = x.display_name.split(',').slice(0, 3).join(',');
      li.addEventListener('click', () => {
        const p = [Number(x.lat), Number(x.lon)];
        ul.innerHTML = '';
        mapa.setView(p, 17);
        fijarPuntoMapa(p);
      });
      ul.appendChild(li);
    }
  } catch {
    ul.innerHTML = '<li class="nada">No se ha podido buscar. Comprueba la conexión.</li>';
  }
}

function pedirGps() {
  if (!('geolocation' in navigator)) { aviso('Este dispositivo no permite obtener la ubicación.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { estado.puntoGps = [pos.coords.latitude, pos.coords.longitude]; actualizarSalida(); mapa.setView(estado.puntoGps, 14); },
    (err) => { aviso(`No se ha podido obtener la ubicación (${err.message}).`); actualizarSalida(); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
  );
}

// ---------- Generación ----------
async function generar() {
  if (estado.generando) { estado.generando.abort(); return; }
  const zonas = zonasSeleccionadas();
  if (!zonas.length) { aviso('Selecciona al menos una zona.'); return; }
  const salida = puntoSalida();
  if (!salida) { aviso(estado.modoSalida === 'gps' ? 'Aún no tengo tu ubicación.' : 'Elige primero el punto de salida en el mapa.'); return; }
  if (!dentro(salida[0], salida[1], zonas, 30)) { aviso('El punto de salida está fuera de las zonas seleccionadas.'); return; }

  // Puntos de paso según la prioridad. Si en las zonas marcadas hay muy pocos del tipo pedido,
  // se completan con el resto para poder generar la ruta.
  const activas = prioridadActiva();
  let candidatos;
  let obligatorios = [];
  if (!activas.length) {
    candidatos = filtrarCandidatos(estado.puntos, zonas);
  } else {
    const tipos = new Set(activas.flatMap((p) => p.tipos));
    candidatos = filtrarCandidatos(estado.puntos.filter((p) => tipos.has(p.tipo)), zonas);
    if (candidatos.length < 15) {
      // Pocos del tipo pedido (p. ej. stops solo en Coslada): entran todos en la ruta
      // y el tiempo que falte se completa con otros puntos.
      obligatorios = candidatos;
      candidatos = [...candidatos, ...filtrarCandidatos(estado.puntos.filter((p) => !tipos.has(p.tipo)), zonas)];
      aviso(`Hay pocos ${listaNatural(activas.map((p) => p.nombre.toLowerCase()))} en las zonas marcadas: la ruta pasará por todos y se completará con otros puntos.`, 6000);
    } else if (activas.length > 1) {
      // Mismo peso para cada tipo marcado aunque haya muchos más de uno que de otro
      // (p. ej. hay unas 6 rotondas por cada stop): se repiten los del tipo escaso en el sorteo.
      const grupos = activas.map((p) => candidatos.filter((c) => p.tipos.includes(c.tipo))).filter((g) => g.length);
      const mayor = Math.max(...grupos.map((g) => g.length));
      candidatos = grupos.flatMap((g) => Array.from({ length: Math.max(1, Math.round(mayor / g.length)) }, () => g).flat());
    }
  }
  const ctrl = new AbortController();
  estado.generando = ctrl;
  const btn = $('#btn-generar');
  btn.textContent = 'Cancelar';
  btn.classList.remove('principal');
  const prog = $('#progreso');
  prog.hidden = false;
  const objetivoSeg = (estado.duracionMin * 60) / (1 + estado.ajuste);
  const pintar = (pct, txt) => { prog.querySelector('span').style.width = `${pct}%`; prog.querySelector('p').textContent = txt; };
  pintar(4, 'Eligiendo puntos de paso al azar...');
  try {
    const ruta = await generarRuta({
      salida, zonas, candidatos, obligatorios, objetivoSeg, tolSeg: Math.min(180, objetivoSeg * 0.05), signal: ctrl.signal,
      onProgreso: ({ it, maxIter, n, dur }) => pintar(Math.min(95, (it / maxIter) * 100),
        `Calculando circuito (intento ${it}, ${n} puntos de paso${dur ? `, ${formatoDur(dur * (1 + estado.ajuste))}` : ''})...`),
    });
    ruta.ajuste = estado.ajuste;
    ruta.objetivoMin = estado.duracionMin;
    ruta.zonas = zonas.map((z) => z.nombre);
    ruta.nombreSalida = nombreSalida();
    ruta.prioridad = activas.map((p) => p.clave);
    ruta.nombre = `Ruta de ${estado.duracionMin} min desde ${ruta.nombreSalida}`;
    mostrarRuta(ruta);
    pintar(100, ruta.ajustada ? 'Ruta lista.' : 'Ruta lista, aunque no se ha podido ajustar del todo a la duración pedida.');
    setTimeout(() => { prog.hidden = true; }, 2500);
  } catch (e) {
    prog.hidden = true;
    if (e.name !== 'AbortError') aviso(e.message || 'Error al generar la ruta.', 7000);
  } finally {
    estado.generando = null;
    btn.textContent = estado.ruta ? 'Generar otra ruta' : 'Generar ruta aleatoria';
    btn.classList.add('principal');
  }
}

// ---------- Presentación de la ruta ----------
function mostrarRuta(ruta, { inicial = false } = {}) {
  estado.ruta = ruta;
  capaRuta.clearLayers();
  if (marcadorSalida) { marcadorSalida.remove(); marcadorSalida = null; }

  const linea = ruta.geometria;
  L.polyline(linea, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(capaRuta);
  const pl = L.polyline(linea, { color: getComputedStyle(document.documentElement).getPropertyValue('--ruta').trim() || '#1d6fe0', weight: 5, opacity: 0.95 }).addTo(capaRuta);

  // Stops y cedas que la ruta cruza de frente
  const senales = senalesEnRuta(ruta.geometria, estado.puntos);
  for (const s of senales) {
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: s.tipo === 'stop' ? ICONO_STOP : ICONO_CEDA, iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: -100, keyboard: false,
    }).bindTooltip(`${s.tipo === 'stop' ? 'Stop' : 'Ceda el paso'}${s.nombre ? `: ${s.nombre}` : ''}`).addTo(capaRuta);
  }
  ruta.stats.stops = senales.filter((s) => s.tipo === 'stop').length;
  ruta.stats.cedas = senales.filter((s) => s.tipo === 'ceda').length;

  ruta.puntosPaso.forEach((p, i) => {
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="marcador-paso">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindTooltip(`Punto ${i + 1}: ${NOMBRE_TIPO[p.tipo] || p.tipo}${p.nombre ? ` (${p.nombre})` : ''}, ${CORTO[p.municipio] || p.municipio}`)
      .addTo(capaRuta);
  });
  L.marker([ruta.salida.lat, ruta.salida.lon], { icon: L.divIcon({ className: '', html: '<div class="marcador-salida">S</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 1000 })
    .bindTooltip('Salida y llegada').addTo(capaRuta);
  encuadrar(pl.getBounds(), !inicial);

  const durMostrada = ruta.duracion * (1 + (ruta.ajuste || 0));
  $('#sec-ruta').hidden = false;
  $('#titulo-ruta').textContent = ruta.nombre || 'Tu ruta';
  const prioridadTexto = (ruta.prioridad || []).length
    ? ` · prioriza ${listaNatural(ruta.prioridad.map((k) => PRIORIDADES.find((p) => p.clave === k).nombre.toLowerCase()))}`
    : '';
  $('#etiqueta-ajuste').textContent = (ruta.ajuste ? `incluye +${Math.round(ruta.ajuste * 100)} % tráfico` : 'sin tráfico') + prioridadTexto;
  $('#st-dur').textContent = formatoDur(durMostrada);
  $('#st-dist').textContent = formatoDist(ruta.distancia);
  $('#st-rot').textContent = ruta.stats.rotondas;
  $('#st-stop').textContent = ruta.stats.stops;
  $('#st-ceda').textContent = ruta.stats.cedas;
  $('#st-izq').textContent = ruta.stats.izquierda;
  $('#st-der').textContent = ruta.stats.derecha;
  $('#st-inc').textContent = ruta.stats.incorporaciones;

  const enZona = Object.entries(ruta.stats.porMunicipio).filter(([n]) => n !== 'Límite');
  const total = enZona.reduce((a, [, m]) => a + m, 0) || 1;
  const filas = enZona.filter(([, m]) => m / total >= 0.01).sort((a, b) => b[1] - a[1]);
  $('#reparto').innerHTML = `<div class="barra">${filas.map(([n, m]) => `<span style="width:${(m / total) * 100}%;background:${COLORES[n] || '#999'}"></span>`).join('')}</div>
    <div class="leyenda">${filas.map(([n, m]) => `<span><i style="background:${COLORES[n] || '#999'}"></i>${CORTO[n] || n} ${Math.round((m / total) * 100)} %</span>`).join('')}</div>`;
  $('#vias').textContent = ruta.stats.vias.length ? `Carreteras y autovías: ${ruta.stats.vias.join(', ')}` : 'Recorrido solo por vías urbanas.';

  const ol = $('#pasos');
  ol.innerHTML = '';
  ruta.pasos.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `${iconoManiobra(p.tipo, p.modificador)}<span>${p.texto}</span><small>${p.tipo === 'arrive' ? '' : formatoDist(p.dist)}</small>`;
    li.addEventListener('click', () => {
      mapa.setView(p.loc, 17);
      L.popup().setLatLng(p.loc).setContent(p.texto).openOn(mapa);
      if (window.innerWidth <= 760) hoja.plegar();
    });
    ol.appendChild(li);
  });
  $('#n-pasos').textContent = ruta.pasos.length;
  $('#btn-generar').textContent = 'Generar otra ruta';
  if (!inicial && window.innerWidth > 760) $('#sec-ruta').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Rutas guardadas ----------
function leerGuardadas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_RUTAS) || '[]'); } catch { return []; }
}
function escribirGuardadas(lista) {
  try { localStorage.setItem(CLAVE_RUTAS, JSON.stringify(lista)); return true; } catch { return false; }
}
function guardarRuta() {
  if (!estado.ruta) return;
  const lista = leerGuardadas().filter((r) => r.id !== estado.ruta.id);
  lista.unshift(estado.ruta);
  if (!escribirGuardadas(lista.slice(0, 15))) { aviso('No se ha podido guardar (almacenamiento no disponible o lleno).'); return; }
  aviso('Ruta guardada en este dispositivo.');
  pintarGuardadas();
}
function pintarGuardadas() {
  const ul = $('#lista-rutas');
  const propias = leerGuardadas();
  const items = [...estado.ejemplos.map((r) => ({ r, ejemplo: true })), ...propias.map((r) => ({ r, ejemplo: false }))];
  if (!items.length) { ul.innerHTML = '<li class="vacio">Aún no has guardado ninguna ruta.</li>'; return; }
  ul.innerHTML = '';
  for (const { r, ejemplo } of items) {
    const li = document.createElement('li');
    const fecha = new Date(r.creada).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    li.innerHTML = `<div><strong>${ejemplo ? 'Ejemplo: ' : ''}${r.nombre || 'Ruta'}</strong><span>${formatoDur(r.duracion * (1 + (r.ajuste || 0)))} · ${formatoDist(r.distancia)} · ${r.stats.rotondas} rotondas · ${fecha}</span></div>`;
    const ver = document.createElement('button'); ver.textContent = 'Ver';
    ver.addEventListener('click', () => mostrarRuta(r));
    li.appendChild(ver);
    if (!ejemplo) {
      const borrar = document.createElement('button'); borrar.textContent = 'Quitar';
      borrar.addEventListener('click', () => { escribirGuardadas(leerGuardadas().filter((x) => x.id !== r.id)); pintarGuardadas(); });
      li.appendChild(borrar);
    }
    ul.appendChild(li);
  }
}

// ---------- Exportar ----------
function exportarGpx() {
  const r = estado.ruta; if (!r) return;
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const wpts = [{ lat: r.salida.lat, lon: r.salida.lon, n: 'Salida y llegada' }, ...r.puntosPaso.map((p, i) => ({ lat: p.lat, lon: p.lon, n: `Punto ${i + 1} (${p.tipo})` }))]
    .map((w) => `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${esc(w.n)}</name></wpt>`).join('\n');
  const trk = r.geometria.map((g) => `      <trkpt lat="${g[0]}" lon="${g[1]}"/>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PractiRuta Moto" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(r.nombre)}</name><time>${r.creada}</time></metadata>
${wpts}
  <trk><name>${esc(r.nombre)}</name><trkseg>
${trk}
  </trkseg></trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  a.download = `practiruta_${r.objetivoMin || 60}min_${r.id}.gpx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Google Maps admite pocos puntos intermedios: se toman 9 equidistantes del recorrido.
function abrirGoogleMaps() {
  const r = estado.ruta; if (!r) return;
  const nav = new Navegador(r);
  const n = 9;
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push(nav.puntoEn((nav.total * i) / (n + 1)));
  const f = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const s = [r.salida.lat, r.salida.lon];
  const url = `https://www.google.com/maps/dir/?api=1&origin=${f(s)}&destination=${f(s)}&waypoints=${pts.map(f).join('%7C')}&travelmode=driving`;
  window.open(url, '_blank', 'noopener');
}

// ---------- Navegación ----------
let idSeguimiento = null, temporizadorSim = null, bloqueoPantalla = null, seguir = true;

async function iniciarNavegacion(simular) {
  if (!estado.ruta) return;
  if (!simular && !('geolocation' in navigator)) { aviso('Este dispositivo no permite obtener la ubicación.'); return; }
  estado.nav = new Navegador(estado.ruta);
  document.body.classList.add('navegando');
  $('#nav-banner').hidden = false;
  $('#nav-inferior').hidden = false;
  $('#btn-centrar').hidden = false;
  $('#sel-vel').hidden = !simular;
  seguir = true;
  mapa.closePopup();
  setTimeout(() => mapa.invalidateSize(), 50);
  try { if ('wakeLock' in navigator) bloqueoPantalla = await navigator.wakeLock.request('screen'); } catch { /* opcional */ }

  const primero = estado.ruta.pasos[0];
  voz.decir(`Comienza la ruta. ${primero ? primero.texto : ''}`, true);

  if (simular) {
    let recorrido = 0;
    const tick = 250;
    temporizadorSim = setInterval(() => {
      const mult = Number($('#sel-vel').value) || 5;
      recorrido += estado.nav.velMedia * mult * (tick / 1000);
      const p = estado.nav.puntoEn(recorrido);
      alRecibirPosicion(p[0], p[1], 5);
      if (recorrido >= estado.nav.total) { clearInterval(temporizadorSim); temporizadorSim = null; }
    }, tick);
  } else {
    $('#nav-instr').textContent = 'Esperando señal GPS...';
    idSeguimiento = navigator.geolocation.watchPosition(
      (pos) => alRecibirPosicion(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => aviso(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }
}

function alRecibirPosicion(lat, lon, precision) {
  if (!estado.nav) return;
  const e = estado.nav.actualizar(lat, lon, precision);
  if (!marcadorPos) {
    circuloPrecision = L.circle([lat, lon], { radius: precision, color: '#1d6fe0', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(mapa);
    marcadorPos = L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d6fe0', fillOpacity: 1 }).addTo(mapa);
  } else {
    marcadorPos.setLatLng([lat, lon]);
    circuloPrecision.setLatLng([lat, lon]).setRadius(precision);
  }
  if (seguir) mapa.setView([lat, lon], Math.max(mapa.getZoom(), 17), { animate: true });

  const banner = $('#nav-banner');
  banner.classList.toggle('fuera', e.fuera);
  if (e.fuera) {
    $('#nav-icono').innerHTML = iconoManiobra('turn', 'uturn');
    $('#nav-dist').textContent = `A ${formatoDist(e.lateral)} de la ruta`;
    $('#nav-instr').textContent = 'Fuera de ruta: vuelve al recorrido marcado';
    $('#nav-despues').textContent = '';
  } else if (e.siguiente) {
    $('#nav-icono').innerHTML = iconoManiobra(e.siguiente.tipo, e.siguiente.modificador);
    $('#nav-dist').textContent = formatoDist(e.distSiguiente);
    $('#nav-instr').textContent = e.siguiente.texto;
    $('#nav-despues').textContent = e.despues ? `Después: ${e.despues.texto}` : '';
  }
  $('#nav-restante').textContent = `Quedan ${formatoDur(e.restanteSeg * (1 + (estado.ruta.ajuste || 0)))}`;
  $('#nav-restante-km').textContent = formatoDist(e.restanteM);
  $('#nav-barra').style.width = `${(e.recorrido / e.total) * 100}%`;
  for (const v of e.voz) voz.decir(v.texto, v.urgente);
  if (e.terminado) {
    $('#nav-icono').innerHTML = iconoManiobra('arrive');
    $('#nav-dist').textContent = 'Fin de la ruta';
    $('#nav-instr').textContent = 'Has vuelto al punto de salida';
    $('#nav-despues').textContent = '';
  }
}

function pararNavegacion() {
  if (idSeguimiento !== null) navigator.geolocation.clearWatch(idSeguimiento);
  if (temporizadorSim) clearInterval(temporizadorSim);
  idSeguimiento = null; temporizadorSim = null;
  if (bloqueoPantalla) { bloqueoPantalla.release().catch(() => {}); bloqueoPantalla = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  estado.nav = null;
  document.body.classList.remove('navegando');
  $('#nav-banner').hidden = true;
  $('#nav-inferior').hidden = true;
  $('#btn-centrar').hidden = true;
  if (marcadorPos) { marcadorPos.remove(); circuloPrecision.remove(); marcadorPos = null; circuloPrecision = null; }
  setTimeout(() => {
    mapa.invalidateSize();
    if (estado.ruta) encuadrar(L.latLngBounds(estado.ruta.geometria));
  }, 50);
}

function conectarAcciones() {
  $('#btn-navegar').addEventListener('click', () => iniciarNavegacion(false));
  $('#btn-simular').addEventListener('click', () => iniciarNavegacion(true));
  $('#btn-parar').addEventListener('click', pararNavegacion);
  $('#btn-guardar').addEventListener('click', guardarRuta);
  $('#btn-gpx').addEventListener('click', exportarGpx);
  $('#btn-gmaps').addEventListener('click', abrirGoogleMaps);
  $('#btn-voz').addEventListener('click', (e) => {
    voz.activa = !voz.activa;
    e.target.textContent = `Voz: ${voz.activa ? 'sí' : 'no'}`;
    if (!voz.activa && 'speechSynthesis' in window) speechSynthesis.cancel();
  });
  $('#btn-centrar').addEventListener('click', () => {
    seguir = true;
    if (marcadorPos) mapa.setView(marcadorPos.getLatLng(), 17);
  });
  mapa.on('dragstart', () => { if (estado.nav) seguir = false; });
}

// ---------- Arranque ----------
(async function arrancar() {
  try {
    await cargarDatos();
  } catch (e) {
    aviso('No se han podido cargar los datos de las zonas. Abre la app desde un servidor web (ver README).', 10000);
    return;
  }
  hoja = crearHoja($('#panel'), $('#panel-cabecera'));
  iniciarMapa();
  construirConfig();
  conectarAcciones();
  pintarGuardadas();
  if (estado.ejemplos.length && !leerGuardadas().length) mostrarRuta(estado.ejemplos[0], { inicial: true });
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
})();
