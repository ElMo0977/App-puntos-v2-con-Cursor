import { useCallback, useMemo } from 'react';
import { dist3D, mulberry32, shuffle } from '../utils/geometry';
import {
  MIN_BLUE_BLUE,
  MIN_RED_BLUE,
  key01,
  round01,
} from '../utils/constants';
import { refinePoints, scoreMaximin } from '../utils/bluePoints';

export function generateBluePoints({
  F1,
  F2,
  candidates,
  seed = null,
  genNonce,
  f1Active = true,
  f2Active = true,
  byZ,
  zLevelsAll,
  zOptionsByIdx: precomputedZOptions = null,
}) {
  if (!candidates.length) return { points: [], feasible: false };

  const userSeed = seed
    ? Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0)
    : 0;
  const rng = mulberry32(
    seed ? userSeed : (Date.now() ^ (genNonce * 0x9e3779b9)) >>> 0
  );

  const zOptionsByIdx =
    precomputedZOptions ||
    [1.0, 1.1, 1.2, 1.3, 1.4].map(round01).map((dz) => {
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

  const redAnchors = () => [
    ...(f1Active ? [F1] : []),
    ...(f2Active ? [F2] : []),
  ];

  const usedX0 = new Set();
  const usedY0 = new Set();
  const usedZ0 = new Set();
  if (f1Active) {
    usedX0.add(key01(F1.x));
    usedY0.add(key01(F1.y));
  }
  if (f2Active) {
    usedX0.add(key01(F2.x));
    usedY0.add(key01(F2.y));
  }

  const MAX_NODES = 60000;
  let nodes = 0;
  const TOPC = 22;
  const TOPZ = 18;
  const MAX_SOL = 20;
  const solutions = [];

  function dfs(i, chosen, usedX, usedY, usedZ) {
    if (nodes++ > MAX_NODES) return false;
    if (i === 5) {
      solutions.push(chosen.slice());
      return solutions.length >= MAX_SOL;
    }

    const zList = zOptionsByIdx[i].slice(
      0,
      Math.min(TOPZ, zOptionsByIdx[i].length)
    );
    for (const z of zList) {
      const zk = key01(z);
      if (usedZ.has(zk)) continue;
      let pool = (byZ.get(zk) || []).filter(
        (c) => !usedX.has(key01(c.x)) && !usedY.has(key01(c.y))
      );
      if (!pool.length) continue;

      const poolOk = pool.filter(
        (c) =>
          redAnchors().every((r) => dist3D(c, r) >= MIN_RED_BLUE) &&
          chosen.every((q) => dist3D(c, q) >= MIN_BLUE_BLUE)
      );
      if (!poolOk.length) continue;

      const ranked = poolOk
        .map((c) => ({
          c,
          s: scoreMaximin(c, chosen, redAnchors, rng) + rng() * 0.02,
        }))
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.min(TOPC, poolOk.length));

      for (const { c } of ranked) {
        const nx = new Set(usedX);
        nx.add(key01(c.x));
        const ny = new Set(usedY);
        ny.add(key01(c.y));
        const nz = new Set(usedZ);
        nz.add(zk);
        if (dfs(i + 1, [...chosen, c], nx, ny, nz)) return true;
      }
    }
    return false;
  }

  dfs(0, [], usedX0, usedY0, usedZ0);

  if (solutions.length) {
    const idx = seed ? 0 : genNonce % solutions.length;
    let pick = solutions[idx].slice();
    pick = refinePoints(pick, byZ, redAnchors, rng);
    return { points: pick, feasible: true };
  }

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
      (c) =>
        !usedX.has(key01(c.x)) &&
        !usedY.has(key01(c.y)) &&
        !usedZ.has(key01(c.z)) &&
        anchors0.every((r) => dist3D(c, r) >= MIN_RED_BLUE),
      (c) =>
        !usedX.has(key01(c.x)) &&
        !usedY.has(key01(c.y)) &&
        !usedZ.has(key01(c.z)),
      () => true,
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

export default function useBluePoints({
  F1,
  F2,
  candidates,
  f1Active,
  f2Active,
  byZ,
  zLevelsAll,
  seed = null,
  genNonce,
}) {
  const desiredZ = useMemo(() => [1.0, 1.1, 1.2, 1.3, 1.4].map(round01), []);
  const zOptionsByIdx = useMemo(() => {
    if (!candidates.length) return [];
    const userSeed = seed
      ? Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0)
      : 0;
    const rng = mulberry32(
      seed ? userSeed : (Date.now() ^ (genNonce * 0x9e3779b9)) >>> 0
    );
    return desiredZ.map((dz) => {
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
  }, [candidates.length, desiredZ, genNonce, seed, zLevelsAll]);

  const generator = useCallback(
    () =>
      generateBluePoints({
        F1,
        F2,
        candidates,
        f1Active,
        f2Active,
        byZ,
        zLevelsAll,
        seed,
        genNonce,
        zOptionsByIdx,
      }),
    [
      F1,
      F2,
      candidates,
      f1Active,
      f2Active,
      byZ,
      zLevelsAll,
      seed,
      genNonce,
      zOptionsByIdx,
    ]
  );

  return useMemo(() => generator(), [generator]);
}
