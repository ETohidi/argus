"""Enter a new country: transfer forecast, plain-language fields, and the hold-out backtest."""
import pytest
from fastapi.testclient import TestClient

from argus import config as cfg
from argus import launch as L
from argus.api import app


def test_launch_argentina_forecast_and_fields():
    r = L.launch("AR", 42)
    assert "AR" not in cfg.ISO_INDEX
    m = r["margin_per_day_usd"]
    assert 0 < m["p10"] < m["p50"] < m["p90"]
    weeks = [w["p50"] for w in r["margin_per_day_weekly_usd"]]
    assert len(weeks) == 4 and weeks == sorted(weeks)                    # users build up over the 4 weeks
    assert len(r["best_offer_mix"]) == 3 and r["best_offer_mix"][0]["margin_share"] >= r["best_offer_mix"][2]["margin_share"]
    assert {x["category"] for x in r["best_offer_mix"]} <= set(cfg.CATEGORIES)
    assert r["best_reward"]["reward_share"] in L.REWARD_GRID
    assert r["fraud_risk"]["level"] in ("low", "medium", "high") and 0 < r["fraud_risk"]["farm_chance_4w"] < 1
    lf = r["learned_from"]
    assert 2 <= len(lf) <= 3 and abs(sum(x["weight"] for x in lf) - 1) < 0.02
    assert all(x["iso"] in cfg.ISO_INDEX for x in lf) and lf[0]["iso"] == "MX"   # Spanish-speaking, same income
    assert r["headline"].startswith("Launching in Argentina: about +$") and "a day after 4 weeks" in r["headline"]
    assert r["learned_line"].startswith("Learned from Mexico")
    assert r["backtest_line"].startswith("Tested on 5 countries we know: typically within ±")


def test_launch_backtest_is_honest_and_calibrated():
    bt = L.launch("AR", 42)["backtest"]
    assert bt["n"] == 5 and len(bt["countries"]) == 5
    for row in bt["countries"]:
        assert row["country"] not in row["learned_from"]                     # held out: never learns from itself
        assert row["true_margin_day_usd"] > 0
    assert bt["median_abs_error"] <= 0.25                                    # typical error on similar countries
    assert bt["inside_count"] >= 4                                           # truth mostly inside p10-p90
    # over all 20 watched countries the p10-p90 range should hold the truth roughly 80% of the time
    full = L.backtest([c.iso for c in cfg.COUNTRIES], 42)
    assert 13 <= full["inside_count"] <= 20 and full["median_abs_error"] <= 0.5


def test_launch_rejects_watched_or_unknown_country():
    with pytest.raises(ValueError):
        L.launch("MX")
    with pytest.raises(ValueError):
        L.launch("ZZ")


def test_launch_api():
    client = TestClient(app)
    r = client.post("/api/what_if/launch", json={"country": "AR"}, headers={"X-Session": "launch-test"})
    assert r.status_code == 200
    d = r.json()
    for k in ("headline", "learned_line", "backtest_line", "range_line", "margin_per_day_usd", "best_offer_mix",
              "best_reward", "fraud_risk", "learned_from", "backtest", "country"):
        assert k in d
    assert client.post("/api/what_if/launch", json={"country": "DE"}, headers={"X-Session": "launch-test"}).status_code == 400
