import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NumInput from "./components/NumInput";
import {
  dist3D,
  planarDistances,
  pointInPolygon,
  polygonArea,
  distPointToSegment2D,
  minDistToEdges2D,
  mulberry32,
  shuffle,
} from "./utils/geometry";

/**
 * Estructura general:
 * - Estado de geometría: vertices (polígono XY) y alturaZ.
 * - Estado de puntos: F1/F2 + flags de activación y los puntos azules (blue/blueActive).
 * - Estado de UI y reglas: anillos de distancia, mensajes, busy flag y nonce para variar la generación.
 * - Historial: past/future guardan snapshots para undo/redo.
 * - Cálculos derivados (memoizados): bounds, escala, celdas candidatas, distancias y violaciones.
 * - Flujo: generateBluePoints elige combinaciones válidas; validate revisa reglas y muestra avisos.
 */
// ===== Utilidades cortas =====
const EPS = 1e-9;
const STEP = 0.1; // rejilla 0,1 m
const round01 = (n) => Math.round(n * 10) / 10;
const key01 = (n) => n.toFixed(1);
const parseNum = (v, fb = 0) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fb;
};

// Convierte índice 0->A, 1->B, ... 25->Z, 26->AA, etc.
const idxToLetter = (i) => {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

// ===== Reglas =====
const MARGIN = 0.5; // a caras (incluye Z)
const MIN_RED_BLUE = 1.0; // F–P ≥ 1,0 m (3D)
const MIN_BLUE_BLUE = 0.7; // P–P ≥ 0,7 m (3D)
const MIN_F_F_AXIS = 0.7; // F–F ≥ 0,7 m en cada eje

// ===== Funciones auxiliares de validación (reutilizables) =====
/**
 * Detecta duplicidades de coordenadas por eje.
 * @param {{name:string, p:{x:number,y:number,z:number}}[]} points Lista de puntos con nombre.
 * @param {{includeFx?:boolean, axis?:string}} options includeFx=false excluye Fx en Z; axis limita a un eje.
 * @returns {string[]} Mensajes descriptivos de duplicidades detectadas.
 */
function checkCoordinateDuplicates(points, { includeFx = true, axis = null } = {}) {
  const axes = axis ? [axis] : ["x", "y", "z"];
  const messages = [];
  
  axes.forEach((ax) => {
    const map = new Map();
    const pool = ax === "z" && !includeFx 
      ? points.filter(({ name }) => name.startsWith("P"))
      : points;
    
    pool.forEach(({ name, p }) => {
      const k = key01(p[ax]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(name);
    });
    
    for (const [k, names] of map) {
      if (names.length > 1) {
        messages.push(`${ax.toUpperCase()} repetida (= ${k}) entre ${names.join(", ")}`);
      }
    }
  });
  
  return messages;
}

/**
 * Valida que un punto cumpla polígono y márgenes (XY + Z).
 * @param {{x:number,y:number,z:number}} p Punto a validar.
 * @param {{x:number,y:number}[]} vertices Polígono de la planta.
 * @param {number} alturaZ Altura del recinto.
 * @returns {string[]} Mensajes de error si se incumplen márgenes o pertenencia al polígono.
 */
function checkPolygonAndMargins(p, vertices, alturaZ) {
  const messages = [];
  
  if (!pointInPolygon(p, vertices)) {
    messages.push("Fuera del polígono (XY)");
  }
  if (minDistToEdges2D(p, vertices) < MARGIN - EPS) {
    messages.push("A <0,5 del borde (XY)");
  }
  if (p.z < MARGIN || p.z > alturaZ - MARGIN) {
    messages.push("Z fuera de márgenes");
  }
  
  return messages;
}

/**
 * Valida distancias mínimas entre F1 y F2 en cada eje y planos.
 * @param {{x:number,y:number,z:number}} F1 Coordenadas de la fuente 1.
 * @param {{x:number,y:number,z:number}} F2 Coordenadas de la fuente 2.
 * @returns {{violations:{x:boolean,y:boolean,z:boolean}, messages:string[]}} Flags por eje y mensajes.
 */
function checkF1F2Distances(F1, F2) {
  const pd = planarDistances(F1, F2);
  const dx = Math.abs(F1.x - F2.x);
  const dy = Math.abs(F1.y - F2.y);
  const dz = Math.abs(F1.z - F2.z);
  
  const violations = { x: false, y: false, z: false };
  const messages = [];
  
  if (pd.xy < MIN_F_F_AXIS) {
    violations.x = violations.y = true;
    messages.push(`F1–F2 < 0,7 en XY (${pd.xy.toFixed(2)} m)`);
  }
  if (pd.xz < MIN_F_F_AXIS) {
    violations.x = violations.z = true;
    messages.push(`F1–F2 < 0,7 en XZ (${pd.xz.toFixed(2)} m)`);
  }
  if (pd.yz < MIN_F_F_AXIS) {
    violations.y = violations.z = true;
    messages.push(`F1–F2 < 0,7 en YZ (${pd.yz.toFixed(2)} m)`);
  }
  if (dx < MIN_F_F_AXIS) {
    violations.x = true;
    messages.push(`F1–F2: |X| = ${dx.toFixed(2)} < 0,7 m`);
  }
  if (dy < MIN_F_F_AXIS) {
    violations.y = true;
    messages.push(`F1–F2: |Y| = ${dy.toFixed(2)} < 0,7 m`);
  }
  if (dz < MIN_F_F_AXIS) {
    violations.z = true;
    messages.push(`F1–F2: |Z| = ${dz.toFixed(2)} < 0,7 m`);
  }
  
  return { violations, messages };
}

/**
 * Valida distancias entre todos los puntos activos y clasifica violaciones.
 * @param {{name:string,p:{x:number,y:number,z:number}}[]} points Lista de puntos con nombre.
 * @param {{activeF1?:boolean, activeF2?:boolean, F1?:{x:number,y:number,z:number}, F2?:{x:number,y:number,z:number}}} options Estado de activación y coordenadas Fx.
 * @returns {{pairs:Set<string>, msgs:string[]}} Pares en violación y mensajes de detalle.
 */
function checkAllDistances(points, { activeF1 = false, activeF2 = false, F1 = null, F2 = null } = {}) {
  const pairs = new Set();
  const msgs = [];
  const N = points.length;
  
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const A = points[i], B = points[j];
      const nameA = A.name, nameB = B.name;
      const isFA = nameA.startsWith("F");
      const isFB = nameB.startsWith("F");
      const isPA = nameA.startsWith("P");
      const isPB = nameB.startsWith("P");
      
      if (isFA && isFB) {
        const dx = Math.abs(A.p.x - B.p.x);
        const dy = Math.abs(A.p.y - B.p.y);
        const dz = Math.abs(A.p.z - B.p.z);
        const parts = [];
        if (dx < MIN_F_F_AXIS) parts.push(`|X|=${dx.toFixed(1)}`);
        if (dy < MIN_F_F_AXIS) parts.push(`|Y|=${dy.toFixed(1)}`);
        if (dz < MIN_F_F_AXIS) parts.push(`|Z|=${dz.toFixed(1)}`);
        if (parts.length) {
          pairs.add(`${i}-${j}`);
          msgs.push(`${nameA}–${nameB}: ${parts.join(", ")} < 0.7 m`);
        }
      } else if ((isFA && isPB) || (isFB && isPA)) {
        const d = dist3D(A.p, B.p);
        if (d < MIN_RED_BLUE) {
          pairs.add(`${i}-${j}`);
          msgs.push(`${nameA}–${nameB} = ${d.toFixed(1)} < 1.0 m (3D)`);
        }
      } else if (isPA && isPB) {
        const d = dist3D(A.p, B.p);
        if (d < MIN_BLUE_BLUE) {
          pairs.add(`${i}-${j}`);
          msgs.push(`${nameA}–${nameB} = ${d.toFixed(1)} < 0.7 m (3D)`);
        }
      }
    }
  }
  
  return { pairs, msgs };
}

