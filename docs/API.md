# Argus API contract

Base path: `/api`. All bodies are JSON. All endpoints accept an optional `X-Session` header; each session gets its own simulated world. Without the header the shared `default` session is used. Sessions are capped by memory (default 13, from a 350 MB budget: ~100 MB base + ~16–18 MB per session; override with `ARGUS_MAX_SESSIONS` or `ARGUS_MEM_BUDGET_MB`), the least recently used session is evicted first, and sessions idle for 30 min expire (`ARGUS_SESSION_TTL_S`).

### `GET /api/health`
`{ "ok": true, "llm": "model id" | null, "sessions": 3, "max_sessions": 13, "session_ttl_s": 1800, "evicted": 0, "expired": 0, "rss_mb": 146.2, "mem_budget_mb": 350 }`

The built frontend (`frontend/dist`) is served at `/` when it exists.

**Time labels.** Hour `t` covers simulated UTC `t:00–(t+1):00` (sim day 0 is a Monday). Every label is the time the
hour's data are complete ("data through 04:00"): the clock shows the end of the last processed hour, series points and
timeline events are labelled by the end of their hour, and planned calendar events by their start time.

## Read endpoints

### `GET /api/state`
Globe state.
```jsonc
{
  "clock": { "t": 336, "label": "Day 15 · Mon 01:00 UTC", "utc_hour": 1, "day_of_week": "Mon", "day": 15 },  // end of last processed hour; for day/night
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
      "status_label": "Still going",   // "Open" | "Still going" | "Fix applied" | "Fix verified" | "Resolved"
      "first_seen": "Mon 04:00",       // first hour out of the normal zone (or detection time)
      "last_seen": "Mon 09:00",        // last hour the alert condition held
      "resolved_at": null,             // time label once resolved
      "alerts_merged": 3,              // later alerts for the same problem folded into this issue (never reported twice)
      "recurrence_of": null,           // id of an earlier resolved issue with the same country/platform/root cause
      "downstream": [                  // predicted consequences attached to this issue (not reported separately)
        { "effect": "chargeback", "platform": "iOS", "category": "Fintech apps", "t": 365, "label": "Tue 11:00",
          "after_h": 29, "predicted_after_h": 28,
          "text": "Advertisers reclaiming money: fintech apps on iOS, caused by the farm, as predicted (~28 h, seen after 29 h)" } ],
      "card": { ... } }           // plain-language issue card, see below
  ],
  "added_metrics": [               // metrics added via POST /api/metrics, now monitored
    { "id": "margin_per_signup", "label": "margin_per_signup", "expr": "margin / new_accounts",
      "unit": "USD per new account", "added_at": 335, "status": "ok",          // "ok" | "watch" (|z| ≥ 4 somewhere)
      "max_z": { "country": "US", "z": 1.3 }, "note": "Added because you asked for 'margin_per_signup'. ..." }
  ],
  "explained": [
    { "t": 350, "country": "DE", "event": "Weekend Boost (games)", "naive_z": 5.1, "twin_z": 0.7 }
  ],
  "attention": { "watched_series": 120, "investigations": 1, "l3_runs": 1 }
}
```
Incident `status`: `open` | `persisting` | `fix_applied` | `verified` | `resolved` (show `status_label`).
Issue tracking: an alert is merged into an open issue only if it has the same country and the same cause (platform ×
cause family: users / revenue / rewards). A strong new root of another family, holding 2 h, opens its own issue. An
advertiser reaction the issue predicted (chargebacks: revenue per completion, budget cut: impressions, in the issue's
offer categories, near the predicted hour) is attached to it as `downstream` instead of a new issue. With a fix: resolved after verification plus 6 healthy hours. Without a fix: resolved after 6 healthy
hours ("Recovered without action" in the trail). A returning problem opens a new issue with `recurrence_of` set. `severity`: `low` | `medium` | `high`,
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
    "summary": { "n_users": 600, "n_flagged": 28, "estimated_total": 103,   // estimated_total: from excess sign-ups (same number as the card)
                  "coherence_flagged": 0.28, "coherence_others": 0.73, "top_devices": ["emulator-x86"] },
    "points": [ { "coherence": 0.71, "payout_focus": 0.2, "flagged": false, "device": "Phone 12", "account_age_days": 140 } ],
    "links": [ { "a": 22, "b": 34 } ],               // flagged accounts sharing a device (indices into points; ≤120)
    "groups": [ { "device": "Emu-A1", "count": 15 } ] // flagged accounts per device, largest first
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
    "label": "Without the fake accounts (28 flagged in a sample of 600, about 103 in total)",  // sample count + estimated total
    "series": [ { "t": 344, "value": 47.5 } ],          // same hours as `series`; equals `actual` before left_zone_at
    "explained_share": 0.942
  }
}
```

### `GET /api/incidents`
List of the same summaries as `state.incidents`.

### `GET /api/graph`
The metric graph with typed edges.
```jsonc
{
  "nodes": [ { "id": "margin", "label": "Contribution margin", "unit": "USD/h", "kind": "money", "level": "L2",
               "parents": ["revenue", "rewards"], "edge": "formula", "expr": "revenue - rewards", "aggregation": "sum",
               "origin": "core",            // "core" | "extension" (added via POST /api/metrics)
               "breakdown": ["country", "platform", "offer category"],   // users: ["country", "platform"]
               "note": "" } ],              // extension nodes: the "Added because ..." note
  "edges": [                                // drawable between nodes (+ the "calendar" source)
    { "source": "new_accounts", "target": "active_users", "type": "mechanism", "label": "Possible cause" },
    { "source": "revenue", "target": "margin", "type": "formula", "label": "Formula" },
    { "source": "calendar", "target": "starts", "type": "exogenous", "label": "Known event" } ],
  "breakdown_edges": [                      // metric -> first dimension, then the dimension chain
    { "source": "margin", "target": "dim:country", "type": "breakdown", "label": "Breakdown" },
    { "source": "dim:country", "target": "dim:platform", "type": "breakdown", "label": "Breakdown" },
    { "source": "dim:platform", "target": "dim:offer_category", "type": "breakdown", "label": "Breakdown" } ],
  "dimensions": [ { "id": "dim:country", "label": "Country (20)" }, { "id": "dim:platform", "label": "Platform (iOS, Android)" },
                  { "id": "dim:offer_category", "label": "Offer category (6)" } ],
  "edge_types": [                           // legend: one entry per edge type
    { "type": "formula",   "label": "Formula",        "meaning": "the metric is computed from its inputs (e.g. margin = revenue − rewards)", "reasoning": "exact decomposition: how much each input contributes to a change" },
    { "type": "breakdown", "label": "Breakdown",      "meaning": "the same metric split by country → platform → offer category", "reasoning": "localise: find the segment that carries the change" },
    { "type": "mechanism", "label": "Possible cause", "meaning": "the upstream metric drives this one (e.g. starts → completions)", "reasoning": "root cause: test each link given its parents, counterfactual proof" },
    { "type": "exogenous", "label": "Known event",    "meaning": "planned marketing events change these metrics on purpose", "reasoning": "explain innocent changes instead of alerting" } ],
  "exogenous": [ { "id": "calendar", "label": "Planned events (marketing calendar)" } ],
  "levels": { "L1": "...", "L2": "...", "L3": "..." }
}
```

### `GET /api/graph/tree`
The same graph as a browsable tree: business outcomes (margin, quality per completion) and added metrics at the top,
then formula inputs, then possible causes. A metric reached a second time has `repeat: true` (show "see above").
```jsonc
{ "roots": ["margin", "quality_per_completion", "margin_per_signup"],
  "rows": [   // depth-first, render as an indented list
    { "depth": 0, "id": "margin", "label": "Contribution margin", "relation": null, "relation_label": null,
      "expr": "revenue - rewards", "unit": "USD/h", "origin": "core",
      "breakdown": "global → country → platform → offer category", "repeat": false },
    { "depth": 1, "id": "revenue", "label": "Advertiser revenue", "relation": "formula", "relation_label": "Formula", ... },
    { "depth": 2, "id": "completions", "label": "Completions", "relation": "mechanism", "relation_label": "Possible cause", ... }
  ],
  "edge_types": [ ... ] }   // same legend as /api/graph
