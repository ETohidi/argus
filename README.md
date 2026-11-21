# Argus

**A self-driving analyst that lives inside a causal digital twin of a rewarded-ad marketplace.**
HackLab #2 Berlin Robotics & AI Hackathon, Almedia track ("Eye of the System"), 21–22 Nov 2026.

Rewarded-ad marketplaces like Freecash move fast: a bot farm looks like growth, a broken advertiser postback looks
like a dip, a planned promo looks like an anomaly. Argus watches 20 countries × 6 KPIs every hour against a digital
twin that learned the business from 14 days of data. When something breaks, it localises the problem (country →
platform × offer category → individual users), walks the causal graph to separate root cause from symptoms, **proves
the cause with a counterfactual in the twin**, fast-forwards every candidate fix 7 days before touching anything,
recommends one, and — after a human clicks Approve — checks 24 h later whether its prediction came true. Each
incident is explained three ways: a plain issue card for the CEO, an action plan for the manager, and the
z-scores, Shapley contributions and query trail for the engineer.

**Try it live: https://argus-cmlk.onrender.com** (first load may take ~50 s on the free tier while the container wakes up).

## Architecture

```mermaid
flowchart TB
    R["Reality (simulator)"]
    subgraph T["Twin"]
        direction LR
        L1["L1 Business"] --> L2["L2 Segment"] --> L3["L3 Users"]
    end
    subgraph A["Agent loop"]
        direction LR
        D["Detect"] --> LO["Localise"] --> P["Prove cause"] --> F["Test fixes"] --> AP["Approve"] --> V["Verify"]
    end
    W["Views: globe · issue card · evidence"]
    R -->|hourly metrics| T
    T --> A
    A --> W
```

Approved fixes are applied back to Reality, and the next hours of data show whether they worked.

Design notes and the original build plan: [`docs/HANDOFF.md`](docs/HANDOFF.md); API contract: [`docs/API.md`](docs/API.md).

Argus never reads the simulator's hidden state (bot labels, farms, breaks); a test enforces it. It sees only the
observed metric stream, the public marketing calendar, unlabeled user samples and the actions it applied.

## What is real vs simulated

