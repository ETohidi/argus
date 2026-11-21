import json

import pytest
from fastapi.testclient import TestClient

from argus.api import app

client = TestClient(app)
H = {"X-Session": "api-test"}


def keys(d, expected):
    assert set(expected) <= set(d), f"missing {set(expected) - set(d)}"


def test_state_contract():
    r = client.post("/api/reset", headers=H)
    assert r.status_code == 200
    st = client.get("/api/state", headers=H).json()
    keys(st, ["clock", "countries", "incidents", "explained", "attention"])
    keys(st["clock"], ["t", "label"])
    assert len(st["countries"]) == 20
    c = st["countries"][0]
    keys(c, ["iso", "name", "lat", "lng", "status", "health_z", "kpis", "potential_usd_day"])
    keys(c["kpis"], ["new_accounts", "completions", "revenue", "rewards", "margin", "quality_per_completion"])
    assert c["status"] in ("ok", "watch", "incident", "explained", "waiting")
    keys(st["attention"], ["watched_series", "investigations", "l3_runs"])


def test_sessions_are_isolated():
    client.post("/api/reset", headers={"X-Session": "a"})
    client.post("/api/reset", headers={"X-Session": "b"})
    client.post("/api/step", json={"hours": 5}, headers={"X-Session": "a"})
    ta = client.get("/api/state", headers={"X-Session": "a"}).json()["clock"]["t"]
    tb = client.get("/api/state", headers={"X-Session": "b"}).json()["clock"]["t"]
    assert ta == tb + 5


def test_full_flow_and_incident_contract():
    S = {"X-Session": "flow"}
    out = client.post("/api/demo/bot_farm", headers=S).json()
    inc_id = out["incident_id"]
    assert inc_id
    d = client.get(f"/api/incidents/{inc_id}", headers=S).json()
    keys(d, ["id", "title", "status", "country", "platform", "category", "detected_at", "trail", "graph",
             "contributions", "hypotheses", "l3", "fixes", "recommended", "applied", "verification", "reports"])
    keys(d["trail"][0], ["t", "level", "action", "finding"])
    keys(d["graph"], ["nodes", "edges"])
    keys(d["graph"]["nodes"][0], ["id", "label", "z", "state"])
    keys(d["graph"]["edges"][0], ["source", "target", "type"])
    keys(d["contributions"][0], ["mechanism", "value_usd"])
    keys(d["hypotheses"][0], ["name", "explained", "verdict"])
    keys(d["l3"], ["summary", "points"])
    keys(d["l3"]["summary"], ["n_users", "n_flagged", "coherence_flagged", "coherence_others", "top_devices"])
    keys(d["l3"]["points"][0], ["coherence", "payout_focus", "flagged"])
    f = d["fixes"][0]
    keys(f, ["id", "name", "description", "days", "p10", "p50", "p90", "delta_p50_usd", "advertiser_risk"])
    assert f["days"] == [1, 2, 3, 4, 5, 6, 7]
    keys(d["verification"], ["status", "predicted", "actual"])
    keys(d["reports"], ["ceo", "manager", "engineer"])
    assert client.post(f"/api/incidents/{inc_id}/approve", json={"fix_id": "nope"}, headers=S).status_code == 400
    a = client.post(f"/api/incidents/{inc_id}/approve", json={"fix_id": d["recommended"]}, headers=S).json()
    assert a["applied"] == d["recommended"] and a["status"] == "fix_applied"
    assert client.get("/api/incidents/inc-99", headers=S).status_code == 404
    assert client.get("/api/incidents", headers=S).json()[0]["id"] == inc_id


def test_other_endpoints():
    g = client.get("/api/graph", headers=H).json()
    keys(g, ["nodes", "edges", "exogenous", "levels"])
    c = client.get("/api/country/ca", headers=H).json()
    keys(c, ["iso", "name", "segments"])
    assert len(c["segments"]) == 12
    keys(c["segments"][0], ["platform", "category", "kpi_z", "deviation_usd_h"])
    keys(c["segments"][0]["kpi_z"], ["new_accounts", "completions", "revenue", "rewards", "quality_per_completion"])
    keys(c["platforms"][0], ["platform", "new_accounts_z", "active_users_z", "new_accounts_h", "new_accounts_expected_h"])
    assert client.get("/api/country/XX", headers=H).status_code == 404
    p = client.get("/api/potential", headers=H).json()
    keys(p["countries"][0], ["iso", "potential_usd_day", "top_categories", "explain"])
    r = client.post("/api/inject", json={"type": "bot_farm", "country": "CA", "platform": "android"}, headers=H)
    assert r.status_code == 200 and r.json()["ok"]
    assert client.post("/api/inject", json={"type": "meteor", "country": "CA"}, headers=H).status_code == 400
    assert client.post("/api/inject", json={"type": "promo", "country": "ZZ"}, headers=H).status_code == 400
    m = client.post("/api/metrics", json={"name": "Reward cost per completed offer",
                                          "description": "= rewards / completions"}, headers=H).json()
    keys(m, ["node", "validation"])
    assert m["validation"]["ok"] and m["node"]["id"] == "reward_cost_per_completed_offer"
    assert client.post("/api/step", json={"hours": 0}, headers=H).status_code == 400
    assert client.post("/api/demo/nope", headers=H).status_code == 404


def test_demo_scenes_are_deterministic_and_serialisable():
    outs = []
    for sess in ("d1", "d2"):
        S = {"X-Session": sess}
        for scene in ("start", "promo", "bot_farm", "investigate", "approve", "verify", "new_metric",
                      "tracking_break"):
            r = client.post(f"/api/demo/{scene}", headers=S)
            assert r.status_code == 200, (scene, r.text)
        outs.append(json.dumps(r.json(), sort_keys=True))
    assert outs[0] == outs[1]
