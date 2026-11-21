"""Optional LLM access through an OpenAI-compatible endpoint.

Configured only through the environment (never commit keys):
  LLM_BASE_URL  e.g. https://api.studio.nebius.com/v1
  LLM_API_KEY
  LLM_MODEL
Every caller has a deterministic fallback, so Argus works without an LLM.
"""
from __future__ import annotations

import json
import os


def configured() -> bool:
    return all(os.environ.get(k) for k in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"))


def chat(system: str, user: str, timeout: float = 15.0) -> str | None:
    if not configured():
        return None
    try:
        import httpx

        resp = httpx.post(
            os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['LLM_API_KEY']}"},
            json={"model": os.environ["LLM_MODEL"], "temperature": 0.2,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001 - any failure falls back to templates
        return None


def chat_json(system: str, user: str) -> dict | None:
    text = chat(system + " Answer with a single JSON object and nothing else.", user)
    if not text:
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        out = json.loads(text[start: end + 1])
    except json.JSONDecodeError:
        return None
    return out if isinstance(out, dict) else None
