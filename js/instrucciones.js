// Indicaciones en español a partir de las maniobras de OSRM, formatos e iconos.

const MOD = {
  left: 'a la izquierda',
  right: 'a la derecha',
  'slight left': 'ligeramente a la izquierda',
  'slight right': 'ligeramente a la derecha',
  'sharp left': 'muy cerrado a la izquierda',
  'sharp right': 'muy cerrado a la derecha',
  straight: 'recto',
  uturn: 'cambio de sentido',
};
const ORDINAL = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];

const lado = (mod) => (mod && mod.includes('left') ? 'a la izquierda' : 'a la derecha');

export function nombreVia(paso) {
  const n = (paso.nombre || '').trim();
  const r = (paso.ref || '').split(';')[0].trim();
  if (n && r && !n.includes(r)) return `${n} (${r})`;
  return n || r;
}

export function textoManiobra(paso, esFinal = false) {
  const { tipo, modificador: mod, salida } = paso;
  const v = nombreVia(paso);
  const por = v ? ` por ${v}` : '';
  const hacia = v ? ` hacia ${v}` : '';
  switch (tipo) {
    case 'depart':
      return mod === 'uturn' ? `Haz un cambio de sentido${por}` : `Sal${por}`;
    case 'arrive':
      return esFinal ? 'Has vuelto al punto de salida. Fin de la ruta' : 'Punto de paso alcanzado';
    case 'turn':
    case 'end of road': {
      if (mod === 'uturn') return `Haz un cambio de sentido${por}`;
      if (mod === 'straight') return `Sigue recto${por}`;
      const pre = tipo === 'end of road' ? 'Al final de la vía, gira' : 'Gira';
      return `${pre} ${MOD[mod] || ''}${por}`;
    }
    case 'new name':
      return `Continúa${por}`;
    case 'continue':
      if (mod === 'uturn') return `Haz un cambio de sentido${por}`;
      return mod && mod !== 'straight' ? `Continúa ${MOD[mod]}${por}` : `Continúa recto${por}`;
    case 'merge':
      return `Incorpórate${mod && mod.includes('left') ? ' por la izquierda' : mod && mod.includes('right') ? ' por la derecha' : ''}${v ? ` a ${v}` : ''}`;
    case 'on ramp':
      return `Toma el acceso ${lado(mod)}${hacia}`;
    case 'off ramp':
      return `Toma la salida ${lado(mod)}${hacia}`;
    case 'fork':
      return `En la bifurcación, mantente ${lado(mod)}${hacia}`;
    case 'roundabout':
    case 'rotary': {
      const nombreRot = paso.nombreRotonda ? ` ${paso.nombreRotonda}` : '';
      const sal = salida ? `toma la ${ORDINAL[salida] || salida + 'ª'} salida` : 'sal';
      return `En la rotonda${nombreRot}, ${sal}${hacia}`;
    }
    case 'roundabout turn':
      return `En la rotonda, ${mod === 'straight' ? 'sigue recto' : 'gira ' + (MOD[mod] || '')}${por}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Sal de la rotonda${hacia}`;
    default:
      return `Continúa${por}`;
  }
}

export function formatoDist(m) {
  if (m >= 1000) return `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: m < 10000 ? 1 : 0 })} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m / 5) * 5)} m`;
}

export function distanciaVoz(m) {
  if (m >= 1000) return `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} kilómetros`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metros`;
}

export function formatoDur(seg) {
  const min = Math.round(seg / 60);
  if (min <= 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return `${h} h ${String(r).padStart(2, '0')} min`;
}

// Iconos SVG de maniobra (trazo, heredan el color del texto).
const FLECHA_RECTA = '<path d="M12 21V4M6 10l6-6 6 6"/>';
const GIRO_DCHA = '<path d="M7 21v-8a5 5 0 0 1 5-5h8M15 3l5 5-5 5"/>';
const ESPEJO = (contenido) => `<g transform="translate(24 0) scale(-1 1)">${contenido}</g>`;
const ROTAR = (grados, contenido) => `<g transform="rotate(${grados} 12 12)">${contenido}</g>`;

export function iconoManiobra(tipo, mod) {
  let c;
  if (tipo === 'roundabout' || tipo === 'rotary' || tipo === 'roundabout turn') {
    c = '<circle cx="12" cy="9" r="5"/><path d="M12 21v-7"/><path d="M15.5 5.5 19 2M15.5 2H19v3.5"/>';
  } else if (tipo === 'arrive') {
    c = '<path d="M6 21V4h11l-2 4 2 4H6"/>';
  } else if (tipo === 'depart') {
    c = '<circle cx="12" cy="18" r="3"/><path d="M12 15V4M8 8l4-4 4 4"/>';
  } else if (mod === 'uturn') {
    c = '<path d="M16 21V10a5 5 0 0 0-10 0v4M3 11l3 3 3-3"/>';
  } else if (mod === 'right') c = GIRO_DCHA;
  else if (mod === 'left') c = ESPEJO(GIRO_DCHA);
  else if (mod === 'slight right') c = ROTAR(40, FLECHA_RECTA);
  else if (mod === 'slight left') c = ROTAR(-40, FLECHA_RECTA);
  else if (mod === 'sharp right') c = ROTAR(130, FLECHA_RECTA);
  else if (mod === 'sharp left') c = ROTAR(-130, FLECHA_RECTA);
  else c = FLECHA_RECTA;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c}</svg>`;
}
