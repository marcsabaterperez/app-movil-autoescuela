// Panel inferior arrastrable (solo en pantallas de móvil).
// Se arrastra desde la cabecera (barra + título). Como mínimo queda visible la cabecera completa
// ("PractiRuta Moto" y su subtítulo); como máximo ocupa el 88 % de la pantalla.
// Un toque en la cabecera alterna entre plegado y la última altura abierta.

const ANCHO_MOVIL = 760;
const MARGEN_AJUSTE = 40; // si se suelta a menos de esto del mínimo, se pliega del todo

export function crearHoja(panel, cabecera) {
  const esMovil = () => window.innerWidth <= ANCHO_MOVIL;
  const altoMin = () => Math.ceil(cabecera.offsetHeight) + 2;
  const altoMax = () => Math.round(window.innerHeight * 0.88);
  const altoInicial = () => Math.round(window.innerHeight * 0.58);
  let alto = null;
  let ultimoAbierto = null;

  function fijar(h, animar = true) {
    if (!esMovil()) {
      panel.style.height = '';
      panel.classList.remove('plegado', 'animando');
      document.documentElement.style.removeProperty('--alto-panel');
      return;
    }
    const min = altoMin();
    alto = Math.max(min, Math.min(altoMax(), Math.round(h)));
    panel.classList.toggle('animando', animar);
    panel.style.height = `${alto}px`;
    const plegado = alto <= min + 1;
    panel.classList.toggle('plegado', plegado);
    if (!plegado) ultimoAbierto = alto;
    document.documentElement.style.setProperty('--alto-panel', `${alto}px`);
  }

  let inicioY = null, inicioAlto = 0, movido = false;
  cabecera.addEventListener('pointerdown', (e) => {
    if (!esMovil() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    inicioY = e.clientY;
    inicioAlto = panel.offsetHeight;
    movido = false;
    cabecera.setPointerCapture(e.pointerId);
  });
  cabecera.addEventListener('pointermove', (e) => {
    if (inicioY === null) return;
    const dy = e.clientY - inicioY;
    if (!movido && Math.abs(dy) < 5) return;
    movido = true;
    fijar(inicioAlto - dy, false);
  });
  const soltar = () => {
    if (inicioY === null) return;
    inicioY = null;
    if (!movido) {
      // Toque: alterna plegado / abierto
      fijar(alto <= altoMin() + 1 ? (ultimoAbierto || altoInicial()) : altoMin());
      return;
    }
    if (alto - altoMin() < MARGEN_AJUSTE) fijar(altoMin());
  };
  cabecera.addEventListener('pointerup', soltar);
  cabecera.addEventListener('pointercancel', soltar);
  // Teclado: la barra es un botón
  cabecera.querySelector('.asa').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fijar(alto <= altoMin() + 1 ? (ultimoAbierto || altoInicial()) : altoMin());
    }
  });

  window.addEventListener('resize', () => fijar(alto ?? altoInicial(), false));
  fijar(altoInicial(), false);

  return {
    plegar: () => fijar(altoMin()),
    abrir: () => fijar(ultimoAbierto || altoInicial()),
  };
}
