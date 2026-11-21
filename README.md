# Argus

**A self-driving analyst that lives inside a hierarchical, causal digital twin of a rewarded-ad marketplace.**
HackLab #2 Berlin Robotics & AI Hackathon, Almedia track ("Eye of the System"), 21–22 Nov 2026.

Argus watches every metric of a Freecash-like marketplace, finds the broken link in the causal graph, proves the cause with a counterfactual in the twin, tests fixes in the twin before acting, and explains it to the CEO, the manager and the engineer, on a 3D globe.

Status: work in progress. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for the design and the build plan.

## Run the backend
```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q          # unit + end-to-end demo tests
.venv/bin/uvicorn argus.api:app --reload --port 8000
```
API contract: [`docs/API.md`](docs/API.md). Jump to a video scene with `POST /api/demo/{scene}`
(`start`, `promo`, `bot_farm`, `investigate`, `approve`, `verify`, `new_metric`, `tracking_break`).
Optional LLM (OpenAI-compatible): set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; deterministic templates otherwise.

## Run in Docker (frontend + API on one port)
```bash
docker build -t argus .
docker run -p 7860:7860 argus            # open http://localhost:7860
# optional LLM reports: add -e LLM_BASE_URL=... -e LLM_API_KEY=... -e LLM_MODEL=...
```
Port 7860 matches Hugging Face Spaces (Docker SDK). Secrets are never baked into the image.
