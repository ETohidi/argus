"""Forward-looking scenario: launch the marketplace in a country Argus does not watch yet.

Transfer learning from the most similar watched countries, then a 4-week Monte Carlo in the twin's terms:

  similarity   public features only: GDP per capita, Android share, region, language (World Bank, StatCounter)
  taste        the taste model scores sampled users of each neighbour; the launch market gets their weighted mix
  users        active-user-hours per capita, transferred from the neighbours (weighted geometric mean)
  payout level log(value) ~ log(GDP per capita) across watched countries, plus the neighbours' residual
  start rate   learned across watched countries: log(starts/impression) = base_k + γ·log(taste_k / feed share_k)
  finishing    completions per start and margin per completion (per platform × category) from the neighbours

Backtest: hold out watched countries one at a time, predict them from the other 19 only, and compare with the
simulator's true margin over the next 4 weeks. Everything is learned from the twin's 14-day learning window
(the same clean history the twin learns from), so the forecast is deterministic per seed and cached.
"""
from __future__ import annotations

import numpy as np

from . import config as cfg

WEEKS = 4
DAYS = WEEKS * 7
N_PATHS = 400
ADOPTION_DAYS = 7.0      # simulated: launch users build up as 1 - exp(-day / 7); ~98% of steady state on day 28
PROMO_START_ELASTICITY = float(np.log(1.30) / np.log(0.70 / cfg.REWARD_SHARE))  # calendar promos: 70% share -> +30% starts
REWARD_GRID = [0.45, 0.50, 0.55, 0.60, 0.65]

# public: World Bank WDI 2024 (NY.GDP.PCAP.CD in current USD, SP.POP.TOTL), fetched 21 Nov 2026.
GDP_PC = {"US": 86170, "CA": 55016, "MX": 13988, "BR": 10311, "GB": 53341, "DE": 56104, "FR": 46103, "NL": 67465,
          "ES": 35327, "IT": 40430, "PL": 25104, "SE": 57223, "TR": 15893, "ZA": 6267, "IN": 2592, "ID": 4925,
          "PH": 3985, "JP": 33797, "KR": 36239, "AU": 64610, "AR": 13970}
POPULATION = {"US": 340_003_797, "CA": 41_262_329, "MX": 130_861_007, "BR": 211_998_573, "GB": 69_281_000,
              "DE": 83_516_593, "FR": 68_551_653, "NL": 17_993_485, "ES": 48_848_840, "IT": 58_952_704,
              "PL": 36_559_233, "SE": 10_569_709, "TR": 85_518_661, "ZA": 64_007_187, "IN": 1_450_935_791,
              "ID": 283_487_931, "PH": 115_843_670, "JP": 123_975_371, "KR": 51_751_065, "AU": 27_194_286,
              "AR": 45_696_159}
# public: main language (ISO 639-1); "family" groups Romance and Germanic languages for a partial match.
LANGUAGE = {"US": "en", "CA": "en", "MX": "es", "BR": "pt", "GB": "en", "DE": "de", "FR": "fr", "NL": "nl",
            "ES": "es", "IT": "it", "PL": "pl", "SE": "sv", "TR": "tr", "ZA": "en", "IN": "en", "ID": "id",
            "PH": "en", "JP": "ja", "KR": "ko", "AU": "en", "AR": "es"}
FAMILY = {"es": "romance", "pt": "romance", "it": "romance", "fr": "romance", "en": "germanic", "de": "germanic",
          "nl": "germanic", "sv": "germanic"}
# Launch candidates (not among the 20 watched). public: StatCounter mobile OS share, October 2026.
CANDIDATES = {"AR": {"iso": "AR", "name": "Argentina", "ios_share": 0.1422, "region": "Latin America", "tz": -3,
                     "lat": -38.4, "lng": -63.6}}
# simulated: fraud history of the watched countries = bot-farm incidents per quarter before the demo
# (invented; Latin America and Asia see more emulator farms on Android). Session incidents are added on top.
FARMS_PER_QUARTER = {"US": 1.2, "CA": 0.6, "MX": 1.8, "BR": 2.4, "GB": 0.7, "DE": 0.5, "FR": 0.6, "NL": 0.3,
                     "ES": 0.8, "IT": 0.7, "PL": 0.9, "SE": 0.2, "TR": 1.6, "ZA": 1.5, "IN": 3.0, "ID": 2.6,
                     "PH": 2.2, "JP": 0.3, "KR": 0.4, "AU": 0.4}
FARM_LOSS_DAYS = 2.0     # simulated: a farm costs ~2 days of the country's margin before it is caught and cleaned up
BACKTEST_DEFAULT = 5
SIGMA_FLOOR = 0.05

