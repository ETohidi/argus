# Argus frontend

Vite + React + TypeScript + Tailwind v4 + MapLibre GL (globe projection). Charts are hand-written SVG.

```bash
npm install
npm run dev     # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build   # outputs dist/ (served by the backend at /)
```

When the backend is unreachable, `src/lib/api.ts` switches to the in-browser mock world in `src/mock/`
(same shapes as `docs/API.md`) and re-probes the backend every 10 s. The footer badge shows
`LIVE TWIN` or `MOCK DATA`.

Layout: `components/TopBar` (clock, play, inject, demo scenes, add metric), `components/Globe`
(status / potential fill, pulsing markers, auto-rotation, click to zoom), right panel
(`IncidentFeed` → `IncidentDetail` with CEO / Manager / Engineer tabs, or `CountryPanel` with the
L2 heatmap), and `components/charts/` (causal DAG, Shapley bars, L3 scatter, fix fan charts).
