import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// Input numérico tolerante (spinner = inmediato; tecleo = al salir/Enter)
function NumInput({ value, onCommit, className, title }) {
  const [txt, setTxt] = useState("");
  const [focus, setFocus] = useState(false);
  const [typing, setTyping] = useState(false); // true cuando el usuario está tecleando

  useEffect(() => {
    if (!focus) {
      setTxt("");
      setTyping(false);
    }
  }, [value, focus]);

  const display = focus ? txt : String(value);
  const re = /^-?\d*(?:[.,]\d*)?$/; // vacío, dígitos y separador . o ,

  return (
    <input
      type="number"
      step={0.1}
      lang="en" // asegura que el "." del teclado numérico funcione
      inputMode="decimal"
      value={display}
      title={title}
      onFocus={() => {
        setFocus(true);
        setTxt(Number(value).toFixed(1));
        setTyping(false);
      }}
      onChange={(e) => {
        const el = e.target;
        const s = el.value;
        if (s === "" || re.test(s)) {
          setTxt(s);
          // Si NO estamos tecleando (spinner/rueda), confirmamos al instante
          if (!typing) {
            const n = round01(parseNum(s === "" ? String(value) : s, value));
            setTxt(n.toFixed(1));
            onCommit(n);
          }
        }
      }}
      onBlur={() => {
        setFocus(false);
        const n = round01(parseNum(display === "" ? String(value) : display, value));
        onCommit(n);
        setTyping(false);
      }}
      onKeyDown={(e) => {
        // Flechas / PageUp-PageDown => commit inmediato
        if (
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "PageUp" ||
          e.key === "PageDown"
        ) {
          e.preventDefault();
          const step = e.key === "PageUp" || e.key === "PageDown" ? 1.0 : 0.1;
          const dir = e.key === "ArrowUp" || e.key === "PageUp" ? 1 : -1;
          const base = focus ? parseNum(display === "" ? String(value) : display, value) : value;
          const next = round01(base + dir * step);
          setTxt(next.toFixed(1));
          onCommit(next);
          setTyping(false);
          return;
        }
        if (e.key === "Enter") {
          e.target.blur();
          return;
        }
        // Cualquier otra tecla de edición => modo tecleo (commit al salir/Enter)
        if (
          (e.key.length === 1 && /[0-9.,-]/.test(e.key)) ||
          e.key === "Backspace" ||
          e.key === "Delete"
        ) {
          setTyping(true);
        }
      }}
      className={className}
    />
  );
}