- **Real (public data, cited):** scale ($1B run rate → $2.74M revenue/day), each country's share of user payouts
  (US 57.9%, DE 9.7%, GB 8.2%, CA 3.7%, FR 3.2%), iOS share per country (StatCounter, Oct 2026), country payout
  levels and the iOS premium (AppsFlyer CPI benchmarks, Q3 2026). See [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
  and the in-app Data panel (`GET /api/meta`).
- **Simulated:** offer categories and conversion rates, taste archetypes and regional mixes, the production feed,
  noise, the incidents, advertiser reactions and fix effects. See [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).
- No private Almedia data is used.

## Technical approach

Plain numpy and a ridge regression: no deep learning, no learned causal structure. The graph is specified from how the
business works; the twin learns its parameters from 14 days of observed data. Code paths are in `backend/argus/`.

| Method | What it means here | Where |
|---|---|---|
| **Autonomous agent with a causal world model** | Every simulated hour the agent observes, detects, investigates and recommends, using the twin as its model of the business | `agent.py` `Agent.on_hour`, `twin.py` `Twin` |
| **Structural causal model (SCM)** | Hand-specified DAG: new accounts → active users → impressions → starts → completions → revenue / rewards / quality; each mechanism is a learned ratio with log-normal noise, plus calendar and action effects | `graph.py` `MetricGraph`, `twin.py` `Twin.learn`, `Twin.factors` |
| **Causal root-cause analysis (residual given parents)** | Each mechanism's observed child is compared with its expectation *given its observed parents*; the root is the most upstream mechanism with abs(z) > 3, downstream deviations that are normal given their parents are symptoms | `twin.py` `Twin.given_parents`, `agent.py` `Agent.investigate` (DAG walk) |
| **Counterfactual simulation / interventions (do-operator)** | Proof: replay the window with do(cause mechanisms := twin baseline) while every other mechanism keeps its observed residual; explained share = removed change / total change (absolute) | `twin.py` `Twin.chain`, `Twin.explained_share`, `agent.py` `Agent.counterfactual` |
| **Exact Shapley-value attribution** | Δmargin split across the 8 mechanisms of the root segment by evaluating all 2^8 coalitions | `twin.py` `Twin.shapley` |
| **Monte Carlo scenario rollouts (simulation-in-the-loop)** | Every candidate fix is run 7 days ahead, 40 paths each, with common random numbers so options are compared on the same futures; includes the advertiser-reaction model | `twin.py` `Twin.fast_forward`, `agent.py` `Agent._fixes` |
| **Uncertainty quantification, prediction intervals** | Leave-one-out backtest σ per country × KPI × time of day (inflated ×1.3 out of sample); ±2σ normal-zone bands; p10/p50/p90 for every fix and for paired deltas vs doing nothing | `twin.py` `Twin.learn` (`l1_sigma`), `agent.py` `Agent.series`, `Twin.fast_forward` |
| **Multi-fidelity hierarchical digital twin, adaptive fidelity** | L1 business (country KPIs), L2 segment (platform × offer category mechanisms), L3 users (on demand). The agent descends to L3 only when impact × uncertainty is high: root on the user side and impact ≥ $50/h | `twin.py` `Twin.l1_z` / `given_parents`, `taste.py`, `agent.py` `Agent.investigate` |
| **Closed-loop self-calibration** | 24 h after an approved fix, actual margin is compared with the predicted band; a miss widens that country's uncertainty (×1.2) | `agent.py` `Agent._verify` |
| **Human-on-the-loop approval** | Argus recommends; nothing touches the marketplace until a person approves a fix | `agent.py` `Agent.approve`, `POST /api/incidents/{id}/approve` |
| **Agent trace** | Every investigation records its steps (L1 → L2 → L3 → hypotheses → fixes → approval → verification) | incident `trail`, `GET /api/timeline` |
| **Grounded generation** | The LLM only rewrites tool results: it receives the facts as JSON, and every number in its output is checked against them; any unmatched number → deterministic template instead | `llm.py`, `agent.py` `Agent._llm_reports`, `ungrounded_numbers` |
| **Evaluation harness** | Seeds × injected faults (promo, bot farm, tracking break, data delay); detection latency, explained share, recommended fix, verification, false alarms in clean weeks | `argus/evaluate.py` (`python -m argus.evaluate`), `tests/test_e2e.py` |
| **Tool interface for other agents (MCP)** | The twin's state, explanations, fix rollouts and sandboxed what-ifs as Model Context Protocol tools (stdio, JSON-RPC) | `argus/mcp_server.py` (`python -m argus.mcp_server`) |
| **Taste coherence as a behavioural-consistency anomaly signal** | Real people's completions match the tastes their life signals predict; fake accounts don't. Low coherence + payout focus + shared devices form the fraud cluster | `taste.py` `TasteModel.score_users` |

Latest harness run (seeds 42, 1–8): bot farm detected 9/9 in 3–4 h, 88–99% explained, all predictions verified;
tracking break 9/9 in 3–4 h; 0 false incidents in 9 clean weeks.

## Demo scenes

The **Demo** menu in the top bar (or `POST /api/demo/{scene}`) jumps a fixed-seed world to each part of the story;
calling a later scene first runs the earlier ones.

| Scene | What happens |
|---|---|
| `start` | Fresh world after 14 days of history; the globe is green, 20 countries × 6 KPIs watched |
| `promo` | Planned "Weekend Boost" in Germany: a naive detector alerts, Argus logs it as explained by the calendar |
| `bot_farm` | Fake accounts on Android in Canada from Mon 03:00: revenue goes *up*; sign-ups leave the normal zone at 04:00 and Argus opens a high-severity incident at 06:00, three hours in |
| `investigate` | Decision trail: country → Android × fintech/strategy → root cause new accounts → user-level taste check → counterfactual (~94% explained) |
| `approve` | Human approves the recommended fix (verify new accounts); Canada returns to green within ~2 h |
| `verify` | 24 h later: actual margin lands inside the predicted band → "Prediction verified" |
| `new_metric` | "Reward cost per completed offer" is added in plain words, validated and monitored |
| `tracking_break` | Advertisers stop confirming UK iOS game completions: root cause revenue, no user-level run needed, pause + notify |

Keyboard shortcuts (**coming**): `1`–`8` jump to the scenes above and `Space` plays/pauses. They arrive with the
frontend redesign currently in progress; until then the Demo menu and the top-bar controls (play, +1 h, +6 h, inject,
add metric) drive everything.

## Honest limitations

- **The marketplace is simulated.** Scale, country mix, platform split and payout levels are calibrated to public
  figures; conversion rates, taste, incidents and advertiser behaviour are invented. Numbers are illustrative, not
  forecasts for Almedia.
- **Incidents are injected**, and the twin was designed with these failure modes in mind; unknown failure types would
  surface as "anomaly, cause unclear" rather than a confident diagnosis.
- **Fix effects in the twin are assumptions** (e.g. verification removes 95% of fake activity), validated only against
  the simulator. Verification after 24 h checks the prediction, not the assumption.
- **Potential mode is conservative and model-dependent:** the twin shows +2–3.5% margin from a taste-matched feed;
  the simulator's truth for the same feed is higher, because the twin's taste model is flatter than reality.
- **One country can carry one open incident at a time**; overlapping causes in the same country are not separated.
- **Free-tier hosting:** sessions live in memory (up to 13, idle expiry 30 min, LRU eviction); a restart resets them.
- LLM-written reports are optional; without a key Argus uses deterministic templates.

## Run the backend
```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q          # unit + end-to-end demo tests
.venv/bin/uvicorn argus.api:app --reload --port 8000
./run_demo_server.sh                   # for video recording: port 8000, no --reload
```
API contract: [`docs/API.md`](docs/API.md). Jump to a video scene with `POST /api/demo/{scene}`
(`start`, `promo`, `bot_farm`, `investigate`, `approve`, `verify`, `new_metric`, `tracking_break`).
Optional LLM (OpenAI-compatible): set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; deterministic templates otherwise.

## Use the twin from other agents (MCP)

Argus also runs as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, so any MCP client
(Claude Desktop, Claude Code, other agents) can query and stress-test the twin. No extra dependency: the server is
plain JSON-RPC on the standard library.

```bash
cd backend && .venv/bin/python -m argus.mcp_server      # stdio; logs on stderr
```

| Tool | What it does |
|---|---|
| `get_world_state` | Clock, countries that are not healthy, open incidents with issue cards, explained changes |
| `explain_incident(id)` | Root cause, counterfactual proof, decision trail, hypotheses, fixes, engineer report |
| `simulate_fix(id, fix)` | 7-day Monte Carlo rollout of one fix vs doing nothing (read-only) |
| `what_if(country, change, platform?, hours?)` | Sandbox copy of the world: inject `promo` / `bot_farm` / `tracking_break` / `data_delay`, run it forward, report what Argus detects and the margin difference |
| `advance_time(hours)`, `run_demo_scene(scene)` | Drive the simulation |

Approving fixes is deliberately not exposed: changing the marketplace stays a human decision in the UI.

Claude Desktop (`claude_desktop_config.json`), with your own path:
```json
{
  "mcpServers": {
    "argus": {
      "command": "/path/to/argus/backend/.venv/bin/python",
      "args": ["-m", "argus.mcp_server"],
      "env": { "PYTHONPATH": "/path/to/argus/backend", "ARGUS_MCP_SCENE": "bot_farm" }
    }
  }
}
```
`ARGUS_MCP_SCENE` is optional (start from a demo scene); `ARGUS_SEED` picks the world. Claude Code:
`claude mcp add argus -e PYTHONPATH=/path/to/argus/backend -- /path/to/argus/backend/.venv/bin/python -m argus.mcp_server`.

## Run in Docker (frontend + API on one port)
```bash
docker build -t argus .
docker run -p 7860:7860 argus            # open http://localhost:7860
# optional LLM reports: add -e LLM_BASE_URL=... -e LLM_API_KEY=... -e LLM_MODEL=...
```
Port 7860 matches Hugging Face Spaces (Docker SDK). Secrets are never baked into the image.

## Deploy on Render
1. Push this repo to GitHub (done: `ETohidi/argus`).
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates one free web service
   (Docker runtime, root `Dockerfile`, health check `/api/health`).
3. When prompted, paste `LLM_API_KEY` (marked `sync: false`, so it lives only in Render). `LLM_BASE_URL` and `LLM_MODEL`
   are preset; leave the key empty to run with template reports.
4. Open the service URL: the globe is served at `/`, the API at `/api`. Render sets `$PORT`; uvicorn listens on it.

Free instances sleep when idle; the first request after a pause takes ~30–60 s (the world is rebuilt per session).
