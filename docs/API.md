# Argus API contract

Base path: `/api`. All bodies are JSON. All endpoints accept an optional `X-Session` header; each session gets its own simulated world. Without the header the shared `default` session is used. Sessions are capped by memory (default 13, from a 350 MB budget: ~100 MB base + ~16–18 MB per session; override with `ARGUS_MAX_SESSIONS` or `ARGUS_MEM_BUDGET_MB`), the least recently used session is evicted first, and sessions idle for 30 min expire (`ARGUS_SESSION_TTL_S`).

### `GET /api/health`
`{ "ok": true, "llm": "model id" | null, "sessions": 3, "max_sessions": 13, "session_ttl_s": 1800, "evicted": 0, "expired": 0, "rss_mb": 146.2, "mem_budget_mb": 350 }`

The built frontend (`frontend/dist`) is served at `/` when it exists.

## Read endpoints

### `GET /api/state`
Globe state.
```jsonc
{
  "clock": { "t": 336, "label": "Day 15 · Sun 00:00 UTC" },
  "countries": [
    {
      "iso": "CA", "name": "Canada", "lat": 56.1, "lng": -106.3,
      "status": "ok",              // "ok" | "watch" (|z|≥4 for 1 h) | "incident" (persists ≥2 h and impact > $150/h or |z|≥8) | "explained" | "waiting"
      "health_z": 0.4,             // max |z| over the country's KPIs (signed value of that KPI)
      "kpis": {                    // last-hour observed values
        "new_accounts": 0, "completions": 0, "revenue": 0,
        "rewards": 0, "margin": 0, "quality_per_completion": 0
      },
      "potential_usd_day": 1234.0,  // twin-estimated margin uplift if the feed matched local taste
      "potential_pct": 2.4          // same, as % of the country's current daily margin
    }
  ],
  "incidents": [
    { "id": "inc-1", "title": "...", "country": "CA", "status": "open", "severity": "high",
      "impact_usd_h": 134.0,      // current deviation in USD/h
      "risk_7d_usd": 114042,      // 7-day margin lost by doing nothing vs the recommended fix (p50, twin)
      "reaction_h": 27,           // hours until advertisers react (chargebacks), from the do-nothing route's events; 0 = losses accrue now; null = n/a
      "card": { ... } }           // plain-language issue card, see below
  ],
  "explained": [
    { "t": 350, "country": "DE", "event": "Weekend Boost (games)", "naive_z": 5.1, "twin_z": 0.7 }
  ],
  "attention": { "watched_series": 120, "investigations": 1, "l3_runs": 1 }
}
```
Incident `status`: `open` | `persisting` | `fix_applied` | `verified` | `resolved`. `severity`: `low` | `medium` | `high`,
from risk rather than hourly impact: high if `risk_7d_usd` ≥ $25k, or ≥ $10k with advertisers reacting within 24 h;
medium if ≥ $5k, or ≥ $1k with a reaction within 24 h; low otherwise.

### Issue card (`incident.card`, in `/api/state` incidents and `/api/incidents/{id}`)
Plain short sentences for the issue card; no z-scores or model terms (those stay in `reports.engineer`).
Recomputed on every read, so `status_line` follows the incident.
```jsonc
{
  "title": "Fake-account cluster in Canada (Android)",
  "looks_like": "+$85/h of 'growth'",              // how it looks on a naive dashboard
  "at_stake_7d_usd": 156194,                        // = risk_7d_usd
  "what_happened": "About 103 fake accounts appeared on Android in Canada and are completing high-paying strategy-game and fintech offers.",
  "why": "Their stated interests don't match what they do and they share emulator devices (proven, 94% explained).",
  "what_to_do": "Verify new accounts: require phone and device checks for new Android sign-ups. Saves about $156,194 over the next 7 days.",
  "status_line": "Needs a decision"                 // "Needs a decision" | "Fix applied · verifying" | "Prediction verified" |
                                                    // "Fix applied · prediction missed, model recalibrated" | "Resolved[ · prediction verified]"
}
```
After approval `what_to_do` becomes "Done: <fix> applied."

