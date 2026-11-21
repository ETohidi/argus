import inspect

import pytest

import argus.agent as agent_mod
from argus.agent import keyword_formula
from argus.graph import MECHANISMS
from argus.world import World

KNOWN = set(MECHANISMS) | {"margin", "quality_per_completion"}


@pytest.fixture()
def world():
    return World(seed=42)


def test_agent_reads_reality_only_through_the_view():
    src = inspect.getsource(agent_mod)
    for forbidden in (".hidden", ".farms", ".breaks", "_bot", ".exposure"):
        assert forbidden not in src
    assert src.count("self._reality") == 6  # __init__ + t, observed, calendar, sample_users, apply


def test_samples_have_no_labels(world):
    users = world.view.sample_users(1, 1, 50)
    assert all(not any(k.startswith("_") for k in u) for u in users)


def test_data_delay_waits_without_alert(world):
    world.step(2)
    world.inject("data_delay", "FR")
    world.step(1)
    fr = next(c for c in world.agent.state()["countries"] if c["iso"] == "FR")
    assert fr["status"] == "waiting"
    world.step(4)
    assert not world.agent.incidents
    assert any(e["country"] == "FR" and "Late data" in e["event"] for e in world.agent.explained)


def test_promo_is_explained_not_an_incident(world):
    world.inject("promo", "DE")
    world.step(8)
    assert not world.agent.incidents
    e = [x for x in world.agent.explained if x["country"] == "DE"]
    assert e and abs(e[0]["naive_z"]) >= 4 and abs(e[0]["twin_z"]) < 4


def test_tracking_break_root_is_revenue_without_l3(world):
    world.inject("tracking_break", "GB", "iOS")
    inc = world._step_until_incident("GB", 10)
    assert inc is not None
    assert inc["root"] == "revenue" and inc["l3"] is None and inc["kind"] == "tracking"
    assert inc["recommended"] in ("pause_notify", "notify_advertiser")
    with pytest.raises(ValueError):
        world.agent.approve(inc["id"], "block_cluster")


def test_keyword_formula():
    assert keyword_formula("x", "reward cost per completed offer = rewards / completions", KNOWN)[0] == \
        "rewards / completions"
    assert keyword_formula("Reward cost per completed offer", "", KNOWN)[0] == "rewards / completions"
    assert keyword_formula("Start rate", "how often users start an offer", KNOWN)[0] == "starts / impressions"
    assert keyword_formula("Revenue per active user", "", KNOWN)[0] == "revenue / active_users"
    assert keyword_formula("Weather", "temperature in Berlin", KNOWN)[0] is None


def test_add_metric_is_validated_and_monitored(world):
    out = world.agent.add_metric("Reward cost per completed offer", "rewards / completions per offer")
    assert out["validation"]["ok"], out
    node = out["node"]
    assert node["aggregation"] == "ratio" and node["parents"] == ["rewards", "completions"]
    assert world.agent.state()["attention"]["watched_series"] == 20 * 7
    dup = world.agent.add_metric("Reward cost again", "= rewards / completions")
    assert not dup["validation"]["ok"]
    bad = world.agent.add_metric("Bad", "= rewards / weather")
    assert not bad["validation"]["ok"]