_CACHE: dict[int, dict] = {}
_LAUNCH: dict[tuple[str, int], dict] = {}


def _features(iso: str) -> dict:
    if iso in cfg.ISO_INDEX:
        c = cfg.COUNTRIES[cfg.ISO_INDEX[iso]]
        return {"iso": iso, "name": c.name, "ios_share": c.ios_share, "region": c.region, "tz": c.tz}
    return dict(CANDIDATES[iso])


def distance(a: str, b: str) -> float:
    fa, fb = _features(a), _features(b)
    d = abs(np.log(GDP_PC[a] / GDP_PC[b])) / 0.5                    # a factor 1.65 in income = 1
    d += abs(fa["ios_share"] - fb["ios_share"]) / 0.15              # 15 points of Android share = 1
    d += 0.0 if fa["region"] == fb["region"] else 1.0
    la, lb = LANGUAGE[a], LANGUAGE[b]
    d += 0.0 if la == lb else (0.4 if FAMILY.get(la, la) == FAMILY.get(lb, lb) else 0.8)
    return float(d)


def neighbours(iso: str, pool: list[str], k: int = 3) -> list[tuple[str, float]]:
    ds = sorted((distance(iso, n), n) for n in pool if n != iso)[:k]
    w = np.exp(-np.array([d for d, _ in ds]))
    w /= w.sum()
    return [(n, float(x)) for (_, n), x in zip(ds, w)]


# ---------------------------------------------------------------------------------------------- learned stats
def _learn(seed: int) -> dict:
    """Per-country stats from the twin's learning window, plus the simulator's true next 4 weeks (backtest only)."""
    if seed in _CACHE:
        return _CACHE[seed]
    from .reality import Reality
    from .world import taste_model

    r = Reality(seed=seed)
    r.run(cfg.HISTORY_HOURS)
    obs = r.observed[: cfg.HISTORY_HOURS]
    days = cfg.HISTORY_HOURS / 24
    S = lambda k: np.sum([o[k] for o in obs], axis=0)  # noqa: E731
    act, imp, st, co = S("active_users"), S("impressions"), S("starts"), S("completions")
    marg = S("revenue") - S("rewards")
    rev = S("revenue")
    tm = taste_model()
    taste = np.zeros((cfg.C, cfg.K))
    for c in range(cfg.C):
        share = np.array([cfg.COUNTRIES[c].ios_share, 1 - cfg.COUNTRIES[c].ios_share])
        taste[c] = sum(share[p] * tm.country_demand(r.sample_users(c, p, 600)) for p in range(cfg.P))
    stats = {
        "taste": taste,                                                        # (C,K) taste-model demand
        "users_pc": act.sum(1) / days / np.array([POPULATION[c.iso] for c in cfg.COUNTRIES]),  # user-hours/day/capita
        "imp_per_user": imp.sum((1, 2)) / act.sum(1),                          # (C,)
        "feed": imp.sum(1) / imp.sum((1, 2))[:, None],                         # (C,K) impression shares
        "sr": st.sum(1) / imp.sum(1),                                          # (C,K) starts per impression
        "cr": co / st,                                                         # (C,P,K)
        "mpc": marg / co,                                                      # (C,P,K) margin per completion
        "margin_share_of_rev": marg.sum((1, 2)) / rev.sum((1, 2)),
        "rev_per_comp_android": rev[:, 1] / co[:, 1],                          # (C,K)
    }
    # payout level seen in the data: Android revenue per completion vs. the offer list price (US Android)
    stats["value"] = np.median(stats["rev_per_comp_android"] / (cfg.PAYOUT * cfg.ACCEPTANCE), axis=1)
    stats["day_margin_hist"] = marg.sum((1, 2)) / days
    r.run(DAYS * 24)                                                           # ground truth for the backtest only
    fut = r.true[cfg.HISTORY_HOURS:]
    stats["true_day_margin"] = np.sum([(x["revenue"] - x["rewards"]).sum((1, 2)) for x in fut], axis=0) / DAYS
    _CACHE[seed] = stats
    return stats


def _wmean_log(vals: np.ndarray, w: np.ndarray) -> tuple[float, float]:
    lv = np.log(vals)
    m = float(np.sum(w * lv))
    return m, max(float(np.sqrt(np.sum(w * (lv - m) ** 2))), SIGMA_FLOOR)