// Geometría
function dist3D(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function planarDistances(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = a.z - b.z;
  return { xy: Math.hypot(dx, dy), xz: Math.hypot(dx, dz), yz: Math.hypot(dy, dz) };
}
function pointInPolygon(pt, poly) {
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
function polygonArea(poly) {
  let A = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    A += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(A) / 2;
}
function distPointToSegment2D(p, a, b) {
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
function minDistToEdges2D(p, poly) {
  let md = Infinity;
  for (let i = 0; i < poly.length; i++) md = Math.min(md, distPointToSegment2D(p, poly[i], poly[(i + 1) % poly.length]));
  return md;
}

// RNG simple reproducible
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== Reglas =====
const MARGIN = 0.5; // a caras (incluye Z)
const MIN_RED_BLUE = 1.0; // F–P ≥ 1,0 m (3D)
const MIN_BLUE_BLUE = 0.7; // P–P ≥ 0,7 m (3D)

// ===== Generador de puntos azules =====
function generateBluePoints({
  F1,
  F2,
  candidates,
  seed,
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
    const markDup = (axis) => {
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
      for (const [, list] of map)
        if (list.length > 1)
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
    };
    ["x", "y", "z"].forEach(markDup);

    const check = (p, t) => {
      if (!pointInPolygon(p, vertices)) {
        t.x = t.y = true;
        t.msg.push("Fuera del polígono (XY)");
      }
      if (minDistToEdges2D(p, vertices) < MARGIN - EPS) {
        t.x = t.y = true;
        t.msg.push("A <0,5 del borde (XY)");
      }
      if (p.z < MARGIN || p.z > alturaZ - MARGIN) {
        t.z = true;
        t.msg.push("Z fuera de márgenes");
      }
    };
    if (activeF1) check(F1, v.F1);
    if (activeF2) check(F2, v.F2);
    blue.forEach((b, i) => check(b, v.blue[i]));

    // Reglas F1–F2 por ejes (simultáneamente) solo si ambas fuentes están activas
    if (activeF1 && activeF2) {
      const dx = Math.abs(F1.x - F2.x),
        dy = Math.abs(F1.y - F2.y),
        dz = Math.abs(F1.z - F2.z);
      if (dx < 0.7) {
        v.F1.x = v.F2.x = true;
        v.F1.msg.push(`F1–F2: |X| = ${dx.toFixed(2)} < 0,7 m`);
        v.F2.msg.push(`F1–F2: |X| = ${dx.toFixed(2)} < 0,7 m`);
      }
      if (dy < 0.7) {
        v.F1.y = v.F2.y = true;
        v.F1.msg.push(`F1–F2: |Y| = ${dy.toFixed(2)} < 0,7 m`);
        v.F2.msg.push(`F1–F2: |Y| = ${dy.toFixed(2)} < 0,7 m`);
      }
      if (dz < 0.7) {
        v.F1.z = v.F2.z = true;
        v.F1.msg.push(`F1–F2: |Z| = ${dz.toFixed(2)} < 0,7 m`);
        v.F2.msg.push(`F1–F2: |Z| = ${dz.toFixed(2)} < 0,7 m`);
      }
    }

    // Distancias 3D azules contra fuentes activas y entre sí
    blue.forEach((b, i) => {
      if (activeF1 && dist3D(b, F1) < MIN_RED_BLUE) {
        v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
        v.blue[i].msg.push(`Distancia a F1 < 1,0 (=${dist3D(b, F1).toFixed(2)} m)`);
      }
      if (activeF2 && dist3D(b, F2) < MIN_RED_BLUE) {
        v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
        v.blue[i].msg.push(`Distancia a F2 < 1,0 (=${dist3D(b, F2).toFixed(2)} m)`);
      }
    });
    for (let i = 0; i < blue.length; i++)
      for (let j = i + 1; j < blue.length; j++) {
        const d = dist3D(blue[i], blue[j]);
        if (d < MIN_BLUE_BLUE) {
          v.blue[i].x = v.blue[i].y = v.blue[i].z = true;
          v.blue[j].x = v.blue[j].y = v.blue[j].z = true;
          v.blue[i].msg.push(`P${i + 1}–P${j + 1} < 0,7 (=${d.toFixed(2)} m)`);
          v.blue[j].msg.push(`P${i + 1}–P${j + 1} < 0,7 (=${d.toFixed(2)} m)`);
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
    // márgenes y polígono
    pts.forEach((p, i) => {
      if (!pointInPolygon(p, vertices) || minDistToEdges2D(p, vertices) < MARGIN - EPS) out.push(`P${i + 1} fuera del polígono o a <0,5 m del borde`);
      if (p.z < MARGIN || p.z > alturaZ - MARGIN) out.push(`P${i + 1} con Z fuera de márgenes`);
    });
    // duplicidades por ejes (X/Y entre todos; Z solo entre Pxs)
    ["x", "y", "z"].forEach((axis) => {
      const map = new Map();
      if (axis !== "z" && activeF1) {
        const k = key01(F1[axis]);
        map.set(k, [...(map.get(k) || []), "F1"]);
      }
      if (axis !== "z" && activeF2) {
        const k = key01(F2[axis]);
        map.set(k, [...(map.get(k) || []), "F2"]);
      }
      pts.forEach((p, i) => {
        const k = key01(p[axis]);
        map.set(k, [...(map.get(k) || []), `P${i + 1}`]);
      });
      for (const [k, names] of map) if (names.length > 1) out.push(`${axis.toUpperCase()} repetida (= ${k}) entre ${names.join(", ")}`);
    });
    // distancias
    pts.forEach((p, i) => {
      if (activeF1) {
        const d = dist3D(p, F1);
        if (d < MIN_RED_BLUE) out.push(`P${i + 1} a F1 = ${d.toFixed(2)} < 1,0 m`);
      }
      if (activeF2) {
        const d = dist3D(p, F2);
        if (d < MIN_RED_BLUE) out.push(`P${i + 1} a F2 = ${d.toFixed(2)} < 1,0 m`);
      }
    });
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = dist3D(pts[i], pts[j]);
        if (d < MIN_BLUE_BLUE) out.push(`P${i + 1}–P${j + 1} = ${d.toFixed(2)} < 0,7 m`);
      }
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
        <text key={"TX" + x} x={sx} y={height - pad + 14} fontSize={10} textAnchor="middle" fill="#666">{x.toFixed(1)}</text>
      );
    }
    for (let y = Math.ceil(bounds.minY / 0.5) * 0.5; y <= bounds.maxY + EPS; y += 0.5) {
      const sy = height - pad - (y - bounds.minY) * scale;
      els.push(<line key={"GY" + y} x1={pad} y1={sy} x2={width - pad} y2={sy} stroke="#c7cdd6" />);
      els.push(
        <text key={"TY" + y} x={pad - 8} y={sy + 3} fontSize={10} textAnchor="end" fill="#666">{y.toFixed(1)}</text>
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
          if (dx < 0.7) parts.push(`|X|=${dx.toFixed(2)}`);
          if (dy < 0.7) parts.push(`|Y|=${dy.toFixed(2)}`);
          if (dz < 0.7) parts.push(`|Z|=${dz.toFixed(2)}`);
          if (parts.length) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB}: ${parts.join(", ")} < 0,7 m`);
          }
        } else if ((isFA && isPB) || (isFB && isPA)) {
          const d = dist3D(A.p, B.p);
          if (d < 1.0) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB} = ${d.toFixed(2)} < 1,0 m (3D)`);
          }
        } else if (isPA && isPB) {
          const d = dist3D(A.p, B.p);
          if (d < 0.7) {
            pairs.add(`${i}-${j}`);
            msgs.push(`${nameA}–${nameB} = ${d.toFixed(2)} < 0,7 m (3D)`);
          }
        }
      }
    }
    return { pairs, msgs };
  }, [pointListTable]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold text-white">Distribución de Puntos Acústicos - UNE EN ISO 16283-1-2015 - Medidas de aislamiento a ruido aéreo</h1>

      <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: `${leftColW}px ${rightColW}px` }}>
        {/* Columna izquierda (fila superior): Datos + Círculos, igual ancho que el gráfico */}
        <div className="flex gap-4 h-full" style={{ width: leftColW }}>
        {/* Datos del recinto */}
        <section className="p-2 rounded-xl shadow bg-white border text-sm self-start flex-1 h-full">
          <h2 className="text-base font-medium mb-2">Datos del recinto</h2>
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
            <div className="text-xs text-gray-600">
              Área: {area.toFixed(2)} · Volumen: {volumen.toFixed(2)}
            </div>
          </div>
        </section>

        {/* Círculos de distancia */}
        <section className="p-2 rounded-xl shadow bg-white border text-sm self-start flex-1 h-full">
          <h2 className="text-base font-medium mb-2">Círculos de distancia</h2>
          <table className="text-xs border w-full">
            <thead>
              <tr>
                <th className="px-2">r</th>
                <th className="px-2">Fuentes</th>
                <th className="px-2">Puntos de medida</th>
              </tr>
            </thead>
            <tbody>
              {radii.map((r) => (
                <tr key={r}>
                  <td className="px-2 py-1">{r.toFixed(1)} m</td>
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
          <h2 className="text-base font-medium mb-2">Tabla de distancias (3D)</h2>
          <div>
            <div className="text-[11px] text-gray-600 mb-2">
              Distancia en línea recta entre todos los puntos activos. {minPair ? (
                <span>
                  Mínima actual: <b>{minPair.a}</b>–<b>{minPair.b}</b> = {minPair.d.toFixed(1)} m
                </span>
              ) : null}
            </div>
            <div className="overflow-x-hidden overflow-y-auto max-h-64">
              <table className="text-[11px] border table-fixed" style={{ width: tableW }}>
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

                        // Prioridad de estilos: diagonal con datos < mínimo (amarillo) < violación (rose) < <2m (rojo suave)
                        const bgClass = diagWithData
                          ? ""
                          : isMinPair
                          ? "bg-yellow-50"
                          : isViol
                          ? "bg-rose-50"
                          : underTwo
                          ? "bg-red-50"
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
                  <text x={s.x + 6} y={s.y - 6} fontSize={11} fill="#111">{label}</text>
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
                    <text x={s.x + 6} y={s.y - 6} fontSize={11} fill={color}>{label}</text>
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
          <h2 className="text-base font-medium mb-2">Tabla de puntos</h2>

          <table className="text-xs border table-fixed" style={{ width: tableW }}>
            <thead>
              <tr>
                <th className="px-2 h-7 w-16">Activa</th>
                <th className="px-2 h-7 w-20">Punto</th>
                <th className="px-2 h-7 w-16">X</th>
                <th className="px-2 h-7 w-16">Y</th>
                <th className="px-2 h-7 w-16">Z</th>
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
                  <td className="px-2 font-medium h-7">{row.name}</td>
                  <td className="px-2 h-7">
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
                  <td className="px-2 h-7">
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
                  <td className="px-2 h-7">
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
                  <td className="px-2 h-7">
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
                  <td className="px-2 h-7">
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
                  <td className="px-2 h-7">
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
            const list = [];
            const pts = [
              ...(activeF1 ? [{ name: "F1", p: F1 }] : []),
              ...(activeF2 ? [{ name: "F2", p: F2 }] : []),
              ...(blueActive ? blue.map((b, i) => ({ name: `P${i + 1}`, p: b })) : []),
            ];

            ["x", "y", "z"].forEach((axis) => {
              const map = new Map();
              const pool = axis === "z" ? pts.filter(({ name }) => name.startsWith("P")) : pts;
              pool.forEach(({ name, p }) => {
                const k = (Math.round(p[axis] * 10) / 10).toFixed(1);
                if (!map.has(k)) map.set(k, []);
                map.get(k).push(name);
              });
              for (const [k, names] of map) if (names.length > 1) list.push(`${axis.toUpperCase()} repetida (= ${k}) entre ${names.join(", ")}`);
            });

            // Añadir avisos por distancias (F–F por ejes; F–P 3D <1,0; P–P 3D <0,7)
            distViol.msgs.forEach((m) => list.push(m));

            const uniq = Array.from(new Set(list));
            return uniq.length ? (
              <div className="mt-2 p-2 border border-red-300 rounded bg-red-50 text-red-700 text-xs">
                <div className="font-medium mb-1">Avisos de incoherencia:</div>
                <ul className="list-disc pl-4 space-y-0.5">{uniq.map((m, i) => (<li key={i}>{m}</li>))}</ul>
              </div>
            ) : null;
          })()}

          <div className="mt-3 text-[12px] text-black">
            <div className="font-medium mb-1">Reglas:</div>
            <div className="mb-1"><span className="font-medium">❖ Coordenadas:</span> No puede repetirse</div>
            <ul className="list-none pl-4 space-y-0.5">
              <li>➤ Coordenada X e Y entre ningún punto (incluye F1 y F2 activas).</li>
              <li>➤ Coordenada Z entre Px</li>
              <li>➤ Coordenada Z entre Fx (Z puede repetirse entre Fx – Px)</li>
            </ul>
            <div className="mt-2 mb-1"><span className="font-medium">❖ Distancias mínimas:</span></div>
            <ul className="list-none pl-4 space-y-0.5">
              <li>➤ Todos (Fuente y Punto) ≥ 0,5 m a todas las caras (incluye Z).</li>
              <li>➤ Fuente – Fuente ≥ 0,7 m en todos los ejes.</li>
              <li>➤ Fuente – Punto ≥ 1,0 m (3D).</li>
              <li>➤ Punto – Punto ≥ 0,7 m (3D).</li>
            </ul>
          </div>
          </section>
        </div>
      </div>
    </div>
  );
}
