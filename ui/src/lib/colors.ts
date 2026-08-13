// Layer accent colors (mirror the CSS custom props in index.css) and the
// hotspot color scale used to tint nodes.

export const LAYER_COLORS: Record<string, string> = {
  source: "#7c8b9e",
  stage: "#38bdf8",
  dwh: "#818cf8",
  datamart: "#f472b6",
  reporting: "#34d399",
  lkp: "#fbbf24",
  archive: "#94a3b8",
  other: "#64748b",
};

export function layerColor(layer: string): string {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.other;
}

// Sequential "cool → hot" scale for hotspot intensity (0..1). Blue → amber → red.
const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [100, 116, 139]], // neutral slate (cold) — subtle on both light & dark after mixing
  [0.35, [59, 130, 246]], // blue
  [0.7, [251, 191, 36]], // amber
  [1.0, [239, 68, 68]], // red (hottest)
];

export function hotspotColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(239,68,68)";
}

export const TRANSFORM_COLORS: Record<string, string> = {
  direct: "#34d399",
  derived: "#fbbf24",
  aggregate: "#f472b6",
  unknown: "#94a3b8",
};
