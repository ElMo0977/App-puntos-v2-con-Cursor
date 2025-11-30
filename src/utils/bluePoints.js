import { dist3D } from './geometry';
import { MIN_BLUE_BLUE, MIN_RED_BLUE, key01 } from './constants';

/**
 * Distancia mínima entre un candidato y un conjunto de puntos.
 * @param {{x:number,y:number,z:number}} p Punto candidato.
 * @param {{x:number,y:number,z:number}[]} set Conjunto de puntos de referencia.
 * @returns {number} Distancia mínima.
 */
export function minDistToSet(p, set) {
  return set.reduce((m, q) => Math.min(m, dist3D(p, q)), Infinity);
}

/**
 * Puntuación tipo maximin con jitter para priorizar separación entre puntos y fuentes.
 * @param {{x:number,y:number,z:number}} cand Candidato a evaluar.
 * @param {{x:number,y:number,z:number}[]} chosen Puntos azules ya elegidos.
 * @param {() => {x:number,y:number,z:number}[]} redAnchors Función que devuelve las fuentes activas.
 * @param {() => number} rng Generador pseudoaleatorio en [0,1).
 * @returns {number} Puntuación del candidato (mayor es mejor).
 */
export function scoreMaximin(cand, chosen, redAnchors, rng) {
  const anchors = [...redAnchors(), ...chosen];
  const dA = minDistToSet(cand, anchors);
  const dB = chosen.length
    ? Math.min(...chosen.map((q) => dist3D(cand, q)))
    : dA;
  const dR = redAnchors().length
    ? Math.min(...redAnchors().map((r) => dist3D(cand, r)))
    : Infinity;
  return (
    Math.min(dB, dR) * 10 +
    dB * 2 +
    (Number.isFinite(dR) ? dR : 0) +
    rng() * 0.05
  );
}

/**
 * Refinamiento local: intenta sustituir cada punto por otro del mismo nivel Z que mejore la puntuación.
 * @param {{x:number,y:number,z:number}[]} pts Puntos generados.
 * @param {Map<string,{x:number,y:number,z:number}[]>} byZ Índice de candidatos por nivel Z (clave: key01(Z)).
 * @param {() => {x:number,y:number,z:number}[]} redAnchors Fuentes activas.
 * @param {() => number} rng Generador pseudoaleatorio usado en score.
 * @returns {{x:number,y:number,z:number}[]} Conjunto refinado.
 */
export function refinePoints(pts, byZ, redAnchors, rng) {
  const best = pts.slice();
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < best.length; i++) {
      const zi = key01(best[i].z);
      const anchors = redAnchors();
      const pool = (byZ.get(zi) || []).filter((c) => {
        const cx = key01(c.x);
        const cy = key01(c.y);
        if (cx === key01(best[i].x) && cy === key01(best[i].y)) return false;
        if (
          best.some(
            (q, k) => k !== i && (key01(q.x) === cx || key01(q.y) === cy)
          )
        )
          return false;
        if (anchors.some((r) => key01(r.x) === cx || key01(r.y) === cy))
          return false;
        if (!anchors.every((r) => dist3D(c, r) >= MIN_RED_BLUE)) return false;
        if (
          !best.every((q, k) =>
            k === i ? true : dist3D(c, q) >= MIN_BLUE_BLUE
          )
        )
          return false;
        return true;
      });
      let cand = best[i];
      let score = scoreMaximin(
        cand,
        best.filter((_, k) => k !== i),
        redAnchors,
        rng
      );
      for (const p of pool) {
        const sc = scoreMaximin(
          p,
          best.filter((_, k) => k !== i),
          redAnchors,
          rng
        );
        if (sc > score) {
          score = sc;
          cand = p;
        }
      }
      best[i] = cand;
    }
  }
  return best;
}
