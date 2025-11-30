const EPS = 1e-9;

/**
 * Calcula la distancia euclidiana entre dos puntos tridimensionales.
 * @param {{x:number, y:number, z:number}} a Primer punto.
 * @param {{x:number, y:number, z:number}} b Segundo punto.
 * @returns {number} Distancia 3D entre a y b.
 */
export function dist3D(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Devuelve distancias planas entre dos puntos en los tres planos principales.
 * @param {{x:number, y:number, z:number}} a Primer punto.
 * @param {{x:number, y:number, z:number}} b Segundo punto.
 * @returns {{xy:number, xz:number, yz:number}} Distancias en XY, XZ y YZ.
 */
export function planarDistances(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = a.z - b.z;
  return { xy: Math.hypot(dx, dy), xz: Math.hypot(dx, dz), yz: Math.hypot(dy, dz) };
}

/**
 * Determina si un punto está dentro de un polígono en 2D usando ray casting.
 * @param {{x:number, y:number}} pt Punto a evaluar.
 * @param {{x:number, y:number}[]} poly Polígono en el plano XY.
 * @returns {boolean} true si el punto está dentro (o sobre el borde).
 */
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const hit =
      (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) + EPS) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Calcula el área de un polígono simple en el plano XY.
 * @param {{x:number, y:number}[]} poly Vértices del polígono en orden.
 * @returns {number} Área positiva en unidades cuadradas.
 */
export function polygonArea(poly) {
  let A = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    A += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(A) / 2;
}

/**
 * Distancia mínima entre un punto y un segmento en 2D.
 * @param {{x:number, y:number}} p Punto a medir.
 * @param {{x:number, y:number}} a Extremo A del segmento.
 * @param {{x:number, y:number}} b Extremo B del segmento.
 * @returns {number} Distancia al segmento.
 */
export function distPointToSegment2D(p, a, b) {
  const vx = b.x - a.x,
    vy = b.y - a.y,
    wx = p.x - a.x,
    wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

/**
 * Distancia mínima de un punto a cualquiera de los lados de un polígono.
 * @param {{x:number, y:number}} p Punto a medir.
 * @param {{x:number, y:number}[]} poly Polígono en el plano XY.
 * @returns {number} Distancia al borde más cercano.
 */
export function minDistToEdges2D(p, poly) {
  let md = Infinity;
  for (let i = 0; i < poly.length; i++) md = Math.min(md, distPointToSegment2D(p, poly[i], poly[(i + 1) % poly.length]));
  return md;
}

// RNG simple reproducible
/**
 * Generador pseudoaleatorio determinista (Mulberry32) a partir de una semilla.
 * @param {number} seed Semilla entera (se fuerza a uint32).
 * @returns {() => number} Función que devuelve valores en [0, 1).
 */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Devuelve una copia barajada de un array usando el generador indicado.
 * @param {Array} arr Array a barajar.
 * @param {() => number} rng Función aleatoria que devuelve valores en [0,1).
 * @returns {Array} Copia de arr mezclada.
 */
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