```

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

### `GET /api/timeline`
What Argus knows, in time order. Built only from the public calendar, observed data and Argus's own decisions; never
from simulator ground truth (e.g. the true start of a bot farm).
```jsonc
{ "events": [
  { "t": 342, "time_label": "Mon 06:00", "kind": "planned",   "country": "DE", "label": "Planned: Weekend Boost (Casual games, Strategy games)" },
  { "t": 348, "time_label": "Mon 12:00", "kind": "anomaly",   "country": "CA", "label": "First unusual hour: new accounts on Android left the normal zone" },
  { "t": 350, "time_label": "Mon 14:00", "kind": "detected",  "country": "CA", "label": "Detected: Fake-account cluster in Canada (Android)" },
  { "t": 352, "time_label": "Mon 16:00", "kind": "approved",  "country": "CA", "label": "Approved: Verify new accounts" },
  { "t": 376, "time_label": "Tue 16:00", "kind": "verified",  "country": "CA", "label": "Prediction verified" }
] }
```
`kind`: `planned` | `anomaly` (= the incident's `left_zone_at`) | `detected` | `waiting` (data arrived incomplete) |
`approved` | `verified` (also when the prediction missed) | `explained`. Same-hour events are ordered as listed.

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
| `POST /api/metrics` | `{ "name": "margin_per_signup = margin / signups" }` (see below) | Automatic extension: `{ status, message, node, validation, placement?, monitoring?, note?, ambiguity? }` |
| `POST /api/what_if/launch` | `{ "country": "AR" }` (default `AR`) | Read-only forecast for entering a new country (see below) |
| `POST /api/demo/{scene}` | — | Deterministic (fixed seed) jump to a video scene; returns `{ scene, state, incident_id? }` |

Demo scenes, in order: `start`, `promo`, `bot_farm`, `investigate`, `approve`, `verify`, `new_metric`, `tracking_break`. Each scene advances the session world from wherever the previous scene left it (calling `start` resets).
Story clock: `start` Mon 01:00 · promo from 01:00, explained by 03:00 · bot farm from 03:00, leaves the normal zone
with the 04:00 data, detected at 06:00 · approve at 08:00 · verified Tue 08:00 · tracking break detected Tue 13:00.

Errors: `404 {detail}` for unknown incident / country / scene, `400 {detail}` for invalid input.

## Automatic extension: `POST /api/metrics`

Request (any of these forms):
```jsonc
{ "name": "margin_per_signup = margin / signups" }                       // name and formula in one line
{ "name": "margin_per_signup", "formula": "margin / signups" }           // separate fields
{ "name": "Start rate", "description": "how often users start an offer" } // words only: LLM or keyword rules propose the formula
```
Formulas use `+ - * / ( )`, numbers, metric ids (`new_accounts`, `active_users`, `impressions`, `starts`, `completions`,
`revenue`, `rewards`, `quality`, `margin`, `quality_per_completion`) or business words that map to exactly one metric
(`signups` → new_accounts, `profit` → margin, `views` → impressions, `payouts` → rewards, `dau` → active_users, …).

Response, always HTTP 200; branch on `status`:

| `status` | Meaning | UI |
|---|---|---|
| `added` | Placed, validated, monitored | show `note`, highlight the new node (`node.parents` are its formula edges) |
| `ambiguous` | A word maps to several metrics | show `message`, offer `ambiguity.suggested_formulas` as buttons that re-submit |
| `invalid` | Unknown metric (with "did you mean"), bad syntax, units that don't match, or undefined on the data | show `message` |
| `duplicate` | Same formula, or the same values on the data as an existing metric | show `message`, point at `node` |

```jsonc
// added
{ "status": "added", "message": "Added 'margin_per_signup' and started monitoring it.",
  "node": { "id": "margin_per_signup", "label": "margin_per_signup", "unit": "USD per new account", "kind": "ratio",
            "level": "L2", "parents": ["margin", "new_accounts"], "edge": "formula", "expr": "margin / new_accounts",
            "aggregation": "ratio", "origin": "extension", "confidence": 1.0, "note": "Added because ..." },
  "placement": { "parents": ["margin", "new_accounts"], "edge_type": "formula", "level": "L2",
                 "breakdown": ["global", "country", "platform"] },                  // dimensions shared by all inputs
  "validation": { "ok": true, "checks": [        // always in this order; the first failing check ends the flow
    { "name": "formula",       "ok": true, "detail": "margin_per_signup = margin / new_accounts (from your formula); read 'signups' as new_accounts" },
    { "name": "names",         "ok": true, "detail": "All inputs are known metrics: margin, new_accounts" },
    { "name": "dimensions",    "ok": true, "detail": "Units are consistent: result in USD per new account" },
    { "name": "duplicate",     "ok": true, "detail": "New metric: no existing metric has this formula or the same values on the data" },
    { "name": "holds_on_data", "ok": true, "detail": "Computed on 336 h of observed data at country × platform level: 100% of segment-hours defined; Canada last 24 h = 13.12 USD per new account" },
    { "name": "aggregation",   "ok": true, "detail": "Ratio: not additive. Country and global values are Σnumerator / Σdenominator (6.087), not the average of segments (6.159)" },
    { "name": "monitoring",    "ok": true, "detail": "Watched in 20 countries against its seasonal baseline (backtest error 5.8% per 3 h)" } ] },
  "monitoring": { "watched": true, "countries": 20, "baseline_error_pct": 5.8, "now": { "country": "US", "z": 1.3 },
                  "watched_series": 140 },
  "note": "Added because you asked for 'margin_per_signup'. Argus read it as margin / new_accounts ('signups' = new_accounts), placed it under contribution margin and new accounts as a formula edge, checked the units (USD per new account) and that it computes on 14 days of data, and now watches it in 20 countries as a ratio of sums." }