def _loo_sigma(st: dict, pool: list[str]) -> tuple[float, float]:
    """Out-of-sample error of the two transferred scale inputs (users per capita, payout level), measured by hiding
    each pool country in turn. Used as the forecast's spread, so the p10-p90 range is calibrated, not hopeful."""
    eu, ev = [], []
    for h in pool:
        rest = [p for p in pool if p != h]
        nb = neighbours(h, rest)
        ni = np.array([cfg.ISO_INDEX[n] for n, _ in nb])
        w = np.array([x for _, x in nb])
        eu.append(_wmean_log(st["users_pc"][ni], w)[0] - np.log(st["users_pc"][cfg.ISO_INDEX[h]]))
        lg = np.log([GDP_PC[p] for p in rest])
        lv = np.log(st["value"][[cfg.ISO_INDEX[p] for p in rest]])
        b, a = np.polyfit(lg, lv, 1)
        res = {p: lv[i] - (a + b * lg[i]) for i, p in enumerate(rest)}
        pred = a + b * np.log(GDP_PC[h]) + sum(x * res[n] for n, x in nb)
        ev.append(pred - np.log(st["value"][cfg.ISO_INDEX[h]]))
    rms = lambda e: max(float(np.sqrt(np.mean(np.square(e)))), SIGMA_FLOOR)  # noqa: E731
    return rms(eu), rms(ev)


def predict(iso: str, seed: int = 42, pool: list[str] | None = None, reward_share: float = cfg.REWARD_SHARE,
            n: int = N_PATHS, ramp: bool = True) -> dict:
    """4-week Monte Carlo forecast for `iso`, learning only from `pool` (watched countries, target excluded)."""
    st = _learn(seed)
    pool = [c.iso for c in cfg.COUNTRIES if c.iso != iso] if pool is None else [p for p in pool if p != iso]
    idx = np.array([cfg.ISO_INDEX[p] for p in pool])
    nb = neighbours(iso, pool)
    ni = np.array([cfg.ISO_INDEX[n] for n, _ in nb])
    w = np.array([x for _, x in nb])
    f = _features(iso)
    share = np.array([f["ios_share"], 1 - f["ios_share"]])
    rng = np.random.default_rng([seed, 7041, sum(map(ord, iso))])

    u_loo, v_loo = _loo_sigma(st, pool)
    # taste: weighted taste-model demand of the neighbours
    taste = (w[:, None] * st["taste"][ni]).sum(0)
    taste /= taste.sum()
    # users: active-user-hours per capita
    u_m, _ = _wmean_log(st["users_pc"][ni], w)
    u_s = u_loo
    # payout level: log value = a + b log GDP over the pool, plus the neighbours' weighted residual
    lg = np.log([GDP_PC[p] for p in pool])
    lv = np.log(st["value"][idx])
    b, a = np.polyfit(lg, lv, 1)
    resid = lv - (a + b * lg)
    res_n = np.array([resid[pool.index(n)] for n, _ in nb])
    v_m = a + b * np.log(GDP_PC[iso]) + float(np.sum(w * res_n))
    v_s = v_loo
    # start rate: log sr = base_k + γ log(taste / feed), fitted over the pool
    X = np.log(st["taste"][idx] / st["feed"][idx])                           # (n,K)
    Y = np.log(st["sr"][idx])
    Xc, Yc = X - X.mean(0), Y - Y.mean(0)
    gamma = float(np.sum(Xc * Yc) / np.sum(Xc * Xc))
    base = Y.mean(0) - gamma * X.mean(0)
    sr_s = max(float(np.std(Yc - gamma * Xc)), SIGMA_FLOOR)
    # feed: the production rule (taste × payout^1.1), applied to the predicted taste
    feed = taste * cfg.PAYOUT ** 1.1
    feed /= feed.sum()
    ipu = float(np.exp(np.sum(w * np.log(st["imp_per_user"][ni]))))
    cr = np.exp((w[:, None, None] * np.log(st["cr"][ni])).sum(0))             # (P,K)
    # margin per completion per unit of payout level, at the target reward share
    mpc_unit = (w[:, None, None] * (st["mpc"][ni] / st["value"][ni][:, None, None])).sum(0)
    rpc_unit = cfg.PAYOUT[None, :] * cfg.PLATFORM_PAYOUT[:, None] * cfg.ACCEPTANCE
    rew_unit = rpc_unit / cfg.ACCEPTANCE - mpc_unit                           # reward cost per completion / value
    rew_unit_rs = rew_unit * reward_share / cfg.REWARD_SHARE
    mpc_unit_rs = rpc_unit - rew_unit_rs
    start_mult = (reward_share / cfg.REWARD_SHARE) ** PROMO_START_ELASTICITY

    pop = POPULATION[iso]
    users = np.exp(u_m + u_s * rng.standard_normal(n)) * pop                  # user-hours/day at steady state
    value = np.exp(v_m + v_s * rng.standard_normal(n))
    sr = np.exp(base[None, :] + gamma * np.log(taste / feed)[None, :] + sr_s * rng.standard_normal((n, cfg.K)))
    sr *= start_mult
    per_user_k = ipu * feed[None, :] * sr                                     # starts per user-hour (n,K)
    comp = per_user_k[:, None, :] * cr[None, :, :] * share[None, :, None]     # completions per user-hour (n,P,K)
    m_user = (comp * mpc_unit_rs[None]).sum((1, 2)) * value                   # margin per user-hour
    day_steady = users * m_user
    noise = np.exp(0.03 * rng.standard_normal((n, DAYS)))
    adopt = (1 - np.exp(-np.arange(1, DAYS + 1) / ADOPTION_DAYS)) if ramp else np.ones(DAYS)
    daily = day_steady[:, None] * adopt[None, :] * noise
    by_cat = (comp * mpc_unit_rs[None]).sum(1).mean(0)                        # margin per user-hour by category
    q = lambda x: {"p10": float(np.percentile(x, 10)), "p50": float(np.percentile(x, 50)),  # noqa: E731
                   "p90": float(np.percentile(x, 90))}
    return {"iso": iso, "neighbours": nb, "sigma_users": u_s, "sigma_value": v_s, "taste": taste, "feed": feed, "gamma": gamma,
            "users_per_day": float(np.median(users)), "value": float(np.exp(v_m)),
            "day_last": q(daily[:, -1]), "day_avg": q(daily.mean(1)), "total": q(daily.sum(1)),
            "weekly": [q(daily[:, 7 * i:7 * (i + 1)].mean(1)) for i in range(WEEKS)],
            "margin_share_by_category": by_cat / by_cat.sum(), "margin_per_user_hour": float(np.median(m_user))}


