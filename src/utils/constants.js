export const EPS = 1e-9;
export const STEP = 0.1; // rejilla 0,1 m

export const round01 = (n) => Math.round(n * 10) / 10;
export const key01 = (n) => n.toFixed(1);
export const parseNum = (v, fb = 0) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fb;
};

// Reglas
export const MARGIN = 0.5; // a caras (incluye Z)
export const MIN_RED_BLUE = 1.0; // F–P ≥ 1,0 m (3D)
export const MIN_BLUE_BLUE = 0.7; // P–P ≥ 0,7 m (3D)
export const MIN_F_F_AXIS = 0.7; // F–F ≥ 0,7 m en cada eje
