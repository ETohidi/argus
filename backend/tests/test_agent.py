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


def test_potential_is_a_believable_uplift(world):
    pot = world.agent.potential
    assert len(pot) == 20
    for p in pot:
        assert 2.0 <= p["potential_pct"] <= 5.0, p
        assert p["potential_usd_day"] > 0 and p["top_categories"] and p["explain"]
    st = world.agent.state()["countries"][0]
    assert st["potential_pct"] == pot[0]["potential_pct"]


def test_severity_reflects_risk_not_hourly_impact():
    from argus.agent import Agent
    assert Agent._severity(114_000, 21) == "high"     # bot farm: big 7-day risk, chargebacks within a day
    assert Agent._severity(76_000, 0) == "high"       # tracking break: losses accrue now
    assert Agent._severity(12_000, 20) == "high"      # moderate risk but advertisers react soon
    assert Agent._severity(12_000, None) == "medium"
    assert Agent._severity(300, None) == "low"        # small blip
    assert Agent._severity(0, None) == "low"


def test_state_exposes_impact_and_risk(world):
    world.inject("tracking_break", "GB", "iOS")
    world._step_until_incident("GB", 10)
    s = world.agent.state()["incidents"][0]
    assert {"impact_usd_h", "risk_7d_usd", "reaction_h", "severity"} <= set(s)


def test_potential_story_differs_by_region(world):
    pot = {p["iso"]: p for p in world.agent.potential}
    firsts = {p["top_categories"][0] for p in pot.values()}
    assert len(firsts) >= 2
    assert pot["US"]["top_categories"][0] != pot["BR"]["top_categories"][0]
    assert pot["KR"]["demand_index"]["Strategy games"] > 1.3        # strong strategy-games audience
    assert pot["BR"]["demand_index"]["Surveys"] > pot["DE"]["demand_index"]["Surveys"]


def test_issue_card_is_plain_language(world):
    world.inject("bot_farm", "CA", "Android")
    inc = world._step_until_incident("CA", 10)
    card = world.agent.card(inc)
    assert set(card) == {"title", "looks_like", "at_stake_7d_usd", "what_happened", "why", "what_to_do", "status_line"}
    text = " ".join(str(v) for v in card.values())
    for jargon in ("z=", "σ", "sigma", "Shapley", "mechanism", "L1", "L2", "L3"):
        assert jargon not in text, jargon
    assert "growth" in card["looks_like"] and "explained" in card["why"] and card["status_line"] == "Needs a decision"
    assert card["at_stake_7d_usd"] == inc["risk_7d_usd"] > 0
    world.agent.approve(inc["id"], inc["recommended"])
    assert world.agent.card(inc)["status_line"] == "Fix applied · verifying"
    world.step(25)
    assert "Prediction verified" in world.agent.card(inc)["status_line"] or \
        "prediction verified" in world.agent.card(inc)["status_line"]


def test_issue_states_and_no_duplicates():
    w = World(seed=42)
    w.demo("bot_farm")
    inc = w._latest("CA")
    assert w.agent.incident_summary(inc)["status_label"] == "Open"
    w.step(30)                                                # nobody acts: one issue, alerts merged into it
    ca = [i for i in w.agent.incidents if i["country"] == "CA"]
    assert len(ca) == 1
    s = w.agent.incident_summary(inc)
    assert s["status_label"] == "Still going" and s["alerts_merged"] >= 10 and s["first_seen"] == "Mon 04:00"
    # the advertisers' chargebacks (revenue per completion drops on iOS fintech/strategy) are the farm's predicted
    # downstream effect: attached to this issue, not a new one
    ds = s["downstream"]
    assert ds and all(d["effect"] == "chargeback" and d["category"] in ("Fintech apps", "Strategy games") for d in ds)
    assert all(abs(d["after_h"] - d["predicted_after_h"]) <= 6 for d in ds)


def test_issue_resolves_by_itself_when_the_problem_stops():
    w = World(seed=42)
    w.demo("bot_farm")
    inc = w._latest("CA")
    for farm in w.reality.farms:                              # test only: the farm stops without any fix in Argus
        farm.stopped = True
    w.step(12)
    s = w.agent.incident_summary(inc)
    assert s["status_label"] == "Resolved" and inc["applied"] is None
    assert "Recovered without action" in inc["trail"][-1]["finding"]
    w.inject("bot_farm", "CA", "Android")                     # it comes back: a new issue that links to the old one
    new = w._step_until_incident("CA", 10)
    assert new is not None and new["recurrence_of"] == inc["id"]


def test_different_causes_in_one_country_are_separate_issues():
    w = World(seed=42)
    w.demo("bot_farm")
    w.inject("tracking_break", "CA", "iOS")                   # a second, unrelated problem in the same country
    w.step(12)
    ca = [i for i in w.agent.incidents if i["country"] == "CA"]
    assert len(ca) == 2
    farm = next(i for i in ca if i["platform"] == "Android")
    brk = next(i for i in ca if i["platform"] == "iOS")
    assert farm["family"] == "users" and farm["root"] == "new_accounts"
    assert brk["family"] == "revenue" and brk["root"] == "revenue" and brk["kind"] == "tracking"
    assert farm["alerts_merged"] >= 10                       # the farm's repeated alerts still merge into one issue
    assert brk["hypotheses"][0]["verdict"] == "supported"


def test_found_line_and_explained_line():
    from argus.agent import Agent
    from argus.world import World

    base = {"detected_at": 5}                                     # hour 5 ends at 06:00
    assert Agent.found_line({**base, "reaction_h": 22}) == \
        "Found by Argus at 06:00, nobody asked · advertisers would react in ~22 h"
    assert Agent.found_line({**base, "reaction_h": 0}) == "Found by Argus at 06:00, nobody asked · losses are happening now"
    assert Agent.found_line({**base, "reaction_h": None}) == "Found by Argus at 06:00, nobody asked"
    w = World(seed=42)
    w.demo("bot_farm")
    st = w.agent.state()
    inc = st["incidents"][0]
    assert inc["found_line"].startswith("Found by Argus at 06:00, nobody asked")
    assert w.agent.incident_detail(w.agent.incidents[0])["found_line"] == inc["found_line"]
    de = [e for e in st["explained"] if e["country"] == "DE"][0]
    assert de["change_pct"] > 0 and de["line"] == f"Germany +{de['change_pct']}% · planned promo, no alarm"