def backtest_countries(iso: str, k: int = BACKTEST_DEFAULT) -> list[str]:
    """Rule fixed in advance: the k watched countries most similar to the launch market."""
    return [n for _, n in sorted((distance(iso, c.iso), c.iso) for c in cfg.COUNTRIES)[:k]]


def backtest(isos: list[str], seed: int = 42) -> dict:
    st = _learn(seed)
    rows = []
    for h in isos:
        pool = [c.iso for c in cfg.COUNTRIES if c.iso != h]
        pr = predict(h, seed, pool, ramp=False)
        true = float(st["true_day_margin"][cfg.ISO_INDEX[h]])
        d = pr["day_avg"]
        rows.append({"country": h, "name": _features(h)["name"], "learned_from": [n for n, _ in pr["neighbours"]],
                     "predicted_margin_day_usd": round(d["p50"]), "range_usd": [round(d["p10"]), round(d["p90"])],
                     "true_margin_day_usd": round(true), "error": round(d["p50"] / true - 1, 3),
                     "inside_p10_p90": bool(d["p10"] <= true <= d["p90"])})
    errs = [abs(r["error"]) for r in rows]
    inside = sum(r["inside_p10_p90"] for r in rows)
    worst = max(rows, key=lambda r: abs(r["error"]))
    return {"countries": rows, "max_abs_error": round(max(errs), 3), "median_abs_error": round(float(np.median(errs)), 3),
            "typical_within_pct": float(np.ceil(np.median(errs) * 100)), "within_pct": float(np.ceil(max(errs) * 100)),
            "worst": {"country": worst["country"], "name": worst["name"], "error": worst["error"]},
            "inside_p10_p90": f"{inside}/{len(rows)}", "inside_count": inside, "n": len(rows),
            "method": "Each country is hidden in turn and predicted from the other 19 only, then compared with the "
                      "simulator's true margin over the next 4 weeks (steady state, no launch ramp)."}


def _fraud_risk(nb: list[tuple[str, float]], day_margin: float, incidents: list[dict] | None) -> dict:
    session = {}
    for inc in incidents or []:
        if inc.get("root") in ("new_accounts", "active_users") or "farm" in str(inc.get("title", "")).lower():
            session[inc["country"]] = session.get(inc["country"], 0) + 1
    rate = sum(x * (FARMS_PER_QUARTER[n] + session.get(n, 0)) for n, x in nb)  # farms per quarter
    chance = 1 - np.exp(-rate * DAYS / 91)
    level = "high" if chance >= 0.5 else "medium" if chance >= 0.25 else "low"
    return {"level": level, "farm_chance_4w": round(float(chance), 2),
            "expected_loss_usd_4w": round(float(chance * FARM_LOSS_DAYS * day_margin)),
            "farms_per_quarter_neighbours": {n: FARMS_PER_QUARTER[n] + session.get(n, 0) for n, _ in nb},
            "text": f"{level.capitalize()}: about a {chance:.0%} chance of a bot farm in the first 4 weeks, "
                    f"based on {', '.join(_features(n)['name'] for n, _ in nb)}",
            "source": "simulated fraud history of the neighbours (plus bot-farm issues in this session)"}