// ===== Generador de puntos azules =====
function generateBluePoints({
  F1,
  F2,
  candidates,
  seed = null,
  genNonce,
  f1Active = true,
  f2Active = true,
  byZ,
  zLevelsAll,
}) {
  if (!candidates.length) return { points: [], feasible: false };

  // RNG: si hay semilla, determinista; si no, varía con genNonce para dar combinaciones distintas por clic
  const userSeed = seed ? Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  const rng = mulberry32(seed ? userSeed : ((Date.now() ^ (genNonce * 0x9e3779b9)) >>> 0));

  // Preferencia de Z: P1=1.0 y +0.1 por punto, pero podremos ajustar
  const desiredZ = [1.0, 1.1, 1.2, 1.3, 1.4].map(round01);

  // Z de rojas NO bloquea a azules; Z única solo entre Pxs
  const usedZFromRed = new Set();

  // zOptions por índice: ordenados por cercanía al deseado + jitter y rotación aleatoria para diversificar
  const zOptionsByIdx = desiredZ.map((dz) => {
    const arr = zLevelsAll
      .map((z) => ({ z, k: Math.abs(z - dz) + rng() * 0.001 }))
      .sort((a, b) => a.k - b.k)
      .map((e) => e.z);
    if (!seed && arr.length) {
      const rot = Math.floor(rng() * arr.length);
      return [...arr.slice(rot), ...arr.slice(0, rot)];
    }
    return arr;
  });

  // Anchuras y utilidades
  const redAnchors = () => [...(f1Active ? [F1] : []), ...(f2Active ? [F2] : [])];
  const minDistToSet = (p, set) => set.reduce((m, q) => Math.min(m, dist3D(p, q)), Infinity);
  const scoreMaximin = (cand, chosen) => {
    const anchors = [...redAnchors(), ...chosen];
    const dA = minDistToSet(cand, anchors);
    const dB = chosen.length ? Math.min(...chosen.map((q) => dist3D(cand, q))) : dA;
    const dR = redAnchors().length ? Math.min(...redAnchors().map((r) => dist3D(cand, r))) : Infinity;
    return Math.min(dB, dR) * 10 + dB * 2 + (Number.isFinite(dR) ? dR : 0) + rng() * 0.05;
  };

  // Conjuntos usados por unicidad (incluye fuentes activas para X/Y; Z solo entre Pxs)
  const usedX0 = new Set();
  const usedY0 = new Set();
  const usedZ0 = new Set(); // Z no bloqueada por F1/F2
  if (f1Active) {
    usedX0.add(key01(F1.x));
    usedY0.add(key01(F1.y));
  }
  if (f2Active) {
    usedX0.add(key01(F2.x));
    usedY0.add(key01(F2.y));
  }

  // Backtracking: recoge múltiples soluciones válidas para poder rotarlas entre clics
  const MAX_NODES = 60000;
  let nodes = 0;
  const TOPC = 22;
  const TOPZ = 18; // ampliar búsqueda para no perder soluciones
  const MAX_SOL = 20; // cuántas soluciones guardamos
  const solutions = [];

  function dfs(i, chosen, usedX, usedY, usedZ) {
    if (nodes++ > MAX_NODES) return false;
    if (i === 5) {
      solutions.push(chosen.slice());
      return solutions.length >= MAX_SOL;
    }

    const zList = zOptionsByIdx[i].slice(0, Math.min(TOPZ, zOptionsByIdx[i].length));
    for (const z of zList) {
      const zk = key01(z);
      if (usedZ.has(zk)) continue; // Z único solo entre Pxs
      let pool = (byZ.get(zk) || []).filter((c) => !usedX.has(key01(c.x)) && !usedY.has(key01(c.y)));
      if (!pool.length) continue;

      // Filtrar por distancias; si vacío, no es válido este nivel Z
      const poolOk = pool.filter(
        (c) =>
          redAnchors().every((r) => dist3D(c, r) >= MIN_RED_BLUE) &&
          chosen.every((q) => dist3D(c, q) >= MIN_BLUE_BLUE)
      );
      if (!poolOk.length) continue;

      // Ranking maximin + jitter
      const ranked = poolOk
        .map((c) => ({ c, s: scoreMaximin(c, chosen) + rng() * 0.02 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.min(TOPC, poolOk.length));

      for (const { c } of ranked) {
        const nx = new Set(usedX);
        nx.add(key01(c.x));
        const ny = new Set(usedY);
        ny.add(key01(c.y));
        const nz = new Set(usedZ);
        nz.add(zk);
        if (dfs(i + 1, [...chosen, c], nx, ny, nz)) return true; // early stop si ya tenemos MAX_SOL
      }
    }
    return false;
  }

  dfs(0, [], usedX0, usedY0, usedZ0);

  // Pequeño refinamiento local para homogeneidad (maximin) sobre la solución elegida
  function refine(pts) {
    let best = pts.slice();
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < best.length; i++) {
        const zi = key01(best[i].z);
        const anchors = redAnchors();
        const pool = (byZ.get(zi) || []).filter((c) => {
          const cx = key01(c.x);
          const cy = key01(c.y);
          // Debe suponer un cambio real del punto i
          if (cx === key01(best[i].x) && cy === key01(best[i].y)) return false;
          // Unicidad X/Y respecto al resto de P
          if (best.some((q, k) => k !== i && (key01(q.x) === cx || key01(q.y) === cy))) return false;
          // Unicidad X/Y respecto a F activas
          if (anchors.some((r) => key01(r.x) === cx || key01(r.y) === cy)) return false;
          // Distancias mínimas con F activas
          if (!anchors.every((r) => dist3D(c, r) >= MIN_RED_BLUE)) return false;
          // Distancias mínimas con el resto de P
          if (!best.every((q, k) => (k === i ? true : dist3D(c, q) >= MIN_BLUE_BLUE))) return false;
          return true;
        });
        let cand = best[i];
        let score = scoreMaximin(cand, best.filter((_, k) => k !== i));
        for (const p of pool) {
          const sc = scoreMaximin(p, best.filter((_, k) => k !== i));
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

  if (solutions.length) {
    // Elegir distinta combinación en cada clic cuando no hay semilla
    const idx = seed ? 0 : genNonce % solutions.length;
    let pick = solutions[idx].slice();
    pick = refine(pick);
    return { points: pick, feasible: true };
  }

  // Fallback: no factible => devuelve 5 puntos maximizando separación (puede violar reglas).
  const anchors0 = redAnchors();
  const chosen = [];
  const usedX = new Set(usedX0),
    usedY = new Set(usedY0),
    usedZ = new Set(usedZ0);
  const all = shuffle(candidates, rng);

  for (let k = 0; k < 5; k++) {
    const levels = [
      (c) =>
        !usedX.has(key01(c.x)) &&
        !usedY.has(key01(c.y)) &&
        !usedZ.has(key01(c.z)) &&
        anchors0.every((r) => dist3D(c, r) >= MIN_RED_BLUE) &&
        chosen.every((q) => dist3D(c, q) >= MIN_BLUE_BLUE),
      (c) => !usedX.has(key01(c.x)) && !usedY.has(key01(c.y)) && !usedZ.has(key01(c.z)) && anchors0.every((r) => dist3D(c, r) >= MIN_RED_BLUE),
      (c) => !usedX.has(key01(c.x)) && !usedY.has(key01(c.y)) && !usedZ.has(key01(c.z)),
      (_) => true,
    ];
    let picked = null;
    for (const ok of levels) {
      const cand = all
        .filter(ok)
        .map((c) => ({ c, s: scoreMaximin(c, chosen) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 20);
      if (cand.length) {
        picked = cand[Math.floor(rng() * cand.length)].c;
        break;
      }
    }
    if (picked) {
      chosen.push(picked);
      usedX.add(key01(picked.x));
      usedY.add(key01(picked.y));
      usedZ.add(key01(picked.z));
    }
  }
  while (chosen.length < 5 && candidates.length) {
    const extra = candidates[Math.floor(rng() * candidates.length)];
    chosen.push(extra);
  }
  return { points: chosen.slice(0, 5), feasible: false };
}

export default function App() {
  // Polígono y altura
  const [vertices, setVertices] = useState([
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 2 },
    { x: 0, y: 2 },
  ]);
  const [alturaZ, setAlturaZ] = useState(2.5);

  // Fuentes y receptores
  const [F1, setF1] = useState({ x: 0.5, y: 1.5, z: 1.8 });
  const [F2, setF2] = useState({ x: 2.5, y: 0.5, z: 1.1 });
  const [activeF1, setActiveF1] = useState(true);
  const [activeF2, setActiveF2] = useState(true);
  const [blue, setBlue] = useState([]);
  const [blueActive, setBlueActive] = useState(true);

  // UI
  const radii = [0.5, 0.7, 1.0, 2.0];
  const [ringsRed, setRingsRed] = useState({ 0.5: true, 0.7: true, 1: false, 2: false });
  const [ringsBlue, setRingsBlue] = useState({ 0.5: true, 0.7: true, 1: false, 2: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);
  const [nonce, setNonce] = useState(0);

  // ===== Historial (Atrás / Adelante) =====
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const takeSnapshot = () =>
    JSON.parse(
      JSON.stringify({ vertices, alturaZ, F1, F2, activeF1, activeF2, blue, blueActive, ringsRed, ringsBlue })
    );
  const applySnapshot = (s) => {
    setVertices(s.vertices);
    setAlturaZ(s.alturaZ);
    setF1(s.F1);
    setF2(s.F2);
    setActiveF1(s.activeF1);
    setActiveF2(s.activeF2);
    setBlue(s.blue);
    if (typeof s.blueActive === 'boolean') setBlueActive(s.blueActive);
    setRingsRed(s.ringsRed);
    setRingsBlue(s.ringsBlue);
    // seed eliminado: no recuperar
  };
  const undo = () => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [takeSnapshot(), ...f]);
      applySnapshot(prev);
      return p.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, takeSnapshot()]);
      applySnapshot(next);
      return f.slice(1);
    });
  };

  // Persistencia ligera (cargar/guardar)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("puntos_app_state_min");
      if (raw) {
        const s = JSON.parse(raw);
        s.vertices && setVertices(s.vertices);
        typeof s.alturaZ === "number" && setAlturaZ(s.alturaZ);
        s.F1 && setF1(s.F1);
        s.F2 && setF2(s.F2);
        typeof s.activeF1 === "boolean" && setActiveF1(s.activeF1);
        typeof s.activeF2 === "boolean" && setActiveF2(s.activeF2);
        s.blue && setBlue(s.blue);
        s.ringsRed && setRingsRed(s.ringsRed);
        s.ringsBlue && setRingsBlue(s.ringsBlue);
        // seed eliminado: no cargar
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "puntos_app_state_min",
        JSON.stringify({ vertices, alturaZ, F1, F2, activeF1, activeF2, blue, blueActive, ringsRed, ringsBlue })
      );
    } catch {}
  }, [vertices, alturaZ, F1, F2, activeF1, activeF2, blue, blueActive, ringsRed, ringsBlue]);

  // Escala y helpers de dibujo
  const width = 700,
    height = 520,
    pad = 50;
  // Layout: asegurar alineación entre columnas
  const tableW = 420; // ancho de tablas (distancias y puntos)
  const panelHPad = 24; // p-3 izquierda + derecha = 24px
  const rightColW = tableW + panelHPad; // ancho total del panel derecho
  const leftColW = width + panelHPad; // ancho total del panel del gráfico
  const bounds = useMemo(() => {
    const xs = vertices.map((v) => v.x),
      ys = vertices.map((v) => v.y);
    return {
      minX: Math.min(0, ...xs),
      maxX: Math.max(...xs),
      minY: Math.min(0, ...ys),
      maxY: Math.max(...ys),
    };
  }, [vertices]);
  const scale = useMemo(() => {
    const wu = Math.max(1e-3, bounds.maxX - bounds.minX),
      hu = Math.max(1e-3, bounds.maxY - bounds.minY);
    return Math.min((width - 2 * pad) / wu, (height - 2 * pad) / hu);
  }, [bounds]);
  const toSvg = (p) => ({ x: pad + (p.x - bounds.minX) * scale, y: height - pad - (p.y - bounds.minY) * scale });
  // Inversa: de coords SVG a unidades del recinto; permite congelar bounds/scale durante drag
  const fromSvg = (sx, sy, frozenBounds = bounds, frozenScale = scale) => ({
    x: frozenBounds.minX + (sx - pad) / frozenScale,
    y: frozenBounds.minY + (height - pad - sy) / frozenScale,
  });

  // Celdas XY válidas y niveles Z válidos
  const xyCells = useMemo(() => {
    const xs = [],
      ys = [];
    const bx = { min: Math.min(...vertices.map((v) => v.x)), max: Math.max(...vertices.map((v) => v.x)) };
    const by = { min: Math.min(...vertices.map((v) => v.y)), max: Math.max(...vertices.map((v) => v.y)) };
    for (let x = Math.ceil((bx.min + MARGIN) * 10) / 10; x <= bx.max - MARGIN + EPS; x += STEP) xs.push(round01(x));
    for (let y = Math.ceil((by.min + MARGIN) * 10) / 10; y <= by.max - MARGIN + EPS; y += STEP) ys.push(round01(y));
    const out = [];
    for (const x of xs)
      for (const y of ys) {
        const p = { x, y };
        if (!pointInPolygon(p, vertices)) continue;
        if (minDistToEdges2D(p, vertices) < MARGIN - EPS) continue;
        out.push(p);
      }
    return out;
  }, [vertices]);
  const zLevels = useMemo(() => {
    const v = [];
    for (let z = Math.ceil(MARGIN * 10) / 10; z <= alturaZ - MARGIN + EPS; z += STEP) v.push(round01(z));
    return v;
  }, [alturaZ]);
  const candidates = useMemo(() => {
    const out = [];
    for (const p of xyCells) for (const z of zLevels) out.push({ x: p.x, y: p.y, z });
    return out;
  }, [xyCells, zLevels]);

  // Índices precomputados para el generador (optimización clave)
  const byZ = useMemo(() => {
    const m = new Map();
    for (const c of candidates) {
      const k = key01(c.z);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return m;
  }, [candidates]);
  const zLevelsAll = useMemo(() => {
    return Array.from(new Set(candidates.map((c) => c.z))).sort((a, b) => a - b);
  }, [candidates]);

  // Validación y avisos
  const [viol, setViol] = useState({ F1: { x: false, y: false, z: false, msg: [] }, F2: { x: false, y: false, z: false, msg: [] }, blue: [] });

  const validate = useCallback(() => {
    const v = { F1: { x: false, y: false, z: false, msg: [] }, F2: { x: false, y: false, z: false, msg: [] }, blue: blue.map(() => ({ x: false, y: false, z: false, msg: [] })) };
    
    // Construir lista de puntos para validación
    const allPoints = [
      ...(activeF1 ? [{ name: "F1", p: F1 }] : []),
      ...(activeF2 ? [{ name: "F2", p: F2 }] : []),
      ...blue.map((b, i) => ({ name: `P${i + 1}`, p: b })),
    ];
    
    // Validar duplicidades de coordenadas
    ["x", "y", "z"].forEach((axis) => {
      const map = new Map();
      const add = (who, i, val) => {
        const k = key01(val);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ who, i });
      };
      // X/Y: incluyen F1/F2; Z: solo Pxs (Fx permitida con Px)
      if (axis !== "z") {
        if (activeF1) add("F1", -1, F1[axis]);
        if (activeF2) add("F2", -1, F2[axis]);
      }
      blue.forEach((b, i) => add("B", i, b[axis]));
      
      for (const [, list] of map) {
        if (list.length > 1) {
          list.forEach((e) => {
            if (e.who === "F1") {
              v.F1[axis] = true;
              v.F1.msg.push(`${axis.toUpperCase()} repetida`);
            } else if (e.who === "F2") {
              v.F2[axis] = true;
              v.F2.msg.push(`${axis.toUpperCase()} repetida`);
            } else {
              v.blue[e.i][axis] = true;
              v.blue[e.i].msg.push(`${axis.toUpperCase()} repetida`);
            }
          });
        }
      }
    });

    // Validar polígono y márgenes
    if (activeF1) {
      const msgs = checkPolygonAndMargins(F1, vertices, alturaZ);
      if (msgs.length > 0) {
        v.F1.x = v.F1.y = msgs.some(m => m.includes("polígono") || m.includes("borde"));
        v.F1.z = msgs.some(m => m.includes("Z"));
        v.F1.msg.push(...msgs);
      }
    }
    if (activeF2) {
      const msgs = checkPolygonAndMargins(F2, vertices, alturaZ);
      if (msgs.length > 0) {
        v.F2.x = v.F2.y = msgs.some(m => m.includes("polígono") || m.includes("borde"));
        v.F2.z = msgs.some(m => m.includes("Z"));
        v.F2.msg.push(...msgs);
      }
    }
    blue.forEach((b, i) => {
      const msgs = checkPolygonAndMargins(b, vertices, alturaZ);
      if (msgs.length > 0) {
        v.blue[i].x = v.blue[i].y = msgs.some(m => m.includes("polígono") || m.includes("borde"));
        v.blue[i].z = msgs.some(m => m.includes("Z"));
        v.blue[i].msg.push(...msgs);
      }
    });

    // Validar distancias F1-F2
    if (activeF1 && activeF2) {
      const f1f2 = checkF1F2Distances(F1, F2);
      if (f1f2.violations.x) {
        v.F1.x = v.F2.x = true;
      }
      if (f1f2.violations.y) {
        v.F1.y = v.F2.y = true;
      }
      if (f1f2.violations.z) {
        v.F1.z = v.F2.z = true;
      }
      v.F1.msg.push(...f1f2.messages);
      v.F2.msg.push(...f1f2.messages);
    }

    // Validar distancias 3D azules contra fuentes activas y entre sí
    blue.forEach((b, i) => {
      if (activeF1 && dist3D(b, F1) < MIN_RED_BLUE) {
        v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
        v.blue[i].msg.push(`Distancia a F1 < 1.0 (=${dist3D(b, F1).toFixed(1)} m)`);
      }
      if (activeF2 && dist3D(b, F2) < MIN_RED_BLUE) {
        v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
        v.blue[i].msg.push(`Distancia a F2 < 1.0 (=${dist3D(b, F2).toFixed(1)} m)`);
      }
    });
    for (let i = 0; i < blue.length; i++) {
      for (let j = i + 1; j < blue.length; j++) {
        const d = dist3D(blue[i], blue[j]);
        if (d < MIN_BLUE_BLUE) {
          v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
          v.blue[j].x = v.blue[j].y = v.blue[j].z = true;
          v.blue[i].msg.push(`P${i + 1}–P${j + 1} < 0.7 (=${d.toFixed(1)} m)`);
          v.blue[j].msg.push(`P${i + 1}–P${j + 1} < 0.7 (=${d.toFixed(1)} m)`);
        }
      }
    }

    v.F1.msg = Array.from(new Set(v.F1.msg));
    v.F2.msg = Array.from(new Set(v.F2.msg));
    v.blue.forEach((b) => (b.msg = Array.from(new Set(b.msg))));
    setViol(v);
  }, [F1, F2, blue, vertices, alturaZ, activeF1, activeF2]);
  useEffect(() => {
    const t = setTimeout(validate, 60);
    return () => clearTimeout(t);
  }, [validate]);

  // Helper: resumen de violaciones para un conjunto de puntos (mensaje de imposibilidad)
  const buildViolationSummary = (pts) => {
    const out = [];
    
    // Construir lista de puntos con nombres
    const pointsWithNames = pts.map((p, i) => ({ name: `P${i + 1}`, p }));
    const allPoints = [
      ...(activeF1 ? [{ name: "F1", p: F1 }] : []),
      ...(activeF2 ? [{ name: "F2", p: F2 }] : []),
      ...pointsWithNames,
    ];
    
    // Validar márgenes y polígono
    pointsWithNames.forEach(({ name, p }) => {
      const msgs = checkPolygonAndMargins(p, vertices, alturaZ);
      if (msgs.length > 0) {
        if (msgs.some(m => m.includes("polígono") || m.includes("borde"))) {
          out.push(`${name} fuera del polígono o a < 0.5 m del borde`);
        }
        if (msgs.some(m => m.includes("Z"))) {
          out.push(`${name} con Z fuera de márgenes`);
        }
      }
    });
    
    // Validar duplicidades por ejes (X/Y entre todos; Z solo entre Pxs)
    const dupMsgs = checkCoordinateDuplicates(allPoints, { includeFx: true });
    out.push(...dupMsgs);
    
    // Validar distancias P-P
    const distCheck = checkAllDistances(pointsWithNames, { activeF1, activeF2, F1, F2 });
    out.push(...distCheck.msgs);
    
    // Validar distancias P-F (no incluidas en checkAllDistances cuando solo hay Pxs)
    pointsWithNames.forEach(({ name, p }) => {
      if (activeF1) {
        const d = dist3D(p, F1);
        if (d < MIN_RED_BLUE) out.push(`${name} a F1 = ${d.toFixed(1)} < 1.0 m`);
      }
      if (activeF2) {
        const d = dist3D(p, F2);
        if (d < MIN_RED_BLUE) out.push(`${name} a F2 = ${d.toFixed(1)} < 1.0 m`);
      }
    });
    
    return Array.from(new Set(out));
  };

  // Generación
  const generate = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setErr(false);
    setMsg("Generando puntos...");
    // grabar estado previo para poder deshacer la generación
    setPast((p) => [...p, JSON.parse(JSON.stringify({ vertices, alturaZ, F1, F2, activeF1, activeF2, blue, ringsRed, ringsBlue }))]);
    setFuture([]);

    setTimeout(() => {
      try {
        const res = generateBluePoints({
          F1,
          F2,
          candidates,
          genNonce: nonce,
          f1Active: activeF1,
          f2Active: activeF2,
          byZ,
          zLevelsAll,
        });
        setBlue(res.points);
        setBlueActive(true);

        const issues = buildViolationSummary(res.points);
        if (res.feasible && issues.length === 0) {
          setErr(false);
          setMsg(`✓ Generados ${res.points.length} puntos válidos.`);
        } else if (res.feasible) {
          setErr(false);
          setMsg(`✓ Generados ${res.points.length} puntos. Revisa posibles avisos:\n• ${issues.slice(0, 6).join("\n• ")}`);
        } else {
          setErr(true);
          setMsg(`⚠️ No es posible cumplir todas las reglas con esta geometría. Se muestran 5 puntos maximizando separación.\n• ${issues.slice(0, 8).join("\n• ")}`);
        }
        setNonce((n) => n + 1);
      } catch (e) {
        console.error(e);
        setErr(true);
        setMsg("Error al generar puntos.");
      } finally {
        setBusy(false);
      }
    }, 20);
  }, [busy, candidates, nonce, F1, F2, activeF1, activeF2, byZ, zLevelsAll]);

  // Dibujo: rejilla + ejes + polígono + puntos
  const GridAxes = useMemo(() => {
    const axisColor = "#bfbfbf";
    const els = []; // rejilla menor 0,1 y mayor 0,5
    for (let x = Math.ceil(bounds.minX / STEP) * STEP; x <= bounds.maxX + EPS; x += STEP) {
      const sx = pad + (x - bounds.minX) * scale;
      els.push(<line key={"gx" + x} x1={sx} y1={pad} x2={sx} y2={height - pad} stroke="#e5e7eb" />);
    }
    for (let y = Math.ceil(bounds.minY / STEP) * STEP; y <= bounds.maxY + EPS; y += STEP) {
      const sy = height - pad - (y - bounds.minY) * scale;
      els.push(<line key={"gy" + y} x1={pad} y1={sy} x2={width - pad} y2={sy} stroke="#e5e7eb" />);
    }
    for (let x = Math.ceil(bounds.minX / 0.5) * 0.5; x <= bounds.maxX + EPS; x += 0.5) {
      const sx = pad + (x - bounds.minX) * scale;
      els.push(<line key={"GX" + x} x1={sx} y1={pad} x2={sx} y2={height - pad} stroke="#c7cdd6" />);
      els.push(
        <text key={"TX" + x} x={sx} y={height - pad + 14} fontSize={12} textAnchor="middle" fill="#666">{x.toFixed(1)}</text>
      );
    }
    for (let y = Math.ceil(bounds.minY / 0.5) * 0.5; y <= bounds.maxY + EPS; y += 0.5) {
      const sy = height - pad - (y - bounds.minY) * scale;
      els.push(<line key={"GY" + y} x1={pad} y1={sy} x2={width - pad} y2={sy} stroke="#c7cdd6" />);
      els.push(
        <text key={"TY" + y} x={pad - 8} y={sy + 3} fontSize={12} textAnchor="end" fill="#666">{y.toFixed(1)}</text>
      );
    }
    const O = { x: pad + (0 - bounds.minX) * scale, y: height - pad - (0 - bounds.minY) * scale };
    els.push(<line key="ax" x1={pad} y1={O.y} x2={width - pad} y2={O.y} stroke={axisColor} />);
    els.push(<line key="ay" x1={O.x} y1={height - pad} x2={O.x} y2={pad} stroke={axisColor} />);
    return <g>{els}</g>;
  }, [bounds, scale]);

  const area = useMemo(() => polygonArea(vertices), [vertices]);
  const volumen = useMemo(() => area * alturaZ, [area, alturaZ]);

  // ===== Drag & Drop (puntos y vértices) =====
  const svgRef = useRef(null);
  const dragRef = useRef(null); // { kind: 'V'|'F1'|'F2'|'P', index?: number, bounds, scale, pointerId }

  const beginDrag = (e, payload) => {
    try {
      // snapshot para undo/redo al iniciar el drag
      setPast((p) => [...p, takeSnapshot()]);
      setFuture([]);
    } catch {}
    dragRef.current = {
      ...payload,
      bounds: { ...bounds },
      scale,
      pointerId: e.pointerId,
    };
    // Evitar gestos táctiles por defecto
    e.preventDefault();
    e.stopPropagation();
    // Captura opcional en el SVG
    try { svgRef.current && svgRef.current.setPointerCapture && svgRef.current.setPointerCapture(e.pointerId); } catch {}
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    e.preventDefault();
    // Obtener coords SVG
    const rect = svgRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = fromSvg(sx, sy, drag.bounds, drag.scale);
    const nx = round01(w.x);
    const ny = round01(w.y);

    if (drag.kind === 'V') {
      const idx = drag.index;
      setVertices((V) => {
        const curr = V[idx];
        if (!curr || (curr.x === nx && curr.y === ny)) return V;
        const next = V.map((p, k) => (k === idx ? { ...p, x: nx, y: ny } : p));
        return next;
      });
      return;
    }
    if (drag.kind === 'F1') {
      setF1((p) => (p.x === nx && p.y === ny ? p : { ...p, x: nx, y: ny }));
      return;
    }
    if (drag.kind === 'F2') {
      setF2((p) => (p.x === nx && p.y === ny ? p : { ...p, x: nx, y: ny }));
      return;
    }
    if (drag.kind === 'P') {
      const idx = drag.index;
      setBlue((B) => {
        const curr = B[idx];
        if (!curr || (curr.x === nx && curr.y === ny)) return B;
        return B.map((p, k) => (k === idx ? { ...p, x: nx, y: ny } : p));
      });
      return;
    }
  };

  const endDrag = (e) => {
    if (!dragRef.current) return;
    try { svgRef.current && svgRef.current.releasePointerCapture && svgRef.current.releasePointerCapture(dragRef.current.pointerId); } catch {}
    dragRef.current = null;
  };

  // ===== Distancias (matriz 3D) =====
  const pointList = useMemo(() => {
    const arr = [];
    if (activeF1) arr.push({ name: "F1", p: F1, color: "#e11d48" });
    if (activeF2) arr.push({ name: "F2", p: F2, color: "#e11d48" });
    blue.forEach((b, i) => arr.push({ name: `P${i + 1}`, p: b, color: "#2563eb" }));
    return arr;
  }, [F1, F2, blue, activeF1, activeF2]);
  // Lista para la tabla: incluye placeholders de P1..P5 aunque no existan (p = null)
  const pointListTable = useMemo(() => {
    const arr = [];
    // Siempre incluir F1/F2; si están inactivas, p=null para mostrar "--"
    arr.push({ name: "F1", p: activeF1 ? F1 : null, color: "#e11d48" });
    arr.push({ name: "F2", p: activeF2 ? F2 : null, color: "#e11d48" });
    const maxP = 5;
    for (let i = 0; i < maxP; i++) {
      const b = blue[i] || null;
      arr.push({ name: `P${i + 1}`, p: blueActive && b ? b : null, color: "#2563eb" });
    }
    return arr;
  }, [F1, F2, blue, blueActive, activeF1, activeF2]);

  const distMatrix = useMemo(() => {
    const n = pointListTable.length;
    const M = Array.from({ length: n }, () => Array(n).fill("--"));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const Ai = pointListTable[i];
        const Bj = pointListTable[j];
        if (Ai.p && Bj.p) {
          const d = i === j ? 0 : dist3D(Ai.p, Bj.p);
          const s = d.toFixed(1);
          M[i][j] = s;
          M[j][i] = s;
        } else {
          // al menos uno sin datos => "--"
          M[i][j] = "--";
          M[j][i] = "--";
        }
      }
    }
    return M;
  }, [pointListTable]);

  const minPair = useMemo(() => {
    let best = { a: null, b: null, d: Infinity };
    for (let i = 0; i < pointListTable.length; i++) {
      for (let j = i + 1; j < pointListTable.length; j++) {
        const Ai = pointListTable[i];
        const Bj = pointListTable[j];
        if (!Ai.p || !Bj.p) continue;
        const d = dist3D(Ai.p, Bj.p);
        if (d < best.d) best = { a: Ai.name, b: Bj.name, d };
      }
    }
    return best.d < Infinity ? best : null;
  }, [pointListTable]);

  // Pares en violación de distancias + mensajes para avisos
  const distViol = useMemo(() => {
    const pairs = new Set();
    const msgs = [];
    const N = pointListTable.length;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const A = pointListTable[i], B = pointListTable[j];
        if (!A.p || !B.p) continue; // sin datos => sin chequeo ni mensaje
        const nameA = A.name, nameB = B.name;
        const isFA = nameA.startsWith("F");
        const isFB = nameB.startsWith("F");
        const isPA = nameA.startsWith("P");
        const isPB = nameB.startsWith("P");

        if (isFA && isFB) {
          const dx = Math.abs(A.p.x - B.p.x);
          const dy = Math.abs(A.p.y - B.p.y);
          const dz = Math.abs(A.p.z - B.p.z);
          const parts = [];
          if (dx < MIN_F_F_AXIS) parts.push(`|X|=${dx.toFixed(1)}`);
          if (dy < MIN_F_F_AXIS) parts.push(`|Y|=${dy.toFixed(1)}`);
          if (dz < MIN_F_F_AXIS) parts.push(`|Z|=${dz.toFixed(1)}`);
          if (parts.length) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB}: ${parts.join(", ")} < 0.7 m`);
          }
        } else if ((isFA && isPB) || (isFB && isPA)) {
          const d = dist3D(A.p, B.p);
          if (d < MIN_RED_BLUE) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB} = ${d.toFixed(1)} < 1.0 m (3D)`);
          }
        } else if (isPA && isPB) {
          const d = dist3D(A.p, B.p);
          if (d < MIN_BLUE_BLUE) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB} = ${d.toFixed(1)} < 0.7 m (3D)`);
          }
        }
      }
    }
    return { pairs, msgs };
  }, [pointListTable]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-14 font-semibold text-gray-900">Distribución de Puntos Acústicos - UNE EN ISO 16283-1-2015 - Medidas de aislamiento a ruido aéreo</h1>

      <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: `${leftColW}px ${rightColW}px` }}>
        {/* Columna izquierda (fila superior): Datos + Círculos, igual ancho que el gráfico */}
        <div className="flex gap-4 h-full" style={{ width: leftColW }}>
        {/* Datos del recinto */}
        <section className="p-2 rounded-xl shadow bg-white border text-sm self-start flex-1 h-full">
          <h2 className="text-13 font-medium mb-2">Datos del recinto</h2>
          {vertices.map((v, i) => (
            <div key={i} className="flex items-center gap-2 mb-1 text-xs">
              <span className="w-5 text-gray-500">{idxToLetter(i)}</span>
              <label>X:</label>
              <NumInput
                value={v.x}
                onCommit={(val) => {
                  setPast((p) => [...p, takeSnapshot()]);
                  setFuture([]);
                  setVertices((V) => V.map((p, k) => (k === i ? { ...p, x: val } : p)));
                }}
                className="w-20 border rounded px-1"
              />
              <label>Y:</label>
              <NumInput
                value={v.y}
                onCommit={(val) => {
                  setPast((p) => [...p, takeSnapshot()]);
                  setFuture([]);
                  setVertices((V) => V.map((p, k) => (k === i ? { ...p, y: val } : p)));
                }}
                className="w-20 border rounded px-1"
              />
              <button
                onClick={() => {
                  setPast((p) => [...p, takeSnapshot()]);
                  setFuture([]);
                  setVertices((vs) => vs.filter((_, k) => k !== i));
                }}
                disabled={vertices.length <= 4}
                className="ml-1 px-2 py-0.5 border rounded hover:bg-red-50 text-red-600 disabled:opacity-50"
                title={vertices.length <= 4 ? "Debe haber al menos 4 vértices" : "Eliminar vértice"}
              >
                –
              </button>
            </div>
          ))}
          <div className="flex flex-col gap-2 mt-2 text-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPast((p) => [...p, takeSnapshot()]);
                  setFuture([]);
                  setVertices((v) => [...v, { x: 0, y: 0 }]);
                }}
                disabled={vertices.length >= 14}
                title={vertices.length >= 14 ? "Máximo 14 vértices" : "+ vértice"}
                className={`px-2 py-0.5 border rounded text-xs ${vertices.length >= 14 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
              >
                + vértice
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label>Altura Z:</label>
              <NumInput
                value={alturaZ}
                onCommit={(val) => {
                  setPast((p) => [...p, takeSnapshot()]);
                  setFuture([]);
                  setAlturaZ(val);
                }}
                className="w-24 border rounded px-1"
              />
            </div>
            <div className="text-12 text-black">Área: {area.toFixed(1)} m²</div>
            <div className="text-12 text-black">Volumen: {volumen.toFixed(1)} m³</div>
          </div>
        </section>

        {/* Círculos de distancia */}
        <section className="p-2 rounded-xl shadow bg-white border text-sm self-start flex-1 h-full">
          <h2 className="text-13 font-medium mb-2">Círculos de distancia</h2>
          <table className="text-12 border w-full">
            <thead>
              <tr>
                <th className="px-2 text-center">r</th>
                <th className="px-2 text-center">Fuentes</th>
                <th className="px-2 text-center">Puntos de medida</th>
              </tr>
            </thead>
            <tbody>
              {radii.map((r) => (
                <tr key={r}>
                  <td className="px-2 py-1 text-center">{r.toFixed(1)} m</td>
                  <td className="px-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!ringsRed[r]}
                      onChange={() => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        setRingsRed((s) => ({ ...s, [r]: !s[r] }));
                      }}
                    />
                  </td>
                  <td className="px-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!ringsBlue[r]}
                      onChange={() => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        setRingsBlue((s) => ({ ...s, [r]: !s[r] }));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Opción de semilla eliminada */}
        </section>
        </div>

        {/* Columna derecha (fila superior): Tabla de distancias, mismo ancho que tabla puntos */}
        <section className="p-3 rounded-xl shadow bg-white border text-sm self-start" style={{ width: rightColW }}>
          <h2 className="text-13 font-medium mb-2">Tabla de distancias (3D)</h2>
          <div>
            <div className="text-12 text-gray-600 mb-2">
              Distancia en línea recta entre todos los puntos activos. {minPair ? (
                <span>
                  Mínima actual: <b>{minPair.a}</b>–<b>{minPair.b}</b> = {minPair.d.toFixed(1)} m
                </span>
              ) : null}
            </div>
            <div className="overflow-x-hidden overflow-y-auto max-h-64">
              <table className="text-12 border table-fixed" style={{ width: tableW }}>
                <thead>
                  <tr>
                    <th className="px-1 py-1 h-7 whitespace-nowrap">•</th>
                    {pointListTable.map((pt) => (
                      <th
                        key={pt.name}
                        className={`px-1 py-1 text-right h-7 whitespace-nowrap ${!pt.p ? 'text-gray-400' : ''}`}
                        style={{ color: pt.p ? pt.color : undefined }}
                      >
                        {pt.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pointListTable.map((row, i) => (
                    <tr key={row.name}>
                      <td className="px-1 py-1 font-medium h-7 whitespace-nowrap" style={{ color: row.p ? row.color : undefined, opacity: row.p ? 1 : 0.6 }}>{row.name}</td>
                      {pointListTable.map((col, j) => {
                        const dStr = distMatrix[i][j];
                        const hasData = !!(row.p && col.p);
                        const dVal = parseFloat(dStr);
                        const isDiag = i === j;
                        const diagWithData = isDiag && hasData;
                        const isMinPair =
                          !!minPair &&
                          ((row.name === minPair.a && col.name === minPair.b) ||
                            (row.name === minPair.b && col.name === minPair.a));
                        const pairKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
                        const isViol = !isDiag && hasData && distViol?.pairs?.has(pairKey);
                        const underTwo = !isDiag && hasData && Number.isFinite(dVal) && dVal < 2;

                        // Prioridad de estilos: <2m (rojo suave) tiene prioridad sobre el resto
                        // luego mínimo actual (amarillo) y violación (rose). Diagonal sin fondo.
                        const bgClass = diagWithData
                          ? ""
                          : underTwo
                          ? "bg-red-50"
                          : isMinPair
                          ? "bg-yellow-50"
                          : isViol
                          ? "bg-rose-50"
                          : "";
                        const textClass = diagWithData
                          ? "text-gray-400"
                          : isViol
                          ? "text-rose-700 font-semibold"
                          : "";

                        return (
                          <td key={col.name} className={`px-1 py-1 text-right h-7 whitespace-nowrap ${textClass} ${bgClass}`}>
                            {dStr}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>

      {/* Dibujo + tabla */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: `${leftColW}px ${rightColW}px` }}>
        <div className="p-3 rounded-xl shadow bg-white border" style={{ width: leftColW }}>
          <svg
            ref={svgRef}
            width={width}
            height={height}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            style={{ touchAction: 'none' }}
          >
            {/* Relleno del recinto debajo de la rejilla */}
            <polygon
              points={vertices.map((v) => { const s = toSvg(v); return `${s.x},${s.y}`; }).join(" ")}
              fill="#eef6ff"
              stroke="none"
            />
            {/* Rejilla por encima del relleno para que se vea dentro del recinto */}
            {GridAxes}
            {/* Contorno del recinto por encima de la rejilla */}
            <polygon
              points={vertices.map((v) => { const s = toSvg(v); return `${s.x},${s.y}`; }).join(" ")}
              fill="none"
              stroke="#93c5fd"
              strokeWidth={2}
            />

            {/* Vértices etiquetados A, B, C, ... */}
            {vertices.map((v, i) => {
              const s = toSvg(v);
              const label = idxToLetter(i);
              return (
                <g key={`V-${i}`}>
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={5}
                    fill="#111"
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => beginDrag(e, { kind: 'V', index: i })}
                  />
                  <text x={s.x + 6} y={s.y - 6} fontSize={12} fill="#111">{label}</text>
                </g>
              );
            })}

            {(() => {
              const draw = (p, label, color, rings, active, dragPayload) => {
                const s = toSvg(p);
                const groupOpacity = active ? 1 : 0.35; // atenuado cuando la fuente está desactivada
                return (
                  <g key={label} opacity={groupOpacity} style={{ cursor: 'grab' }} onPointerDown={(e) => beginDrag(e, dragPayload)}>
                    {Object.entries(rings)
                      .filter(([, on]) => on)
                      .map(([rr]) => (
                        <circle key={rr} cx={s.x} cy={s.y} r={parseFloat(rr) * scale} fill="none" stroke={color} opacity={0.35} />
                      ))}
                    <circle cx={s.x} cy={s.y} r={5} fill={color} />
                    <text x={s.x + 6} y={s.y - 6} fontSize={12} fill={color}>{label}</text>
                  </g>
                );
              };

              return [
                draw(F1, `F1 (${F1.x.toFixed(1)}, ${F1.y.toFixed(1)}, ${F1.z.toFixed(1)})`, "#e11d48", ringsRed, activeF1, { kind: 'F1' }),
                draw(F2, `F2 (${F2.x.toFixed(1)}, ${F2.y.toFixed(1)}, ${F2.z.toFixed(1)})`, "#e11d48", ringsRed, activeF2, { kind: 'F2' }),
                ...(blueActive ? blue.map((b, i) => draw(b, `P${i + 1} (${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)})`, "#2563eb", ringsBlue, true, { kind: 'P', index: i })) : []),
              ];
            })()}
          </svg>
        </div>

        <div className="flex flex-col gap-4">
          <section className="p-3 rounded-xl shadow bg-white border text-sm" style={{ width: rightColW }}>
          <h2 className="text-13 font-medium mb-2">Tabla de puntos</h2>

          <table className="text-12 border table-fixed" style={{ width: tableW }}>
            <thead>
              <tr>
                <th className="px-2 h-7 w-16 text-center">Activa</th>
                <th className="px-2 h-7 w-20 text-left">Punto</th>
                <th className="px-2 h-7 w-16 text-center">X</th>
                <th className="px-2 h-7 w-16 text-center">Y</th>
                <th className="px-2 h-7 w-16 text-center">Z</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "F1", val: F1, v: viol.F1, active: activeF1, setActive: setActiveF1 },
                { name: "F2", val: F2, v: viol.F2, active: activeF2, setActive: setActiveF2 },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="px-2 text-center h-7">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(e) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        row.setActive(e.target.checked);
                      }}
                    />
                  </td>
                  <td className="px-2 font-medium h-7 text-left">{row.name}</td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={row.val.x}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        (row.name === "F1" ? setF1 : setF2)((p) => ({ ...p, x: val }));
                      }}
                      className={`w-16 border rounded px-1 ${row.v.x ? "border-red-500 bg-red-50" : ""}`}
                      title={row.v.msg.join("\n")}
                    />
                  </td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={row.val.y}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        (row.name === "F1" ? setF1 : setF2)((p) => ({ ...p, y: val }));
                      }}
                      className={`w-16 border rounded px-1 ${row.v.y ? "border-red-500 bg-red-50" : ""}`}
                      title={row.v.msg.join("\n")}
                    />
                  </td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={row.val.z}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        (row.name === "F1" ? setF1 : setF2)((p) => ({ ...p, z: val }));
                      }}
                      className={`w-16 border rounded px-1 ${row.v.z ? "border-red-500 bg-red-50" : ""}`}
                      title={row.v.msg.join("\n")}
                    />
                  </td>
                </tr>
              ))}
              {blue.map((b, i) => (
                <tr key={i} className={!blueActive ? 'opacity-60' : ''}>
                  <td className="px-2 text-center h-7">—</td>
                  <td className="px-2 h-7">{`P${i + 1}`}</td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={b.x}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        setBlue((B) => B.map((p, k) => (k === i ? { ...p, x: val } : p)));
                      }}
                      disabled={!blueActive}
                      className={`w-16 border rounded px-1 ${!blueActive ? 'bg-gray-50' : ''} ${viol.blue[i]?.x ? "border-red-500 bg-red-50" : ""}`}
                      title={(viol.blue[i]?.msg || []).join("\n")}
                    />
                  </td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={b.y}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        setBlue((B) => B.map((p, k) => (k === i ? { ...p, y: val } : p)));
                      }}
                      disabled={!blueActive}
                      className={`w-16 border rounded px-1 ${!blueActive ? 'bg-gray-50' : ''} ${viol.blue[i]?.y ? "border-red-500 bg-red-50" : ""}`}
                      title={(viol.blue[i]?.msg || []).join("\n")}
                    />
                  </td>
                  <td className="px-2 h-7 text-center">
                    <NumInput
                      value={b.z}
                      onCommit={(val) => {
                        setPast((p) => [...p, takeSnapshot()]);
                        setFuture([]);
                        setBlue((B) => B.map((p, k) => (k === i ? { ...p, z: val } : p)));
                      }}
                      disabled={!blueActive}
                      className={`w-16 border rounded px-1 ${!blueActive ? 'bg-gray-50' : ''} ${viol.blue[i]?.z ? "border-red-500 bg-red-50" : ""}`}
                      title={(viol.blue[i]?.msg || []).join("\n")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex gap-2 items-center flex-wrap">
            <button
              className="px-3 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
              onClick={undo}
              disabled={past.length === 0}
              title="Deshacer (Atrás)"
              aria-label="Deshacer"
            >
              ↺
            </button>
            <button
              className="px-3 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
              onClick={redo}
              disabled={future.length === 0}
              title="Rehacer (Adelante)"
              aria-label="Rehacer"
            >
              ↻
            </button>

            <button className={`px-4 py-2 rounded-lg text-white bg-blue-600 ${busy ? "opacity-60" : "hover:bg-blue-700"}`} onClick={generate} disabled={busy}>
              {busy ? "Generando…" : "Generar puntos"}
            </button>
            <button
              className="px-3 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
              onClick={() => {
                setPast((p) => [...p, takeSnapshot()]);
                setFuture([]);
                setBlueActive(false);
                setMsg("");
                setErr(false);
              }}
              disabled={busy}
            >
              Limpiar
            </button>
          </div>          {/* Avisos de incoherencia (siempre en rojo) */}
          {(() => {
            const pts = [
              ...(activeF1 ? [{ name: "F1", p: F1 }] : []),
              ...(activeF2 ? [{ name: "F2", p: F2 }] : []),
              ...(blueActive ? blue.map((b, i) => ({ name: `P${i + 1}`, p: b })) : []),
            ];

            // Validar duplicidades (Z solo entre Pxs)
            const dupMsgs = checkCoordinateDuplicates(pts, { includeFx: false });
            
            // Añadir avisos por distancias (F–F por ejes; F–P 3D <1.0; P–P 3D <0.7)
            const list = [...dupMsgs, ...distViol.msgs];
            const uniq = Array.from(new Set(list));
            
            return uniq.length ? (
              <div className="mt-2 p-2 border border-red-300 rounded bg-red-50 text-red-700 text-xs">
                <div className="font-medium mb-1">Avisos de incoherencia:</div>
                <ul className="list-disc pl-4 space-y-0.5">{uniq.map((m, i) => (<li key={i}>{m}</li>))}</ul>
              </div>
            ) : null;
          })()}

          <div className="mt-3 text-12 text-black">
            <div className="font-medium mb-1">Reglas:</div>
            <div className="mb-1"><span className="font-medium">❖ Coordenadas:</span> No puede repetirse</div>
            <ul className="list-none pl-4 space-y-0.5">
              <li>➤ Coordenada X e Y entre ningún punto (incluye F1 y F2 activas).</li>
              <li>➤ Coordenada Z entre Px</li>
              <li>➤ Coordenada Z entre Fx (Z puede repetirse entre Fx – Px)</li>
            </ul>
            <div className="mt-2 mb-1"><span className="font-medium">❖ Distancias mínimas:</span></div>
            <ul className="list-none pl-4 space-y-0.5">
              <li>➤ Todos (Fuente y Punto) ≥ 0.5 m a todas las caras (incluye Z).</li>
              <li>➤ Fuente – Fuente ≥ 0.7 m en todos los ejes.</li>
              <li>➤ Fuente – Punto ≥ 1.0 m (3D).</li>
              <li>➤ Punto – Punto ≥ 0.7 m (3D).</li>
            </ul>
          </div>
          </section>
        </div>
      </div>
    </div>
  );
}