### `GET /api/incidents/{id}`
```jsonc
{
  "id": "inc-1", "title": "...", "status": "open", "severity": "high", "impact_usd_h": 134.0, "risk_7d_usd": 114042, "reaction_h": 21,
  "country": "CA", "platform": "android", "category": "fintech", "detected_at": 352,
  "trail": [ { "t": 352, "level": "L1", "action": "...", "finding": "..." } ],   // level: "L1" | "L2" | "L3"
  "graph": {
    "nodes": [ { "id": "new_accounts", "label": "New accounts", "z": 9.3, "state": "root" } ],  // state: "root" | "broken" | "symptom" | "normal"
    "edges": [ { "source": "new_accounts", "target": "active_users", "type": "mechanism" } ]
  },
  "contributions": [ { "mechanism": "new_accounts", "value_usd": -420.0 } ],          // exact Shapley over mechanisms, sums to Δmargin
  "hypotheses": [ { "name": "Fraud cluster", "explained": 0.94, "verdict": "supported" } ],  // verdict: "supported" | "partial" | "rejected"
  "l3": {                                                                               // null when no L3 run
    "summary": { "n_users": 600, "n_flagged": 88, "coherence_flagged": 0.28, "coherence_others": 0.73, "top_devices": ["emulator-x86"] },
    "points": [ { "coherence": 0.71, "payout_focus": 0.2, "flagged": false } ]
  },
  "fixes": [
    {
      "id": "block_cluster", "name": "Block cluster", "description": "...",
      "days": [1,2,3,4,5,6,7], "p10": [], "p50": [], "p90": [],                           // cumulative margin USD
      "delta_p50_usd": 15000.0,                                                            // day-7 p50 vs do nothing
      "delta_daily": { "p10": [], "p50": [], "p90": [] },   // cumulative margin vs do nothing, days 1..7 (paired per simulated future)
      "events": [                                           // advertiser reactions in the twin's simulated future (≥50% of paths)
        { "after_h": 27, "label": "Advertisers start reclaiming money", "probability": 1.0 },
        { "after_h": 50, "label": "Advertiser cuts the budget", "probability": 1.0 }
      ],                                                    // labels also: "Advertiser fixes tracking"; [] when none apply
      "advertiser_risk": "..."
    }
  ],
  "recommended": "block_cluster",
  "applied": null,                                                                         // fix id once approved
  "verification": { "status": "pending", "predicted": [10, 50, 90], "actual": null },       // status: "pending" | "verified" | "missed"
  "reports": { "ceo": "...", "manager": "...", "engineer": "...", "source": "template" },  // source: "template" | "llm"
  "card": { ... },                                                                          // issue card (above)
  "series_meta": { "kpi": "new_accounts", "label": "New accounts, Canada · Android", "unit": "per hour" },
  "series": [                                     // alerting KPI for the root segment, hourly, last 48 h up to now
    { "t": 344, "label": "Mon 08:00", "actual": 77.8, "expected": 47.5, "lo": 41.7, "hi": 54.2 }   // lo/hi = twin ±2σ
  ],
  "left_zone_at": { "t": 344, "label": "Mon 08:00" },  // first hour of the excursion that led to detection; null if none
  "counterfactual": {                             // twin replay with the supported cause removed; null if no supported cause
    "label": "Without the 28 flagged fake accounts",   // number = accounts flagged in the L3 sample
    "series": [ { "t": 344, "value": 47.5 } ],          // same hours as `series`; equals `actual` before left_zone_at
    "explained_share": 0.942
  }
}
```

### `GET /api/incidents`
List of the same summaries as `state.incidents`.

### `GET /api/graph`
`MetricGraph.to_dict()`: `{ nodes, edges, exogenous, levels }`.

### `GET /api/country/{iso}`
L2 heatmap.
```jsonc
{ "iso": "CA", "name": "Canada",
  "segments": [ { "platform": "Android", "category": "Fintech apps",
                  "kpi_z": { "new_accounts": 12.4,      // platform-level (sign-ups have no category); same for all categories of the platform
                             "completions": 2.6, "revenue": 2.7, "rewards": 2.6, "quality_per_completion": -1.9 },
                  "deviation_usd_h": 55.0 } ],          // margin deviation vs the twin, USD/h
  "platforms": [ { "platform": "Android", "new_accounts_z": 12.4, "active_users_z": -0.3,
                   "new_accounts_h": 95.5, "new_accounts_expected_h": 64.8 } ] }
```

### `GET /api/potential`
```jsonc
{ "countries": [ { "iso": "DE", "potential_usd_day": 1432.0, "potential_pct": 3.0, "current_margin_usd_day": 48441.0,
                   "top_categories": ["Streaming apps", "Shopping cashback"],      // under-served AND locally distinctive
                   "explain": ["watches series weekly", "night owl", "parent"],    // life signals behind the top category
                   "demand_index": { "Casual games": 1.02, "Strategy games": 0.92, "...": 1.0 } } ] }  // local / global demand
```

### `GET /api/meta`
Public data behind the simulation, for a "Data" panel.
```jsonc
{ "data_sources": [ { "label": "Annual revenue run rate", "value": "$1B",
                      "source": "Almedia release via PPC Land, 15 Oct 2026", "url": "https://ppc.land/..." } ],
  "calibration_note": "Calibrated to public data: ...",
  "calibration": { "revenue_usd_day": { "sim": 2740947, "published": 2739726 },
                   "rewards_share": [ { "iso": "US", "name": "United States", "sim": 0.5788, "published": 0.579 } ] } }
```
`published` is `null` for countries without a published payout share.

## Write endpoints

| Method & path | Body | Effect / response |
|---|---|---|
| `POST /api/step` | `{ "hours": 1 }` | Advance world and agent; returns `/api/state` |
| `POST /api/reset` | `{}` | New world (14-day history, twin learned); returns `/api/state` |
| `POST /api/inject` | `{ "type": "promo" \| "bot_farm" \| "tracking_break" \| "data_delay", "country": "CA", "platform": "android" }` (`platform` optional) | Schedules the event at the current hour; returns `{ ok, event }` |
| `POST /api/incidents/{id}/approve` | `{ "fix_id": "block_cluster" }` | Applies fix to reality; returns the incident detail |
| `POST /api/metrics` | `{ "name": "...", "description": "..." }` | `{ "node": {...} \| null, "validation": { "ok": true, "checks": [ { "name": "...", "ok": true, "detail": "..." } ] } }` |
| `POST /api/demo/{scene}` | — | Deterministic (fixed seed) jump to a video scene; returns `{ scene, state, incident_id? }` |

Demo scenes, in order: `start`, `promo`, `bot_farm`, `investigate`, `approve`, `verify`, `new_metric`, `tracking_break`. Each scene advances the session world from wherever the previous scene left it (calling `start` resets).

Errors: `404 {detail}` for unknown incident / country / scene, `400 {detail}` for invalid input.
