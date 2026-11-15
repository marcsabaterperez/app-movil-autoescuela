// Seguimiento de la posición GPS sobre la ruta: progreso, siguiente maniobra, avisos de voz
// y detección de salida de ruta.

import { distM } from './geo.js';
import { distanciaVoz } from './instrucciones.js';

const DIST_PREAVISO = 220;
const DIST_AVISO = 40;
const UMBRAL_FUERA = 45;

export class Navegador {
  constructor(ruta) {
    this.ruta = ruta;
    this.g = ruta.geometria;
    this.cum = [0];
    for (let i = 1; i < this.g.length; i++) this.cum.push(this.cum[i - 1] + distM(this.g[i - 1], this.g[i]));
    this.total = this.cum[this.cum.length - 1];
    this.velMedia = ruta.distancia / Math.max(1, ruta.duracion);
    this.pasos = ruta.pasos.map((p) => ({ ...p, cumM: this.cum[Math.min(p.idx, this.cum.length - 1)] }));
    this.seg = 0;
    this.recorrido = 0;
    this.contFuera = 0;
    this.fuera = false;
    this.avisados = new Set();
    this.terminado = false;
  }

  puntoEn(m) {
    const c = this.cum;
    if (m <= 0) return this.g[0];
    if (m >= this.total) return this.g[this.g.length - 1];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= m) lo = mid; else hi = mid; }
    const t = (m - c[lo]) / Math.max(1e-9, c[hi] - c[lo]);
    const a = this.g[lo], b = this.g[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  _proyectar(lat, lon) {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    const buscar = (desde, hasta) => {
      let mejor = { d: Infinity, i: 0, t: 0 };
      for (let i = Math.max(0, desde); i < Math.min(hasta, this.g.length - 1); i++) {
        const p = this.g[i], q = this.g[i + 1];
        const ax = (p[1] - lon) * kx, ay = (p[0] - lat) * ky, bx = (q[1] - lon) * kx, by = (q[0] - lat) * ky;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        let t = L ? -(ax * dx + ay * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < mejor.d) mejor = { d, i, t };
      }
      return mejor;
    };
    let b = buscar(this.seg - 20, this.seg + 300);
    if (b.d > UMBRAL_FUERA) {
      const global = buscar(0, this.g.length);
      if (global.d < b.d - 10) b = global;
    }
    return { seg: b.i, recorrido: this.cum[b.i] + b.t * (this.cum[b.i + 1] - this.cum[b.i]), lateral: b.d };
  }

  // Devuelve el estado de navegación y la lista de frases a decir.
  actualizar(lat, lon, precision = 10) {
    const voz = [];
    const p = this._proyectar(lat, lon);
    if (p.lateral > UMBRAL_FUERA && precision < 60) this.contFuera++; else this.contFuera = 0;
    const fuera = this.contFuera >= 3;
    if (fuera && !this.fuera) voz.push({ texto: 'Te has salido de la ruta. Vuelve al recorrido marcado.', urgente: true });
    if (!fuera && this.fuera) voz.push({ texto: 'Has vuelto a la ruta.' });
    this.fuera = fuera;
    if (!fuera) { this.seg = p.seg; this.recorrido = p.recorrido; }

    const i = this.pasos.findIndex((x) => x.cumM > this.recorrido + 3);
    const sig = i >= 0 ? this.pasos[i] : null;
    const despues = i >= 0 ? this.pasos[i + 1] || null : null;
    const distSig = sig ? sig.cumM - this.recorrido : 0;

    if (sig && !fuera && sig.tipo === 'arrive') {
      if (distSig <= DIST_PREAVISO && distSig > DIST_AVISO + 30 && !this.avisados.has(`${i}:lejos`)) {
        this.avisados.add(`${i}:lejos`);
        voz.push({ texto: `En ${distanciaVoz(distSig)}, llegarás al punto de salida` });
      }
    } else if (sig && !fuera) {
      const claveCerca = `${i}:cerca`, claveLejos = `${i}:lejos`;
      if (distSig <= DIST_AVISO && !this.avisados.has(claveCerca)) {
        this.avisados.add(claveCerca); this.avisados.add(claveLejos);
        let frase = sig.texto;
        if (despues && despues.cumM - sig.cumM < 80 && despues.tipo !== 'arrive') frase += `. Y después, ${minus(despues.texto)}`;
        voz.push({ texto: frase, urgente: true });
      } else if (distSig <= DIST_PREAVISO && distSig > DIST_AVISO + 30 && !this.avisados.has(claveLejos)) {
        this.avisados.add(claveLejos);
        voz.push({ texto: `En ${distanciaVoz(distSig)}, ${minus(sig.texto)}` });
      }
    }

    if (!this.terminado && this.recorrido >= this.total - 25) {
      this.terminado = true;
      voz.push({ texto: 'Has vuelto al punto de salida. Fin de la ruta. Buen trabajo.', urgente: true });
    }

    const restante = Math.max(0, this.total - this.recorrido);
    return {
      recorrido: this.recorrido,
      total: this.total,
      restanteM: restante,
      restanteSeg: restante / this.velMedia,
      siguiente: sig,
      distSiguiente: distSig,
      despues,
      fuera,
      lateral: p.lateral,
      terminado: this.terminado,
      voz,
    };
  }
}

const minus = (t) => t.charAt(0).toLowerCase() + t.slice(1);