// ambiguous
{ "status": "ambiguous", "node": null,
  "message": "'users' is ambiguous: it could mean active users or new accounts. Pick one and add the metric again.",
  "ambiguity": { "term": "users", "candidates": ["active_users", "new_accounts"],
                 "suggested_formulas": ["margin / active_users", "margin / new_accounts"] },
  "validation": { "ok": false, "checks": [ ... ] } }

// invalid (examples of message)
"The units don't match: cannot add or subtract USD/h and completion per hour."
"Unknown metric 'revnue'. Did you mean revenue? Known metrics: active_users, completions, ..."

// duplicate
{ "status": "duplicate", "message": "On the data this is identical to the existing metric 'rewards': not added twice.",
  "node": { "id": "rewards", ... } }
```
After `added`, the metric appears in `GET /api/graph` (node + formula edges), `GET /api/graph/tree` (as a root),
`GET /api/state` → `added_metrics`, and `attention.watched_series` grows by 20.
The `new_metric` demo scene posts `margin_per_signup = margin / signups` and returns this response as `metric`.

## Enter a new country: `POST /api/what_if/launch`

Read-only: nothing in the session world changes. Request `{ "country": "AR" }`. The only candidate is `AR` (Argentina);
a watched country or an unknown code returns `400 {detail}`. The first call takes ~1 s; after that the result is cached
per seed (~5 ms), and only `fraud_risk` is recomputed (it adds bot-farm issues this session has seen in the neighbours).

For the UI, use the four plain-language lines `headline`, `learned_line`, `backtest_line` and `range_line`, and put
`country.lat/lng` on the globe.

```jsonc
{
  "country": { "iso": "AR", "name": "Argentina", "region": "Latin America", "lat": -38.4, "lng": -63.6,
               "ios_share": 0.1422, "gdp_per_capita_usd": 13970, "population": 45696159 },
  "horizon_days": 28,
  "margin_per_day_usd": { "p10": 2315, "p50": 4591, "p90": 9186 },      // day 28, standard settings (55% rewards)
  "margin_per_day_weekly_usd": [ { "p10": 985, "p50": 1928, "p90": 3937 }, ... ],  // 4 entries, users build up
  "margin_4w_total_usd": { "p10": 51528, "p50": 101488, "p90": 205643 },
  "best_offer_mix": [                                                   // top 3 categories by share of margin
    { "category": "Fintech apps", "margin_share": 0.297, "taste": 0.125 }, ... ],
  "best_reward": { "reward_share": 0.5, "current_share": 0.55, "uplift_usd_day": 106,
                   "grid": [ { "reward_share": 0.45, "margin_day_usd": 4686 }, ... ],   // 0.45 … 0.65
                   "note": "Starts respond to rewards as in past calendar promos ..." },
  "fraud_risk": { "level": "low" | "medium" | "high", "farm_chance_4w": 0.45, "expected_loss_usd_4w": 4099,
                  "farms_per_quarter_neighbours": { "MX": 1.8, "BR": 2.4, "TR": 1.6 },
                  "text": "Medium: about a 45% chance of a bot farm in the first 4 weeks, based on Mexico, Brazil, Türkiye",
                  "source": "simulated fraud history of the neighbours (plus bot-farm issues in this session)" },
  "learned_from": [ { "iso": "MX", "name": "Mexico", "weight": 0.66, "distance": 0.78 },
                    { "iso": "BR", "name": "Brazil", "weight": 0.24, "distance": 1.81 },
                    { "iso": "TR", "name": "Türkiye", "weight": 0.10, "distance": 2.66 } ],
  "assumptions": { "users_per_day_steady": 301892, "payout_level_vs_us": 0.103,
                   "adoption": "users build up as 1 - exp(-day/7)", "taste_start_elasticity": 0.141, "paths": 400 },
  "backtest": {
    "countries": [ { "country": "MX", "name": "Mexico", "learned_from": ["BR", "TR", "ES"],
                     "predicted_margin_day_usd": 14633, "range_usd": [7199, 32147], "true_margin_day_usd": 14637,
                     "error": -0.0, "inside_p10_p90": true }, ... ],       // 5 rows: MX, BR, TR, ZA, ES
    "median_abs_error": 0.143, "max_abs_error": 0.887, "typical_within_pct": 15, "within_pct": 89,
    "worst": { "country": "TR", "name": "Türkiye", "error": 0.887 },
    "inside_p10_p90": "5/5", "inside_count": 5, "n": 5,
    "method": "Each country is hidden in turn and predicted from the other 19 only, then compared with the simulator's true margin over the next 4 weeks (steady state, no launch ramp)."
  },
  "headline": "Launching in Argentina: about +$4,591 a day after 4 weeks",
  "learned_line": "Learned from Mexico, Brazil and Türkiye",
  "backtest_line": "Tested on 5 countries we know: typically within ±15% (worst Türkiye +89%), 5/5 inside the forecast range",
  "range_line": "Likely range $2,315–$9,186 a day (p10–p90)"
}
```

The backtest countries follow a fixed rule: the 5 watched countries most similar to the launch market. Over all 20
watched countries the median error is 34% and the truth lands inside p10–p90 for 16 of 20.