def launch(iso: str = "AR", seed: int = 42, incidents: list[dict] | None = None) -> dict:
    iso = (iso or "AR").upper()
    if iso in cfg.ISO_INDEX:
        raise ValueError(f"{iso} is already watched; launch candidates: {sorted(CANDIDATES)}")
    if iso not in CANDIDATES:
        raise ValueError(f"unknown launch country '{iso}'; candidates: {sorted(CANDIDATES)}")
    key = (iso, seed)
    if key not in _LAUNCH:
        _LAUNCH[key] = _launch(iso, seed)
    out = dict(_LAUNCH[key])
    out["fraud_risk"] = _fraud_risk(out.pop("_neighbours"), out["margin_per_day_usd"]["p50"], incidents)
    return out


def _launch(iso: str, seed: int) -> dict:
    f = _features(iso)
    base = predict(iso, seed)
    rewards = []
    for rs in REWARD_GRID:
        pr = base if rs == cfg.REWARD_SHARE else predict(iso, seed, reward_share=rs)
        rewards.append({"reward_share": rs, "margin_day_usd": round(pr["day_last"]["p50"])})
    best_rs = max(rewards, key=lambda x: x["margin_day_usd"])
    cur = next(x for x in rewards if x["reward_share"] == cfg.REWARD_SHARE)
    order = np.argsort(base["margin_share_by_category"])[::-1][:3]
    mix = [{"category": cfg.CATEGORIES[k], "margin_share": round(float(base["margin_share_by_category"][k]), 3),
            "taste": round(float(base["taste"][k]), 3)} for k in order]
    bt = backtest(backtest_countries(iso), seed)
    day = base["day_last"]
    names = [_features(n)["name"] for n, _ in base["neighbours"]]
    rnd = lambda q: {k: round(v) for k, v in q.items()}  # noqa: E731
    return {
        "country": {"iso": iso, "name": f["name"], "region": f["region"], "lat": f["lat"], "lng": f["lng"],
                    "ios_share": f["ios_share"],
                    "gdp_per_capita_usd": GDP_PC[iso], "population": POPULATION[iso]},
        "horizon_days": DAYS,
        "margin_per_day_usd": rnd(day),                       # after 4 weeks (day 28), standard settings
        "margin_per_day_weekly_usd": [rnd(x) for x in base["weekly"]],
        "margin_4w_total_usd": rnd(base["total"]),
        "best_offer_mix": mix,
        "best_reward": {"reward_share": best_rs["reward_share"], "current_share": cfg.REWARD_SHARE,
                        "uplift_usd_day": best_rs["margin_day_usd"] - cur["margin_day_usd"], "grid": rewards,
                        "note": "Starts respond to rewards as in past calendar promos (70% share gave +30% starts); "
                                "longer-term loyalty effects are not modelled."},
        "_neighbours": base["neighbours"],
        "learned_from": [{"iso": n, "name": _features(n)["name"], "weight": round(x, 2),
                          "distance": round(distance(iso, n), 2)} for n, x in base["neighbours"]],
        "assumptions": {"users_per_day_steady": round(base["users_per_day"]), "payout_level_vs_us": round(base["value"], 3),
                        "adoption": f"users build up as 1 - exp(-day/{ADOPTION_DAYS:g})",
                        "taste_start_elasticity": round(base["gamma"], 3), "paths": N_PATHS},
        "backtest": bt,
        "headline": f"Launching in {f['name']}: about +${day['p50']:,.0f} a day after 4 weeks",
        "learned_line": f"Learned from {', '.join(names[:-1])} and {names[-1]}",
        "backtest_line": f"Tested on {bt['n']} countries we know: typically within ±{bt['typical_within_pct']:.0f}% "
                         f"(worst {bt['worst']['name']} {bt['worst']['error']:+.0%}), {bt['inside_p10_p90']} inside "
                         f"the forecast range",
        "range_line": f"Likely range ${day['p10']:,.0f}–${day['p90']:,.0f} a day (p10–p90)",
    }
