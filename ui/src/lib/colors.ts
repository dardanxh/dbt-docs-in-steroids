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

// Green → amber → red scale for "Color by: Errors" — healthy models stay green,
// the most error-prone go red. Same interpolation shape as hotspotColor.
const ERROR_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [34, 197, 94]], // green (no / few errors)
  [0.5, [251, 191, 36]], // amber
  [1.0, [239, 68, 68]], // red (most errors)
];

export function errorColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < ERROR_STOPS.length - 1; i++) {
    const [t0, c0] = ERROR_STOPS[i];
    const [t1, c1] = ERROR_STOPS[i + 1];
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

// Fixed palette for error categories (timeline badges + analytics charts). Keys
// mirror the backend ErrorCategory enum; unknown categories fall back to slate.
export const ERROR_CATEGORY_COLORS: Record<string, string> = {
  test_failure: "#f472b6",
  compilation_error: "#f59e0b",
  sql_runtime_error: "#ef4444",
  freshness_error: "#22d3ee",
  upstream_failure: "#a78bfa",
  permission_error: "#fb7185",
  resource_limit: "#fbbf24",
  dependency_missing: "#60a5fa",
  connection_error: "#2dd4bf",
  configuration_error: "#c084fc",
  other: "#94a3b8",
};

export function errorCategoryColor(category: string): string {
  return ERROR_CATEGORY_COLORS[category] ?? "#94a3b8";
}

export const TRANSFORM_COLORS: Record<string, string> = {
  direct: "#34d399",
  derived: "#fbbf24",
  aggregate: "#f472b6",
  unknown: "#94a3b8",
};

// Column-lineage coverage status — shared by the node status dot, the
// "Color by: Column lineage status" tint, and its legend.
export const STATUS_COLORS: Record<string, string> = {
  ok: "#34d399",
  partial: "#fbbf24",
  failed: "#6b7280",
};

// Legend rows (label + color) for status coloring, in severity order.
export const STATUS_LEGEND: Array<{ key: string; label: string; color: string }> = [
  { key: "ok", label: "OK", color: STATUS_COLORS.ok },
  { key: "partial", label: "Partial", color: STATUS_COLORS.partial },
  { key: "failed", label: "None", color: STATUS_COLORS.failed },
  { key: "na", label: "N/A", color: "#475569" },
];

export function statusColor(status: string | null): string {
  return (status && STATUS_COLORS[status]) ?? "#475569";
}

// --- Git ownership --------------------------------------------------------

// Distinct, saturated hues for coloring nodes by their top git contributor.
// Deterministically hashed so a given actor keeps the same color across renders.
const OWNER_PALETTE = [
  "#38bdf8", // sky
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb7185", // rose
  "#4ade80", // green
  "#f59e0b", // orange
  "#22d3ee", // cyan
  "#c084fc", // purple
  "#facc15", // yellow
  "#2dd4bf", // teal
  "#60a5fa", // blue
  "#e879f9", // fuchsia
];

const UNOWNED_COLOR = "#475569"; // slate — no git owner (upload-mode / untracked file)

export function ownerColor(owner: string | null | undefined): string {
  if (!owner) return UNOWNED_COLOR;
  let hash = 0;
  for (let i = 0; i < owner.length; i++) {
    hash = (hash << 5) - hash + owner.charCodeAt(i);
    hash |= 0; // 32-bit
  }
  return OWNER_PALETTE[Math.abs(hash) % OWNER_PALETTE.length];
}

const DAY_MS = 86_400_000;

// A model whose most recent commit is older than `days` is "stale".
export function isStale(iso: string | null | undefined, days = 365): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t > days * DAY_MS;
}

// Bus-factor / knowledge-risk overlay (0..1), fed through the hotspot heat scale.
// Combines blast radius (downstream impact), ownership concentration (solo owner
// or dominant share), and staleness. Nodes without git ownership score 0 (cold).
export function riskScore(
  m: {
    owner: string | null;
    downstream_count: number;
    contributor_count: number;
    owner_share: number | null;
    last_modified_at: string | null;
  },
  maxDownstream: number,
): number {
  if (!m.owner) return 0;
  const impact = maxDownstream > 0 ? m.downstream_count / maxDownstream : 0;
  const solo = m.contributor_count <= 1 ? 1 : Math.max(0, m.owner_share ?? 0);
  const stale = isStale(m.last_modified_at) ? 1 : 0.35;
  return impact * (0.35 + 0.65 * solo) * stale;
}
