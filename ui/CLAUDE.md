# Frontend — dbt-docs-in-steroids

Vite + React 19 + TypeScript (strict). Biome for lint/format, pnpm.

## Stack

- **@xyflow/react** (React Flow v12) — the lineage canvas.
- **recharts** — analytics charts.
- **@tanstack/react-query** — all server state.
- **Tailwind v4** — CSS-first theme in `src/index.css` (`@theme` tokens); no
  `tailwind.config.js`. Use the semantic tokens (`bg-panel`, `text-muted`, …).

## Layout

```
src/
├── App.tsx              # shell: nav (Lineage/Analytics) + ProjectBar; URL state
├── lib/
│   ├── api.ts           # apiGet/apiPost/apiPostForm/apiDelete over proxied /api
│   ├── colors.ts        # layer colors + hotspot color scale
│   ├── query-client.ts
│   └── api-types.gen.ts # generated (pnpm openapi:gen); do not edit
├── types.ts             # hand-written domain types mirroring the API
└── features/
    ├── projects/        # api.ts (query hooks) + ProjectBar.tsx
    ├── lineage/         # api.ts, layout.ts (swimlane), LineageView, NodePanel, nodes.tsx
    └── analytics/       # api.ts + AnalyticsDashboard.tsx
```

## Conventions

- Data via TanStack Query hooks in each feature's `api.ts`; query-key factories.
- The lineage layout (`features/lineage/layout.ts`) is a **deterministic layered
  swimlane** (one column per layer, hotspots sorted to top). No external layout
  engine yet — elkjs edge-crossing minimization is a future enhancement.
- Column trace: clicking a column in `NodePanel` fetches `/columns/{c}/lineage`;
  `LineageView` highlights touched nodes/edges and auto-expands collapsed layers
  the path reaches.
- After changing backend response shapes, run `pnpm openapi:gen` and update
  `src/types.ts` if you rely on the hand-written types.

## Commands

```bash
pnpm dev            # :5173, proxies /api → :8000
pnpm typecheck && pnpm lint && pnpm build
pnpm openapi:gen    # regenerate API types (backend must be running)
node scripts/smoke.mjs   # headless render check (needs system Chrome)
```
