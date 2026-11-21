"""Argus: the self-driving analyst loop (runs once per simulated hour).

Argus sees reality only through `RealityView`: the observed metric stream, the
public marketing calendar, unlabeled user samples and the actions it applies.
"""
from __future__ import annotations

import json
import re

import numpy as np

from . import config as cfg
from . import llm
from .graph import MECHANISMS, MetricGraph, Node, evaluate, parse_expression
from .taste import TasteModel
from .twin import KPIS, STAY, TOP_PAYOUT, USER_SIDE, Twin

WINDOW = 3
ALERT_Z = 4.0
ROOT_Z = 3.0
WATCH_Z = 4.0                 # amber: |z| >= 4 for one hour
QUIET_Z = 3.0                 # "healthy" for resolution purposes
INCIDENT_HOURS = 2            # an incident needs the alert to persist this long ...
INCIDENT_IMPACT = 150.0       # ... and impact above this (USD/h) ...
INCIDENT_Z = 8.0              # ... or a deviation this extreme
L3_MIN_IMPACT = 50.0          # USD/h before a user-level run is worth it
SUPPORTED, PARTIAL = 0.8, 0.3
QUIET_TO_RESOLVE = 6
SEV_HIGH_USD, SEV_HIGH_SOON_USD = 25_000, 10_000       # 7-day cost of doing nothing (USD)
SEV_MEDIUM_USD, SEV_MEDIUM_SOON_USD = 5_000, 1_000     # "soon" = advertisers react within 24 h
RESIDUAL_FRAUD = {"none": 1.0, "cap_rewards": 0.4, "verify_new_accounts": 0.05, "block_cluster": 0.0}

KPI_LABEL = {"new_accounts": "new accounts", "completions": "completions", "revenue": "revenue",
             "rewards": "rewards", "margin": "margin", "quality_per_completion": "quality per completion"}
MECH_LABEL = {"new_accounts": "New accounts", "active_users": "Active users", "impressions": "Offer impressions",
              "starts": "Offer starts", "completions": "Completions", "revenue": "Advertiser revenue",
              "rewards": "User rewards", "quality": "Valuable users"}
FIX_INFO = {
    "none": ("Do nothing", "Keep monitoring; no change to the marketplace."),
    "block_cluster": ("Block cluster", "Suspend the flagged accounts and their device fingerprints in {country} "
                                       "({platform}); withhold their pending rewards."),
    "verify_new_accounts": ("Verify new accounts", "Require phone and device verification for new {platform} "
                                                   "accounts in {country}."),
    "cap_rewards": ("Cap rewards", "Lower the user reward share on strategy-game and fintech offers to 35% for "
                                   "{platform} users in {country}."),
    "notify_advertiser": ("Notify advertiser", "Send the advertisers' tracking team the postback gap so they fix "
                                               "tracking."),
    "pause_offers": ("Pause offers", "Hide the affected {categories} offers for {platform} users in {country} for "
                                     "18 h, so users are not rewarded for unconfirmed completions."),
    "pause_notify": ("Pause + notify", "Pause the affected offers for 18 h and get the advertiser to fix "
                                       "tracking."),
}


class RealityView:
    """The only window Argus has on the simulated business."""

    def __init__(self, reality) -> None:
        self._reality = reality

    @property
    def t(self) -> int:
        return self._reality.t

    @property
    def observed(self) -> list[dict]:
        return self._reality.observed

    @property
    def calendar(self) -> list:
        return self._reality.events

    def sample_users(self, c: int, p: int, n: int = 600) -> list[dict]:
        users = self._reality.sample_users(c, p, n)
        return [{k: v for k, v in u.items() if not k.startswith("_")} for u in users]  # no labels

    def apply(self, intervention: dict) -> None:
        self._reality.apply(intervention)


OFFER_NOUN = ["casual-game", "strategy-game", "fintech", "streaming", "shopping-cashback", "survey"]


def _country_phrase(name: str) -> str:
    return f"the {name}" if name.startswith(("United", "Philippines", "Netherlands")) else name


DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def hour_label(t: int) -> str:
    """Simulated UTC time label, e.g. "Mon 03:00" (sim day 0 is a Monday)."""
    day, hour = divmod(int(t), 24)
    return f"{DOW[day % 7]} {hour:02d}:00"


def _fmt_usd(x: float) -> str:
    return f"${x:,.0f}" if abs(x) >= 1 else f"${x:,.2f}"


def _signed_usd(x: float) -> str:
    return ("+" if x >= 0 else "−") + _fmt_usd(abs(x))


def _country_sums(r: dict) -> dict:
    out = {"new_accounts": r["new_accounts"].sum(1), "active_users": r["active_users"].sum(1)}
    for k in ("impressions", "starts", "completions", "revenue", "rewards", "quality"):
        out[k] = r[k].sum((1, 2))
    return out


def _with_formulas(s: dict) -> dict:
    s = dict(s)
    s["margin"] = s["revenue"] - s["rewards"]
    s["quality_per_completion"] = s["quality"] / np.maximum(s["completions"], 1e-9)
    return s


class Agent:
    def __init__(self, view: RealityView, twin: Twin, taste: TasteModel, graph: MetricGraph | None = None,
                 seed: int = 0) -> None:
        self.view, self.twin, self.taste = view, twin, taste
        self.graph = graph or MetricGraph()
        self.seed = seed
        self.incidents: list[dict] = []
        self.explained: list[dict] = []
        self._explained_idx: dict[tuple, int] = {}
        self.consec = np.zeros((cfg.C, len(KPIS)))
        self.quiet = np.zeros(cfg.C)
        self.zmax_hist: list[np.ndarray] = []
        self.wait_info: dict[int, dict] = {}
        self.waiting = np.zeros(cfg.C, dtype=bool)
        self.explaining = np.zeros(cfg.C, dtype=bool)
        self.extensions: dict[str, dict] = {}
        self.investigations = 0
        self.l3_runs = 0
        self.last: dict | None = None
        self.t = view.t - 1
        self.potential = self.compute_potential()

    # ================================================================== hourly loop
    def on_hour(self) -> None:
        row = self.view.observed[-1]
        t = row["t"]
        self.t = t
        self.twin.observe(row)
        ts = [t - i for i in range(WINDOW)][::-1]
        res = self.twin.l1_z(t)
        naive = self.twin.l1_z(t, calendar=False)
        z, zn = res["z"], naive["z"]

        # 1. data check
        comp = np.min([self.twin.rows[x]["completeness"] for x in ts], axis=0)
        self.waiting = comp < 0.9
        for c in range(cfg.C):
            if self.waiting[c] and c not in self.wait_info:
                i = int(np.argmax(np.abs(zn[c])))
                self.wait_info[c] = {"t": t, "naive_z": float(zn[c, i]),
                                     "share": float(self.twin.rows[t]["completeness"][c])}
            elif not self.waiting[c] and c in self.wait_info:
                info = self.wait_info.pop(c)
                self.explained.append({"t": info["t"], "country": cfg.COUNTRIES[c].iso,
                                       "event": f"Late data ({info['share']:.0%} of rows delivered): waited, "
                                                f"backfilled after {t - info['t']} h, no alert",
                                       "naive_z": round(info["naive_z"], 1),
                                       "twin_z": round(float(z[c, np.argmax(np.abs(z[c]))]), 1)})

        # 2. watch: twin vs naive
        ext = self._extension_z(t)
        hit = (np.abs(z) >= ALERT_Z) & ~self.waiting[:, None]
        self.consec = np.where(hit, self.consec + 1, 0)
        alert = self.consec >= INCIDENT_HOURS
        allz = np.concatenate([z, ext], axis=1) if ext.size else z
        imax = np.argmax(np.abs(allz), axis=1)
        self.health = allz[np.arange(cfg.C), imax]
        self.zmax_hist.append(np.abs(z).max(1))
        self.explaining[:] = False
        for ev in self.view.calendar:
            if not ev.active(t):
                continue
            c = cfg.ISO_INDEX[ev.country]
            i = int(np.argmax(np.abs(zn[c])))
            if abs(zn[c, i]) >= ALERT_Z and np.abs(z[c]).max() < ALERT_Z:
                self.explaining[c] = True
                key = (ev.id, c)
                entry = {"t": t, "country": ev.country, "event": f"{ev.name} ({', '.join(ev.to_dict()['categories'])})"
                         f": {KPI_LABEL[KPIS[i]]} {naive['rel'][c, i]:+.0%} vs a naive "
                         f"baseline, expected by the twin",
                         "naive_z": round(float(zn[c, i]), 1), "twin_z": round(float(z[c, i]), 1)}
                if key not in self._explained_idx:
                    self._explained_idx[key] = len(self.explained)
                    self.explained.append(entry)
                elif abs(entry["naive_z"]) > abs(self.explained[self._explained_idx[key]]["naive_z"]):
                    entry["t"] = self.explained[self._explained_idx[key]]["t"]
                    self.explained[self._explained_idx[key]] = entry

        # 3-8. investigate new alerts, most impactful first
        d = res["obs"] - res["fc"]
        impact = np.abs(d[:, 2:5]).max(1) / WINDOW
        for c in np.argsort(-impact):
            if not alert[c].any():
                continue
            if impact[c] <= INCIDENT_IMPACT and np.abs(z[c][alert[c]]).max() < INCIDENT_Z:
                continue                                                  # stays amber ("watch")
            inc = self._active_incident(int(c))
            if inc is not None:
                if inc["status"] == "open":
                    inc["status"] = "persisting"
                    inc["trail"].append({"t": t, "level": "L1", "action": "Re-check the country one hour later",
                                         "finding": "Deviation persists; same fingerprint, no duplicate incident"})
                elif inc["status"] == "verified":
                    inc["status"] = "persisting"
                    inc["trail"].append({"t": t, "level": "L1", "action": "Watch after verification",
                                         "finding": "The KPI deviates again; incident re-opened"})
                continue
            self.investigate(int(c), t, res, alert[c])

        # 9-10. verification and resolution
        self.quiet = np.where(np.abs(z).max(1) < QUIET_Z, self.quiet + 1, 0)
        for inc in self.incidents:
            if inc["status"] == "fix_applied" and inc["verification"]["status"] == "pending" and t >= inc["due"]:
                self._verify(inc, t)
            if inc["status"] in ("verified", "fix_applied") and t >= inc["due"] and self.quiet[inc["c"]] >= QUIET_TO_RESOLVE:
                if inc["status"] == "verified" or inc["verification"]["status"] == "missed":
                    inc["status"] = "resolved"
                    inc["trail"].append({"t": t, "level": "L1", "action": "Close the incident",
                                         "finding": f"{cfg.COUNTRIES[inc['c']].name} healthy for "
                                                    f"{QUIET_TO_RESOLVE} h"})
        self.last = res
        if t % 24 == 0:
            self.potential = self.compute_potential()

    def _active_incident(self, c: int) -> dict | None:
        for inc in self.incidents:
            if inc["c"] == c and inc["status"] != "resolved":
                return inc
        return None

    def _elapsed(self, c: int) -> int:
        n = 0
        for zz in reversed(self.zmax_hist[:-1]):
            if zz[c] < 2:
                break
            n += 1
        return n + 1

    # ================================================================== investigation
    def investigate(self, c: int, t: int, res: dict, alert_row: np.ndarray) -> dict:
        self.investigations += 1
        tw = self.twin
        country = cfg.COUNTRIES[c]
        ts = [t - i for i in range(WINDOW)][::-1]
        z, rel = res["z"][c], res["rel"][c]
        dl = (res["obs"] - res["fc"])[c]
        alerting = [KPIS[i] for i in np.where(alert_row)[0]]
        impact = float(np.abs(dl[2:5]).max() / WINDOW)
        trail: list[dict] = []
        events = [ev for ev in self.view.calendar if ev.active(t) and ev.country == country.iso]
        trail.append({"t": t, "level": "L1",
                      "action": f"Watch {cfg.C} countries × {len(KPIS) + len(self.extensions)} KPIs against the "
                                f"twin forecast (|z| ≥ {ALERT_Z:.0f} for 2 h)",
                      "finding": f"{country.name}: " + ", ".join(f"{KPI_LABEL[k]} {z[KPIS.index(k)]:+.1f}σ "
                                                               f"({rel[KPIS.index(k)]:+.1%})" for k in alerting)
                                 + (f"; planned event active: {events[0].name}" if events
                                    else "; no planned event in the calendar")})

        # --- L2: localise by platform x category
        rows = [tw.rows[x] for x in ts]
        fcs = [tw.forecast(x) for x in ts]
        dsum = lambda key: sum(r[key][c] for r in rows) - sum(f[key][c] for f in fcs)  # noqa: E731
        d_rev, d_rew = dsum("revenue"), dsum("rewards")
        score = np.abs(d_rev) + np.abs(d_rew)                                       # (P,K)
        gp = tw.given_parents(ts)
        if "new_accounts" in alerting:
            p = int(np.argmax([abs(tw.z_of(gp["new_accounts"], c, pp)) for pp in range(cfg.P)]))
        else:
            p = int(np.argmax(score.sum(1)))
        p_share = float(score[p].sum() / max(score.sum(), 1e-9))
        order = np.argsort(-score[p])
        cats, cum = [], 0.0
        for k in order:
            cats.append(int(k))
            cum += score[p, k]
            if cum >= 0.8 * score[p].sum():
                break
        k = cats[0]
        seg_txt = ", ".join(f"{cfg.CATEGORIES[kk]} ({score[p, kk] / max(score[p].sum(), 1e-9):.0%})" for kk in cats)
        new_txt = ""
        if "new_accounts" in alerting:
            new_txt = f"; new accounts on {cfg.PLATFORMS[p]} z={tw.z_of(gp['new_accounts'], c, p):+.1f}"
        trail.append({"t": t, "level": "L2", "action": "Break the deviation down by platform × advertiser category",
                      "finding": f"{cfg.PLATFORMS[p]} carries {p_share:.0%} of the money deviation; segments covering "
                                 f"80%: {seg_txt}{new_txt}"})

        # --- L2: walk the DAG upstream
        mz = {m: tw.z_of(gp[m], c, p, None if m in ("new_accounts", "active_users") else k) for m in MECHANISMS}
        marg = self._marginal_z(c, p, k, ts)
        root = next((m for m in MECHANISMS if abs(mz[m]) > ROOT_Z), None)
        broken = [m for m in MECHANISMS if m != root and abs(mz[m]) > ROOT_Z]
        symptoms = [n for n in marg if n != root and n not in broken and abs(marg[n]) > ROOT_Z]
        kpi_alert = alerting[0]
        walk = (f"root: {MECH_LABEL[root]} (z={mz[root]:+.1f} given parents)" if root
                else "no mechanism deviates given its parents")
        if broken:
            walk += "; also broken: " + ", ".join(f"{MECH_LABEL[m]} ({mz[m]:+.1f})" for m in broken)
        if symptoms:
            walk += "; symptoms (normal given parents): " + ", ".join(symptoms)
        trail.append({"t": t, "level": "L2",
                      "action": f"Walk the causal graph upstream from {KPI_LABEL[kpi_alert]} in "
                                f"{cfg.PLATFORMS[p]} × {cfg.CATEGORIES[k]}",
                      "finding": walk})
        graph = self._incident_graph(mz, marg, root, broken, symptoms)

        # --- L3 (adaptive abstraction)
        l3 = None
        cluster = False
        if root in ("new_accounts", "active_users") and impact >= L3_MIN_IMPACT:
            users = self.view.sample_users(c, p, 600)
            sc = self.taste.score_users(users)
            self.l3_runs += 1
            cf, co = sc["coherence_flagged"], sc["coherence_others"]
            cluster = (sc["n_flagged"] >= 5 and sc["device_concentration"] >= 0.6 and cf is not None
                       and cf < co - 0.2)
            devs = [d for d, _ in sc["top_devices"]]
            l3 = {"summary": {"n_users": sc["n_users"], "n_flagged": sc["n_flagged"],
                              "coherence_flagged": None if cf is None else round(cf, 2),
                              "coherence_others": round(co, 2), "top_devices": devs,
                              "payout_focus_flagged": None if sc["payout_focus_flagged"] is None
                              else round(sc["payout_focus_flagged"], 2),
                              "payout_focus_others": round(sc["payout_focus_others"], 2)},
                  "points": [{"coherence": pt["coherence"], "payout_focus": pt["payout_focus"],
                              "flagged": pt["flagged"]} for pt in sc["points"] if pt["coherence"] is not None]}
            if cluster:
                finding = (f"Cluster of {sc['n_flagged']} new accounts ({sc['n_flagged'] / sc['n_users']:.0%} of the "
                           f"sample): taste coherence {cf:.2f} vs {co:.2f} for everyone else, payout focus "
                           f"{sc['payout_focus_flagged']:.2f} vs {sc['payout_focus_others']:.2f}, shared devices "
                           f"{', '.join(devs)}")
            else:
                finding = (f"No coherent fraud cluster ({sc['n_flagged']} flagged); new users have normal taste "
                           f"coherence ({co:.2f})")
            trail.append({"t": t, "level": "L3",
                          "action": f"Impact {_fmt_usd(impact)}/h × high uncertainty (user-side root): pull "
                                    f"{sc['n_users']} unlabeled user records from {country.name} {cfg.PLATFORMS[p]} "
                                    f"and score them with the taste model",
                          "finding": finding})
        else:
            why = (f"root is {MECH_LABEL[root].lower()}, a mechanism with no user-level ambiguity" if root
                   and root not in ("new_accounts", "active_users") else f"impact {_fmt_usd(impact)}/h is low")
            trail.append({"t": t, "level": "L3", "action": "Decide whether to descend to individual users",
                          "finding": f"Skipped (impact × uncertainty low): {why}"})

        # --- hypotheses (counterfactuals in the twin)
        kpi = max(alerting, key=lambda kk: abs(z[KPIS.index(kk)]))         # explain the change that alerted
        ki = KPIS.index(kpi)
        delta = float(dl[ki])
        e_user = tw.explained_share(c, ts, {p: USER_SIDE}, kpi)
        e_track = tw.explained_share(c, ts, {pp: ["revenue"] for pp in range(cfg.P)}, kpi)
        e_rew = tw.explained_share(c, ts, {pp: ["rewards"] for pp in range(cfg.P)}, kpi)
        fc_cal = sum(tw._l1(tw.forecast(x))[c, ki] for x in ts)
        fc_nocal = sum(tw._l1(tw.forecast(x, calendar=False))[c, ki] for x in ts)
        obs_k = float(res["obs"][c, ki])
        e_cal = float(np.clip((fc_cal - fc_nocal) / (obs_k - fc_nocal), 0, 1)) if abs(obs_k - fc_nocal) > 1e-9 else 0.0
        miss = sum((1 - tw.rows[x]["completeness"][c]) * tw._l1(tw.forecast(x))[c, ki] for x in ts)
        e_gap = float(np.clip(-miss / delta, 0, 1)) if abs(delta) > 1e-9 else 0.0

        def verdict(e: float, cap: str | None = None) -> str:
            v = "supported" if e >= SUPPORTED else "partial" if e >= PARTIAL else "rejected"
            return "partial" if cap == "partial" and v == "supported" else v

        plat = cfg.PLATFORMS[p]
        if l3 and cluster:
            user_name, kind = (f"Fake-account cluster on {plat} ({l3['summary']['n_flagged']} sampled accounts on "
                               f"{', '.join(l3['summary']['top_devices'][:2])})"), "fraud"
        elif l3:
            user_name, kind = f"Organic growth: new real users on {plat}", "organic"
        else:
            user_name, kind = f"User-side shift on {plat} (more users or different behaviour)", "user"
        hyps = [
            {"name": user_name, "explained": e_user,
             "verdict": verdict(e_user, None if kind in ("fraud", "organic") else "partial")},
            {"name": "Tracking / postback break (advertisers confirm fewer completions)", "explained": e_track,
             "verdict": verdict(e_track)},
            {"name": "Reward pricing change", "explained": e_rew, "verdict": verdict(e_rew)},
            {"name": "Planned marketing event (calendar)", "explained": e_cal, "verdict": verdict(e_cal)},
            {"name": "Data gap (late or missing rows)", "explained": e_gap, "verdict": verdict(e_gap)},
        ]
        for h in hyps:
            h["explained"] = round(float(np.clip(h["explained"], 0, 1)), 3) + 0.0
        hyps.sort(key=lambda h: -h["explained"])
        if kind == "fraud" and hyps[0]["name"] == user_name and hyps[0]["verdict"] == "supported":
            pass
        elif e_track >= SUPPORTED:
            kind = "tracking"
        elif kind == "fraud":
            kind = "user"
        dtxt = _signed_usd(delta / WINDOW) if kpi in ("revenue", "rewards", "margin") else f"{delta / WINDOW:+,.1f}"
        trail.append({"t": t, "level": "L2", "action": f"Test hypotheses by counterfactual in the twin "
                                                      f"(Δ {KPI_LABEL[kpi]} {dtxt}/h)",
                      "finding": "; ".join(f"{h['name'].split(' (')[0]}: {h['explained']:.0%} {h['verdict']}"
                                           for h in hyps)})

        sh = tw.shapley(c, p, ts, "margin")
        contributions = [{"mechanism": m, "value_usd": round(v / WINDOW, 2)} for m, v in sh["phi"].items()]

        # --- fixes tested in the twin
        if kind == "fraud":
            opts, fcats = ["none", "block_cluster", "verify_new_accounts", "cap_rewards"], TOP_PAYOUT
        elif kind == "user":
            opts, fcats = ["none", "verify_new_accounts", "cap_rewards"], TOP_PAYOUT
        elif kind == "tracking":
            ratio = sum(r["revenue"][c, p] for r in rows) / np.maximum(sum(f["revenue"][c, p] for f in fcs), 1e-9)
            fcats = [int(kk) for kk in np.where(ratio < 0.7)[0]] or [k]
            opts = ["none", "notify_advertiser", "pause_offers", "pause_notify"]
        else:
            opts, fcats = ["none"], cats
        ctx = {"kind": "tracking" if kind == "tracking" else "fraud", "platform": p, "categories": fcats,
               "elapsed": self._elapsed(c)}
        inc = {"id": f"inc-{len(self.incidents) + 1}", "c": c, "p": p, "k": k, "kind": kind, "kpi": kpi,
               "fingerprint": [country.iso, plat, root], "status": "open", "country": country.iso,
               "platform": plat, "category": cfg.CATEGORIES[k], "categories": [cfg.CATEGORIES[x] for x in cats],
               "fix_categories": fcats, "detected_at": t, "impact_usd_h": round(impact, 1),
               "severity": "low", "risk_7d_usd": 0, "reaction_h": None,
               "trail": trail, "graph": graph, "contributions": contributions, "hypotheses": hyps, "l3": l3,
               "ctx": ctx, "applied": None, "applied_at": None, "due": None,
               "verification": {"status": "pending", "predicted": None, "actual": None},
               "z": {KPI_LABEL[kk]: round(float(z[i]), 1) for i, kk in enumerate(KPIS)},
               "mechanism_z": {m: round(v, 1) for m, v in mz.items()}, "root": root, "broken": broken,
               "symptoms": symptoms, "delta_usd_h": round(delta / WINDOW, 1),
               "delta_revenue_usd_h": round(float(dl[KPIS.index("revenue")]) / WINDOW, 1),
               "delta_margin_usd_h": round(float(dl[KPIS.index("margin")]) / WINDOW, 1),
               "excess_accounts": self._excess_accounts(c, p, t)}
        inc["fixes"] = self._fixes(inc, opts, t)
        inc["recommended"] = self._recommend(inc["fixes"], kind)
        rec_fix = next(f for f in inc["fixes"] if f["id"] == inc["recommended"])
        # Risk = what doing nothing costs over 7 days vs the recommended fix (p50), plus how soon advertisers react.
        inc["risk_7d_usd"] = round(max(rec_fix["delta_p50_usd"], 0))
        inc["reaction_h"] = (max(24 - ctx["elapsed"], 1) if kind in ("fraud", "user")
                             else 0 if kind == "tracking" else None)          # tracking: losses accrue now
        inc["severity"] = self._severity(inc["risk_7d_usd"], inc["reaction_h"])
        rec = next(f for f in inc["fixes"] if f["id"] == inc["recommended"])
        trail.append({"t": t, "level": "L1", "action": f"Fast-forward {len(opts)} options 7 days in the twin "
                                                      f"(40 Monte Carlo runs each)",
                      "finding": f"Recommend {rec['name']}: 7-day margin {_signed_usd(rec['delta_p50_usd'])} vs "
                                 f"doing nothing (p50)" if rec["id"] != "none"
                                 else "Doing nothing is best; keep monitoring"})
        inc["title"] = self._title(inc)
        inc["reports"] = self._reports(inc)
        self.incidents.append(inc)
        return inc

    def _marginal_z(self, c: int, p: int, k: int, ts: list[int]) -> dict:
        """z of each node vs the twin's marginal forecast in segment (c,p,k)."""
        tw = self.twin
        sig = {"new_accounts": tw.sig_new[c, p], "active_users": tw.sig_ret[c, p]}
        for m in ("impressions", "starts", "completions", "revenue", "rewards", "quality"):
            sig[m] = tw.sig[m][c, p, k]
        chain_sig = {}
        acc = 0.0
        for m in ("new_accounts", "active_users", "impressions", "starts", "completions"):
            acc += sig[m] ** 2
            chain_sig[m] = np.sqrt(acc)
        for m in ("revenue", "rewards", "quality"):
            chain_sig[m] = np.sqrt(acc + sig[m] ** 2)
        chain_sig["margin"] = chain_sig["revenue"]
        out = {}
        for n in list(chain_sig):
            o = e = v = 0.0
            for x in ts:
                r, f = tw.rows[x], tw.forecast(x)
                if n == "margin":
                    ov, ev = r["revenue"][c, p, k] - r["rewards"][c, p, k], f["revenue"][c, p, k] - f["rewards"][c, p, k]
                elif n in ("new_accounts", "active_users"):
                    ov, ev = r[n][c, p], f[n][c, p]
                else:
                    ov, ev = r[n][c, p, k], f[n][c, p, k]
                o, e, v = o + ov, e + ev, v + (ev * chain_sig[n]) ** 2
            out[n] = float((o - e) / np.sqrt(v + 1e-9))
        q_o = sum(tw.rows[x]["quality"][c, p, k] for x in ts) / max(sum(tw.rows[x]["completions"][c, p, k] for x in ts), 1e-9)
        q_e = sum(tw.forecast(x)["quality"][c, p, k] for x in ts) / max(sum(tw.forecast(x)["completions"][c, p, k] for x in ts), 1e-9)
        out["quality_per_completion"] = float((q_o / q_e - 1) / max(sig["quality"] / np.sqrt(len(ts)), 1e-3))
        return out

    def _incident_graph(self, mz: dict, marg: dict, root, broken, symptoms) -> dict:
        g = self.graph.to_dict()
        nodes = []
        for n in g["nodes"]:
            nid = n["id"]
            if nid in MECHANISMS:
                zz = mz[nid]
            else:
                zz = marg.get(nid, 0.0)
            state = ("root" if nid == root else "broken" if nid in broken else "symptom" if nid in symptoms
                     or (nid not in MECHANISMS and abs(zz) > ROOT_Z) else "normal")
            nodes.append({"id": nid, "label": n["label"], "z": round(float(zz), 1), "state": state})
        nodes.append({"id": "calendar", "label": "Planned events (marketing calendar)", "z": 0.0, "state": "normal"})
        edges = [{"source": e["source"], "target": e["target"], "type": e["type"]} for e in g["edges"]]
        return {"nodes": nodes, "edges": edges}

    # ================================================================== fixes
    def _fixes(self, inc: dict, opts: list[str], now: int) -> list[dict]:
        ff = self.twin.fast_forward(inc["c"], opts, inc["ctx"], now, seed=self.seed)
        country = cfg.COUNTRIES[inc["c"]].name
        cats = ", ".join(cfg.CATEGORY_KEYS[k] for k in inc["fix_categories"])
        e = inc["ctx"]["elapsed"]
        out = []
        for r in ff:
            name, desc = FIX_INFO[r["id"]]
            out.append({"id": r["id"], "name": name,
                        "description": desc.format(country=country, platform=inc["platform"], categories=cats),
                        "days": r["days"], "p10": [round(x) for x in r["p10"]], "p50": [round(x) for x in r["p50"]],
                        "p90": [round(x) for x in r["p90"]], "delta_p50_usd": round(r["delta_p50_usd"]),
                        "advertiser_risk": self._risk(inc, r["id"], e, cats)})
        return out

    @staticmethod
    def _severity(risk_7d: float, reaction_h: int | None) -> str:
        soon = reaction_h is not None and reaction_h <= 24
        if risk_7d >= SEV_HIGH_USD or (soon and risk_7d >= SEV_HIGH_SOON_USD):
            return "high"
        if risk_7d >= SEV_MEDIUM_USD or (soon and risk_7d >= SEV_MEDIUM_SOON_USD):
            return "medium"
        return "low"

    @staticmethod
    def _risk(inc: dict, fix: str, elapsed: int, cats: str) -> str:
        if inc["kind"] in ("fraud", "user"):
            cb, bc = max(24 - elapsed, 1), max(48 - elapsed, 1)
            return {
                "none": f"High: chargebacks on {cats} (about half of revenue) in ~{cb} h, budget cut (−60%) in ~{bc} h",
                "block_cluster": "Low: 30% chance the farm returns at half strength within 1–2 days",
                "verify_new_accounts": "Low: about 12% fewer genuine sign-ups on this platform",
                "cap_rewards": "Medium: leaves ~40% of the fake accounts active; the margin gain comes from paying "
                               "genuine users less (about 15% fewer starts), so it treats a symptom, not the cause",
            }[fix]
        if inc["kind"] == "tracking":
            return {
                "none": f"High: users keep earning full rewards on {cats} while advertisers confirm only a fraction",
                "notify_advertiser": "Medium: losses continue until the advertiser fixes tracking (12–30 h)",
                "pause_offers": "Medium: offers return after 18 h with tracking still broken",
                "pause_notify": "Low: offers paused until tracking is fixed",
            }[fix]
        return "Low"

    @staticmethod
    def _recommend(fixes: list[dict], kind: str = "") -> str:
        """Best p50 among options with acceptable p10; a fraud fix must also remove the fake accounts."""
        none = fixes[0]
        ok = [f for f in fixes if f["p10"][-1] >= none["p10"][-1]]
        if kind in ("fraud", "user"):
            removes = [f for f in fixes if RESIDUAL_FRAUD.get(f["id"], 0.0) <= 0.2]
            ok = [f for f in ok if f in removes] or removes or ok
        best = max(ok, key=lambda f: f["p50"][-1])
        return best["id"]

    def _interventions(self, inc: dict, fix: str, t: int) -> list[dict]:
        c, p = inc["c"], cfg.PLATFORMS.index(inc["platform"])
        cats = inc["fix_categories"]
        base = {"country": c, "start": t}
        ivs = {
            "none": [],
            "block_cluster": [{"type": "block_cluster", "platform": p}],
            "verify_new_accounts": [{"type": "verify_new_accounts", "platform": p}],
            "cap_rewards": [{"type": "cap_rewards", "platform": p, "categories": list(TOP_PAYOUT)}],
            "notify_advertiser": [{"type": "notify_advertiser"}],
            "pause_offers": [{"type": "pause_offers", "platform": p, "categories": cats, "until": t + 18}],
            "pause_notify": [{"type": "pause_offers", "platform": p, "categories": cats, "until": t + 18},
                             {"type": "notify_advertiser"}],
        }[fix]
        return [{**base, **iv} for iv in ivs]

    def approve(self, inc_id: str, fix_id: str) -> dict:
        inc = self.get_incident(inc_id)
        if inc is None:
            raise KeyError(inc_id)
        if fix_id not in [f["id"] for f in inc["fixes"]]:
            raise ValueError(f"unknown fix '{fix_id}' for {inc_id}")
        if inc["applied"] is not None:
            raise ValueError(f"{inc_id} already has an applied fix ({inc['applied']})")
        now = self.view.t - 1
        # Fresh fast-forward from the moment of approval: this is the prediction we will be held to.
        opts = ["none"] + ([fix_id] if fix_id != "none" else [])
        inc["ctx"]["elapsed"] = inc["ctx"]["elapsed"] + (now - inc["detected_at"])
        pred = self.twin.fast_forward(inc["c"], opts, inc["ctx"], now, seed=self.seed)[-1]
        for iv in self._interventions(inc, fix_id, self.view.t):
            self.view.apply(dict(iv))
            self.twin.add_action(iv)
        inc["applied"], inc["applied_at"], inc["due"] = fix_id, now, now + 24
        inc["status"] = "fix_applied"
        inc["verification"] = {"status": "pending",
                               "predicted": [round(pred["p10"][0]), round(pred["p50"][0]), round(pred["p90"][0])],
                               "actual": None}
        name = FIX_INFO[fix_id][0]
        inc["trail"].append({"t": now, "level": "L1", "action": f"Human approved: {name}",
                             "finding": f"Applied to the marketplace; predicted 24 h margin in "
                                        f"{cfg.COUNTRIES[inc['c']].name} {_fmt_usd(pred['p10'][0])}–"
                                        f"{_fmt_usd(pred['p90'][0])} (p50 {_fmt_usd(pred['p50'][0])})"})
        return inc

    def _verify(self, inc: dict, t: int) -> None:
        c = inc["c"]
        actual = float(sum((self.twin.rows[x]["revenue"][c] - self.twin.rows[x]["rewards"][c]).sum()
                           for x in range(inc["applied_at"] + 1, inc["applied_at"] + 25)))
        lo, mid, hi = inc["verification"]["predicted"]
        ok = lo <= actual <= hi
        inc["verification"] = {"status": "verified" if ok else "missed", "predicted": [lo, mid, hi],
                               "actual": round(actual)}
        if ok:
            inc["status"] = "verified"
            finding = f"Prediction verified: actual {_fmt_usd(actual)} within band {_fmt_usd(lo)}–{_fmt_usd(hi)}"
        else:
            self.twin.l1_sigma[c] *= 1.2
            finding = (f"Prediction missed: actual {_fmt_usd(actual)} outside {_fmt_usd(lo)}–{_fmt_usd(hi)}; "
                       f"twin uncertainty for {cfg.COUNTRIES[c].name} recalibrated (+20%)")
        inc["trail"].append({"t": t, "level": "L1", "action": "Compare 24 h actual margin with the prediction",
                             "finding": finding})

    # ================================================================== reports
    def _title(self, inc: dict) -> str:
        name = cfg.COUNTRIES[inc["c"]].name
        return {
            "fraud": f"Fake-account cluster in {name} ({inc['platform']})",
            "tracking": f"Tracking break in {name} ({inc['platform']}, "
                        f"{', '.join(cfg.CATEGORIES[k] for k in inc['fix_categories'])})",
            "organic": f"User surge in {name} ({inc['platform']})",
        }.get(inc["kind"], f"{KPI_LABEL[inc['kpi']].capitalize()} anomaly in {name}")

    def _reports(self, inc: dict) -> dict:
        name = cfg.COUNTRIES[inc["c"]].name
        top = inc["hypotheses"][0]
        rejected = [h["name"].split(" (")[0].lower() for h in inc["hypotheses"] if h["verdict"] == "rejected"]
        rec = next(f for f in inc["fixes"] if f["id"] == inc["recommended"])
        none = inc["fixes"][0]
        cats = ", ".join(cfg.CATEGORIES[k] for k in inc["fix_categories"])
        headline = {
            "fraud": "fake accounts are inflating offer completions. It looks like growth, but advertisers will "
                     "claw the revenue back",
            "tracking": f"advertisers confirm only a fraction of {cats} completions on {inc['platform']}, while we "
                        f"keep paying users",
            "organic": "a wave of genuine new users",
        }.get(inc["kind"], f"{KPI_LABEL[inc['kpi']]} deviates from the twin forecast")
        ceo = (f"{name}: {headline}. Impact about {_fmt_usd(inc['impact_usd_h'])}/h. Cause: {top['name']} "
               f"({top['explained']:.0%} of the change explained in the twin)"
               + (f"; ruled out: {', '.join(rejected)}" if rejected else "") + ". "
               + (f"Recommendation: {rec['name'].lower()}, worth {_signed_usd(rec['delta_p50_usd'])} margin over 7 "
                  f"days vs doing nothing. Risk of doing nothing: {none['advertiser_risk'].split(': ', 1)[-1]}."
                  if rec["id"] != "none" else "Recommendation: no action, keep monitoring."))
        mech = ", ".join(f"{MECH_LABEL[m].lower()} {inc['mechanism_z'][m]:+.1f}σ"
                         for m in ([inc["root"]] if inc["root"] else []) + inc["broken"])
        follow = {
            "fraud": f"Tell the {cats} advertisers before their fraud checks do; review {inc['platform']} onboarding "
                     f"in {name}.",
            "tracking": f"Open a ticket with the {cats} advertisers' tracking team with the postback gap.",
        }.get(inc["kind"], "Keep watching the segment.")
        manager = (f"Segment: {name} · {inc['platform']} · {', '.join(inc['categories'])}. Broken mechanisms: "
                   f"{mech or 'none'}. Symptoms: {', '.join(inc['symptoms']) or 'none'}. Action: {rec['name']}. "
                   f"{rec['description']} Expected 7-day margin {_signed_usd(rec['delta_p50_usd'])} vs doing nothing "
                   f"(p10 {_fmt_usd(rec['p10'][-1])}, p90 {_fmt_usd(rec['p90'][-1])}). Then: {follow}")
        shap = ", ".join(f"{x['mechanism']} {_signed_usd(x['value_usd'])}/h" for x in
                         sorted(inc["contributions"], key=lambda x: -abs(x["value_usd"]))[:4])
        l3 = ""
        if inc["l3"]:
            s = inc["l3"]["summary"]
            l3 = (f" L3: {s['n_flagged']}/{s['n_users']} sampled users flagged, coherence {s['coherence_flagged']} vs "
                  f"{s['coherence_others']}, devices {', '.join(s['top_devices'])}.")
        engineer = (f"Window t={inc['detected_at'] - WINDOW + 1}..{inc['detected_at']} (3 h). L1 z: "
                    + ", ".join(f"{k} {v:+.1f}" for k, v in inc["z"].items())
                    + f". Mechanism z given parents ({inc['platform']}, {inc['category']}): "
                    + ", ".join(f"{m} {v:+.1f}" for m, v in inc["mechanism_z"].items())
                    + f". Root: {inc['root']}. Shapley Δmargin: {shap}.{l3} Hypothesis test KPI: {inc['kpi']}; "
                      f"supported if explained ≥ {SUPPORTED:.0%}.")
        return {"ceo": ceo, "manager": manager, "engineer": engineer, "source": "template"}

    def reports_for(self, inc: dict) -> dict:
        """Reports for the incident detail: LLM-written when configured (cached per incident state), else templates."""
        if not llm.configured():
            return inc["reports"]
        key = (inc["status"], inc["applied"], inc["verification"]["status"])
        cache = inc.setdefault("_llm_reports", {})
        if key not in cache:
            cache[key] = self._llm_reports(inc) or inc["reports"]
        return cache[key]

    def _llm_reports(self, inc: dict) -> dict | None:
        rec = next(f for f in inc["fixes"] if f["id"] == inc["recommended"])
        facts = {
            "incident": inc["title"], "status": inc["status"], "country": cfg.COUNTRIES[inc["c"]].name,
            "platform": inc["platform"], "segments": inc["categories"], "impact_usd_per_hour": inc["impact_usd_h"],
            "root_mechanism": inc["root"], "broken": inc["broken"], "symptoms": inc["symptoms"],
            "mechanism_z": inc["mechanism_z"], "l1_z": inc["z"],
            "hypotheses": [{k: h[k] for k in ("name", "explained", "verdict")} for h in inc["hypotheses"]],
            "user_level_check": inc["l3"]["summary"] if inc["l3"] else None,
            "fixes": [{"name": f["name"], "description": f["description"],
                       "margin_7d_vs_doing_nothing_usd": f["delta_p50_usd"], "risk": f["advertiser_risk"]}
                      for f in inc["fixes"]],
            "recommended": rec["name"], "applied": FIX_INFO[inc["applied"]][0] if inc["applied"] else None,
            "verification": inc["verification"],
        }
        drafts = {k: inc["reports"][k] for k in ("ceo", "manager", "engineer")}
        out = llm.chat_json(
            "You are Argus, an analyst for a rewarded-ad marketplace (advertisers pay per completed offer, users get a "
            "reward share). Write one incident report per audience from the facts. Use only numbers that appear in "
            "the facts; never invent figures. Keys: ceo (max 3 sentences: business impact in money, cause, the "
            "decision needed), manager (max 4 sentences: segment, campaigns/advertisers affected, the action and "
            "follow-up), engineer (max 5 sentences: mechanisms and z-scores, root vs symptoms, counterfactual "
            "results, what was queried). 'root_mechanism' is the cause; 'broken' are other mechanisms that are "
            "themselves abnormal; only 'symptoms' are symptoms. If 'applied' is set the decision has been taken: report "
            "it and the verification status instead of asking for approval. Plain text, no markdown.",
            json.dumps({"facts": facts, "template_drafts": drafts}, default=str), max_tokens=1200)
        if not out or not all(isinstance(out.get(k), str) and 20 <= len(out[k]) <= 2000 for k in drafts):
            return None
        return {**{k: out[k].strip() for k in drafts}, "source": "llm", "model": llm.model()}

    # ================================================================== metric extension
    def _known(self) -> set[str]:
        return set(MECHANISMS) | {"margin", "quality_per_completion"}

    def _propose(self, name: str, description: str) -> tuple[str | None, str]:
        known = sorted(self._known())
        if llm.configured():
            out = llm.chat_json(
                "Map a business metric request to a formula over known hourly metrics: " + ", ".join(known)
                + ". Use only + - * / ( ) and these names.", f"name: {name}\ndescription: {description}\n"
                                                             'Return {"expr": "..."}.')
            if out and isinstance(out.get("expr"), str):
                try:
                    parse_expression(out["expr"], self._known())
                    return out["expr"], "LLM"
                except (ValueError, SyntaxError):
                    pass
        return keyword_formula(name, description, self._known())

    def add_metric(self, name: str, description: str) -> dict:
        checks: list[dict] = []
        nid = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:48] or "metric"
        if not re.match(r"^[a-z]", nid):
            nid = "m_" + nid
        expr, source = self._propose(name, description)
        checks.append({"name": "formula", "ok": expr is not None,
                       "detail": f"{nid} = {expr} (proposed by {source})" if expr else
                       "Could not map the description to known metrics"})
        if expr is None:
            return {"node": None, "validation": {"ok": False, "checks": checks}}
        try:
            names, agg = parse_expression(expr, self._known())
            checks.append({"name": "names", "ok": True, "detail": "All metrics exist: " + ", ".join(names)})
        except (ValueError, SyntaxError) as e:
            checks.append({"name": "names", "ok": False, "detail": str(e)})
            return {"node": None, "validation": {"ok": False, "checks": checks}}
        dup = [n.id for n in self.graph.nodes.values() if n.expr and n.expr.replace(" ", "") == expr.replace(" ", "")]
        dup += [n for n in names if n == expr.strip()]
        checks.append({"name": "duplicate", "ok": not dup and nid not in self.graph.nodes,
                       "detail": f"Same as existing metric {dup[0]}" if dup else
                       (f"Metric id {nid} already exists" if nid in self.graph.nodes else "New metric")})
        # identity check on history (L2 segments and L1 countries)
        hist = [self.twin.rows[x] for x in sorted(self.twin.rows)][-24 * 14:]
        seg = []
        for r in hist[-24:]:
            vals = {k: (r[k][..., None] if r[k].ndim == 2 else r[k]) for k in MECHANISMS}
            vals = _with_formulas(vals)
            with np.errstate(divide="ignore", invalid="ignore"):
                seg.append(np.asarray(evaluate(expr, vals), dtype=float))
        seg = np.array(seg)
        day = _with_formulas({k: sum(_country_sums(r)[k] for r in hist[-24:]) for k in _country_sums(hist[-1])})
        with np.errstate(divide="ignore", invalid="ignore"):
            country_val = np.asarray(evaluate(expr, day), dtype=float) * np.ones(cfg.C)
            glob = float(evaluate(expr, {k: v.sum() for k, v in day.items() if k != "quality_per_completion"}
                                  | {"quality_per_completion": day["quality"].sum() / day["completions"].sum()}))
        finite = np.isfinite(country_val).all() and np.isfinite(glob)
        ca = cfg.ISO_INDEX["CA"]
        checks.append({"name": "identity", "ok": bool(finite),
                       "detail": f"Evaluated on 14 days of history: global {glob:,.4g}, "
                                 f"{cfg.COUNTRIES[ca].name} {country_val[ca]:,.4g} (last 24 h); "
                                 f"{np.isfinite(seg).mean():.0%} of segment-hours defined"
                       if finite else "Formula gives undefined values on history"})
        mean_c = float(np.nanmean(country_val))
        checks.append({"name": "aggregation", "ok": True,
                       "detail": (f"Ratio: non-additive across countries; aggregate as Σnumerator/Σdenominator "
                                  f"(global {glob:,.4g} vs mean of countries {mean_c:,.4g})") if agg == "ratio"
                       else "Additive: sum across platforms, categories and countries"})
        ok = all(ch["ok"] for ch in checks)
        if not ok:
            return {"node": None, "validation": {"ok": False, "checks": checks}}
        sigma = self._extension_sigma(expr)
        checks.append({"name": "monitoring", "ok": True,
                       "detail": f"Backtest error {sigma.mean():.1%} per 3 h window; now watched in {cfg.C} "
                                 f"countries"})
        kinds = {n: self.graph.nodes[n].kind for n in names if n in self.graph.nodes}
        if agg == "ratio":
            num, den = names[0], names[-1]
            unit = ("USD" if kinds.get(num) == "money" else self.graph.nodes[num].label.lower()) + " per " + \
                   self.graph.nodes[den].label.lower().rstrip("s")
            kind = "ratio"
        else:
            kind = "money" if any(v == "money" for v in kinds.values()) else "count"
            unit = "USD/h" if kind == "money" else "per hour"
        node = Node(nid, name, unit, kind, "L2", names, "formula", expr=expr, aggregation=agg, origin="extension",
                    confidence={"user": 1.0, "LLM": 0.9}.get(source, 0.8), description=description)
        self.graph.add(node)
        self.extensions[nid] = {"expr": expr, "sigma": sigma}
        return {"node": node.to_dict(), "validation": {"ok": True, "checks": checks}}

    def _ext_values(self, rows: list[dict]) -> dict:
        s = {k: sum(_country_sums(r)[k] for r in rows) for k in _country_sums(rows[0])}
        return _with_formulas(s)

    def _extension_sigma(self, expr: str) -> np.ndarray:
        ts = sorted(self.twin.rows)[-24 * 14:]
        rels = []
        for i in range(WINDOW + STAY, len(ts)):
            w = ts[i - WINDOW + 1: i + 1]
            with np.errstate(divide="ignore", invalid="ignore"):
                o = np.asarray(evaluate(expr, self._ext_values([self.twin.rows[x] for x in w])), dtype=float)
                f = np.asarray(evaluate(expr, self._ext_values([self.twin.forecast(x) for x in w])), dtype=float)
            rels.append((o - f) / np.maximum(np.abs(f), 1e-9))
        rels = np.nan_to_num(np.array(rels))
        return np.maximum(np.sqrt((rels ** 2).mean(0)) * 1.3, 0.01) * np.ones(cfg.C)

    def _extension_z(self, t: int) -> np.ndarray:
        if not self.extensions:
            return np.zeros((cfg.C, 0))
        ts = [t - i for i in range(WINDOW)]
        o_vals = self._ext_values([self.twin.rows[x] for x in ts])
        f_vals = self._ext_values([self.twin.forecast(x) for x in ts])
        out = []
        for e in self.extensions.values():
            with np.errstate(divide="ignore", invalid="ignore"):
                o = np.asarray(evaluate(e["expr"], o_vals), dtype=float)
                f = np.asarray(evaluate(e["expr"], f_vals), dtype=float)
            out.append(np.nan_to_num((o - f) / np.maximum(np.abs(f), 1e-9) / e["sigma"]))
        return np.stack(out, axis=1)

    # ================================================================== potential (taste model)
    def compute_potential(self) -> list[dict]:
        t = self.view.t - 1
        rows = [self.view.observed[x] for x in range(max(0, t - 23), t + 1)]
        self.potential_alloc = getattr(self, "potential_alloc", {})
        out = []
        demands = [self.taste.country_demand(self.view.sample_users(c, 0, 150) + self.view.sample_users(c, 1, 150))
                   for c in range(cfg.C)]
        global_demand = np.mean(demands, axis=0)
        for c, country in enumerate(cfg.COUNTRIES):
            demand = demands[c]
            imp = sum(r["impressions"][c].sum(0) for r in rows)
            st = sum(r["starts"][c].sum(0) for r in rows)
            co = sum(r["completions"][c].sum(0) for r in rows)
            mg = sum((r["revenue"][c] - r["rewards"][c]).sum(0) for r in rows)
            a_cur = imp / imp.sum()
            s, cr, m = st / np.maximum(imp, 1e-9), co / np.maximum(st, 1e-9), mg / np.maximum(co, 1e-9)

            def margin_k(a: np.ndarray) -> np.ndarray:
                # Assumed taste elasticity: start rate rises with under-served demand (exponent 0.6).
                return imp.sum() * a * s * (a_cur / a) ** 0.6 * cr * m

            def margin(a: np.ndarray) -> float:
                return float(margin_k(a).sum())

            cur = margin(a_cur)
            best, a_best = cur, a_cur
            for lam in np.linspace(0, 1, 21):
                a = a_cur ** (1 - lam) * demand ** lam
                a = a / a.sum()
                v = margin(a)
                if v > best:
                    best, a_best = v, a
            gain = margin_k(a_best) - margin_k(a_cur)        # margin dollars each category adds per day
            # Top categories: under-served here (the taste-matched feed adds margin) and distinctive for local taste
            # (demand index vs the global average), so the story differs by region.
            index = demand / global_demand
            under = [int(k) for k in np.where(gain > 0)[0]]
            top = sorted(under, key=lambda k: -index[k])[:2]
            explain = self.taste.explain_signals(top[0]) if top else []
            self.potential_alloc[c] = a_best
            out.append({"iso": country.iso, "potential_usd_day": round(max(best - cur, 0.0), 0),
                        "potential_pct": round(max(best / cur - 1, 0.0) * 100, 1) if cur > 0 else 0.0,
                        "current_margin_usd_day": round(cur, 0),
                        "demand_index": {cfg.CATEGORIES[k]: round(float(index[k]), 2) for k in range(cfg.K)},
                        "top_categories": [cfg.CATEGORIES[k] for k in top], "explain": explain})
        return out

    # ================================================================== views
    def get_incident(self, inc_id: str) -> dict | None:
        return next((i for i in self.incidents if i["id"] == inc_id), None)

    def incident_summary(self, inc: dict) -> dict:
        out = {k: inc[k] for k in ("id", "title", "country", "status", "severity", "impact_usd_h", "risk_7d_usd",
                                   "reaction_h")}
        out["card"] = self.card(inc)
        return out

    def _excess_accounts(self, c: int, p: int, t: int, hours: int = 12) -> int:
        """Sign-ups above the twin's baseline on this platform over the recent anomaly (estimate of new accounts)."""
        n = 0.0
        for x in range(t - hours + 1, t + 1):
            if x in self.twin.rows:
                n += max(float(self.twin.rows[x]["new_accounts"][c, p] - self.twin.forecast(x)["new_accounts"][c, p]), 0)
        return int(round(n))

    def card(self, inc: dict) -> dict:
        """Plain-language issue card for the UI (no z-scores; those stay in the engineer report)."""
        name = _country_phrase(cfg.COUNTRIES[inc["c"]].name)
        plat = inc["platform"]
        cats = " and ".join(OFFER_NOUN[k] for k in inc["fix_categories"][:2])
        top = inc["hypotheses"][0]
        rec = next(f for f in inc["fixes"] if f["id"] == inc["recommended"])
        word = "proven" if top["verdict"] == "supported" else "likely" if top["verdict"] == "partial" else "unclear"
        proof = f"{word}, {top['explained']:.0%} explained"
        d_rev, d_mg = inc["delta_revenue_usd_h"], inc["delta_margin_usd_h"]
        if inc["kind"] == "fraud":
            looks = f"+{_fmt_usd(max(d_rev, 0))}/h of 'growth'"
            happened = (f"About {inc['excess_accounts']} fake accounts appeared on {plat} in {name} and are completing "
                        f"high-paying {cats} offers.")
            why = (f"Their stated interests don't match what they do and they share emulator devices ({proof}).")
        elif inc["kind"] == "tracking":
            looks = f"{_signed_usd(d_rev)}/h of revenue"
            happened = (f"Advertisers stopped confirming most {cats} completions from {plat} users in {name}, but we "
                        f"still pay those users their rewards.")
            why = f"Revenue per completion collapsed while user activity stayed normal ({proof})."
        elif inc["kind"] == "organic":
            looks = f"{_signed_usd(d_rev)}/h of revenue"
            happened = f"Many new real users joined on {plat} in {name}."
            why = f"Their tastes look genuine, so this is real growth ({proof})."
        else:
            looks = f"{_signed_usd(d_mg)}/h of margin"
            happened = f"{KPI_LABEL[inc['kpi']].capitalize()} in {name} moved away from what we expected."
            why = f"The change starts at {MECH_LABEL[inc['root']].lower() if inc['root'] else 'an unknown step'} ({proof})."
        if rec["id"] == "none":
            todo = "No action needed; keep watching."
        else:
            short = {"block_cluster": "suspend the fake accounts and their devices",
                     "verify_new_accounts": f"require phone and device checks for new {plat} sign-ups",
                     "cap_rewards": "lower rewards on the targeted offers",
                     "notify_advertiser": "ask the advertisers to fix their tracking",
                     "pause_offers": "pause the affected offers for 18 h",
                     "pause_notify": "pause the affected offers and ask the advertisers to fix tracking"}[rec["id"]]
            todo = f"{rec['name']}: {short}. Saves about {_fmt_usd(rec['delta_p50_usd'])} over the next 7 days."
        v = inc["verification"]["status"]
        status_line = {
            "open": "Needs a decision", "persisting": "Needs a decision",
            "fix_applied": "Fix applied · verifying" if v == "pending" else "Fix applied · prediction missed, model recalibrated",
            "verified": "Prediction verified", "resolved": "Resolved" + (" · prediction verified" if v == "verified" else ""),
        }[inc["status"]]
        if inc["status"] in ("fix_applied", "verified", "resolved") and inc["applied"]:
            todo = f"Done: {FIX_INFO[inc['applied']][0].lower()} applied."
        return {"title": inc["title"], "looks_like": looks, "at_stake_7d_usd": inc["risk_7d_usd"],
                "what_happened": happened, "why": why, "what_to_do": todo, "status_line": status_line}

    # ------------------------------------------------------------------ visual series
    def _seg_cats(self, inc: dict) -> list[int]:
        return list(inc["fix_categories"]) if inc["kind"] == "tracking" else [inc["k"]]

    @staticmethod
    def _seg_value(r: dict, kpi: str, c: int, p: int, cats: list[int]) -> float:
        if kpi in ("new_accounts", "active_users"):
            return float(r[kpi][c, p])

        def g(key: str) -> float:
            return float(np.asarray(r[key][c, p])[cats].sum())
        if kpi == "margin":
            return g("revenue") - g("rewards")
        if kpi == "quality_per_completion":
            return g("quality") / max(g("completions"), 1e-9)
        return g(kpi)

    def _seg_sigma(self, kpi: str, c: int, p: int, k: int) -> float:
        """Hourly relative (log) noise of the segment's KPI, from the twin's learned mechanism noise."""
        tw = self.twin
        if kpi == "new_accounts":
            return float(tw.sig_new[c, p])
        if kpi == "active_users":
            return float(tw.sig_ret[c, p])
        if kpi == "quality_per_completion":
            return float(tw.sig["quality"][c, p, k])
        acc = tw.sig_ret[c, p] ** 2 + sum(tw.sig[m][c, p, k] ** 2 for m in ("impressions", "starts", "completions"))
        if kpi in ("revenue", "margin"):
            acc += tw.sig["revenue"][c, p, k] ** 2
        elif kpi == "rewards":
            acc += tw.sig["rewards"][c, p, k] ** 2
        elif kpi == "quality":
            acc += tw.sig["quality"][c, p, k] ** 2
        return float(np.sqrt(acc))

    def series(self, inc: dict, hours: int = 48) -> dict:
        """Alerting KPI for the root segment, hourly up to now, with the twin's expectation and a ±2σ band."""
        tw = self.twin
        c, p, kpi = inc["c"], inc["p"], inc["kpi"]
        cats = self._seg_cats(inc)
        sig = self._seg_sigma(kpi, c, p, cats[0])
        start = max(min(tw.rows), self.t - hours + 1)
        pts = []
        for t in range(start, self.t + 1):
            actual = self._seg_value(tw.rows[t], kpi, c, p, cats)
            exp = self._seg_value(tw.forecast(t), kpi, c, p, cats)
            lo = exp - abs(exp) * (1 - np.exp(-2 * sig))
            hi = exp + abs(exp) * (np.exp(2 * sig) - 1)
            pts.append({"t": t, "label": hour_label(t), "actual": round(actual, 3), "expected": round(exp, 3),
                        "lo": round(float(lo), 3), "hi": round(float(hi), 3)})
        # First hour of the excursion that led to detection: the start of the last run of out-of-band hours
        # at or before detection.
        left = None
        outside = [pt for pt in pts if pt["t"] <= inc["detected_at"] and not pt["lo"] <= pt["actual"] <= pt["hi"]]
        if outside:
            run_end = outside[-1]["t"]
            left = run_end
            out_ts = {pt["t"] for pt in outside}
            while left - 1 in out_ts:
                left -= 1
        seg_name = f"{cfg.COUNTRIES[c].name} · {inc['platform']}"
        if kpi not in ("new_accounts", "active_users"):
            seg_name += " · " + ", ".join(cfg.CATEGORIES[x] for x in cats)
        return {"kpi": kpi, "label": f"{KPI_LABEL[kpi].capitalize()}, {seg_name}",
                "unit": "USD/h" if kpi in ("revenue", "rewards", "margin") else "ratio"
                if kpi == "quality_per_completion" else "per hour",
                "points": pts, "left_zone_at": None if left is None else {"t": left, "label": hour_label(left)}}

    def incident_detail(self, inc: dict) -> dict:
        keys = ("id", "title", "status", "country", "platform", "category", "detected_at", "trail", "graph",
                "contributions", "hypotheses", "l3", "fixes", "recommended", "applied", "verification", "reports",
                "severity", "impact_usd_h", "risk_7d_usd", "reaction_h", "kind", "root")
        out = {k: inc[k] for k in keys}
        out["reports"] = self.reports_for(inc)
        out["card"] = self.card(inc)
        ser = self.series(inc)
        out["series"] = ser["points"]
        out["series_meta"] = {k: ser[k] for k in ("kpi", "label", "unit")}
        out["left_zone_at"] = ser["left_zone_at"]
        return out

    def country_status(self, c: int) -> str:
        if self.waiting[c]:
            return "waiting"
        if any(i["c"] == c and i["status"] in ("open", "persisting") for i in self.incidents):
            return "incident"
        if self.explaining[c]:
            return "explained"
        if self.last is not None and (np.abs(self.health[c]) >= WATCH_Z or self.consec[c].any()):
            return "watch"
        return "ok"

    def state(self) -> dict:
        t = self.t
        last = self.view.observed[-1]
        s = _with_formulas(_country_sums(last))
        pot = {p["iso"]: p["potential_usd_day"] for p in self.potential}
        pct = {p["iso"]: p["potential_pct"] for p in self.potential}
        day, hour = divmod(t, 24)
        dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day % 7]
        countries = []
        for c, country in enumerate(cfg.COUNTRIES):
            countries.append({
                "iso": country.iso, "name": country.name, "lat": country.lat, "lng": country.lng,
                "status": self.country_status(c),
                "health_z": round(float(self.health[c]), 2) if self.last is not None else 0.0,
                "kpis": {k: round(float(s[k][c]), 4 if k == "quality_per_completion" else 2) for k in KPIS},
                "potential_usd_day": pot.get(country.iso, 0.0),
                "potential_pct": pct.get(country.iso, 0.0),
            })
        return {
            "clock": {"t": t, "label": f"Day {day + 1} · {dow} {hour:02d}:00 UTC"},
            "countries": countries,
            "incidents": [self.incident_summary(i) for i in self.incidents],
            "explained": list(self.explained),
            "attention": {"watched_series": cfg.C * (len(KPIS) + len(self.extensions)),
                          "investigations": self.investigations, "l3_runs": self.l3_runs},
        }

    def country_detail(self, c: int) -> dict:
        t = self.t
        ts = [t - i for i in range(WINDOW)]
        tw = self.twin
        rows, fcs = [tw.rows[x] for x in ts], [tw.forecast(x) for x in ts]
        segs = []
        platforms = []
        gp = tw.given_parents(sorted(ts))
        for p in range(cfg.P):
            # Platform-level users: sign-ups vs seasonal baseline; active users given sign-ups (returning users).
            nz = round(tw.z_of(gp["new_accounts"], c, p), 1)
            az = round(tw.z_of(gp["active_users"], c, p), 1)
            n_o = sum(r["new_accounts"][c, p] for r in rows)
            n_f = sum(x["new_accounts"][c, p] for x in fcs)
            platforms.append({"platform": cfg.PLATFORMS[p], "new_accounts_z": nz, "active_users_z": az,
                              "new_accounts_h": round(float(n_o / WINDOW), 1),
                              "new_accounts_expected_h": round(float(n_f / WINDOW), 1)})
            for k in range(cfg.K):
                kz = {"new_accounts": nz}
                for key, m in (("completions", "completions"), ("revenue", "revenue"), ("rewards", "rewards")):
                    o = sum(r[key][c, p, k] for r in rows)
                    f = sum(x[key][c, p, k] for x in fcs)
                    sig = np.sqrt(sum(tw.sig[mm][c, p, k] ** 2 for mm in ("impressions", "starts", "completions"))
                                  + tw.sig_ret[c, p] ** 2 + (tw.sig[m][c, p, k] ** 2 if m != "completions" else 0))
                    kz[key] = round(float((o / max(f, 1e-9) - 1) / (sig / np.sqrt(WINDOW))), 1)
                qo = sum(r["quality"][c, p, k] for r in rows) / max(sum(r["completions"][c, p, k] for r in rows), 1e-9)
                qf = sum(x["quality"][c, p, k] for x in fcs) / max(sum(x["completions"][c, p, k] for x in fcs), 1e-9)
                kz["quality_per_completion"] = round(float((qo / qf - 1) / (tw.sig["quality"][c, p, k] / np.sqrt(WINDOW))), 1)
                dm = sum(r["revenue"][c, p, k] - r["rewards"][c, p, k] for r in rows) - \
                    sum(x["revenue"][c, p, k] - x["rewards"][c, p, k] for x in fcs)
                segs.append({"platform": cfg.PLATFORMS[p], "category": cfg.CATEGORIES[k], "kpi_z": kz,
                             "deviation_usd_h": round(float(dm / WINDOW), 2)})
        return {"iso": cfg.COUNTRIES[c].iso, "name": cfg.COUNTRIES[c].name, "segments": segs, "platforms": platforms}


# ====================================================================== keyword fallback
_PHRASES = [
    ("reward cost", "rewards"), ("user rewards", "rewards"), ("rewards", "rewards"), ("reward", "rewards"),
    ("advertiser revenue", "revenue"), ("revenue", "revenue"), ("contribution margin", "margin"),
    ("margin", "margin"), ("completed offers", "completions"), ("completed offer", "completions"),
    ("completions", "completions"), ("completion", "completions"), ("new accounts", "new_accounts"),
    ("new account", "new_accounts"), ("sign ups", "new_accounts"), ("signups", "new_accounts"),
    ("sign-ups", "new_accounts"), ("active users", "active_users"), ("active user", "active_users"),
    ("users", "active_users"), ("user", "active_users"), ("impressions", "impressions"),
    ("impression", "impressions"), ("offer starts", "starts"), ("starts", "starts"), ("start", "starts"),
    ("valuable users", "quality"), ("quality", "quality"),
]
_OPS = [(" divided by ", " / "), (" per ", " / "), (" minus ", " - "), (" plus ", " + "), (" times ", " * ")]
_RULES = [
    (("start rate",), "starts / impressions"), (("completion rate",), "completions / starts"),
    (("take rate",), "margin / revenue"), (("margin rate",), "margin / revenue"), (("arpu",), "revenue / active_users"),
    (("revenue per user",), "revenue / active_users"), (("reward rate",), "rewards / revenue"),
]


def _phrase_to_expr(text: str) -> str:
    s = " " + text.lower().strip() + " "
    for a, b in _OPS:
        s = s.replace(a, b)
    for a, b in _PHRASES:
        s = re.sub(rf"(?<![a-z_]){re.escape(a)}(?![a-z_])", f" {b} ", s)
    tokens = re.findall(r"[a-z_]+|\d+\.?\d*|[()+\-*/]", s)
    allowed = {b for _, b in _PHRASES}
    return " ".join(tok for tok in tokens if tok in allowed or not tok[0].isalpha())


def keyword_formula(name: str, description: str, known: set[str]) -> tuple[str | None, str]:
    """Deterministic fallback: explicit '= formula', fixed rules, then 'X per Y' phrases."""
    text = f"{description}".strip()
    if "=" in text:
        rhs = text.split("=", 1)[1]
        for cand in (rhs.strip(), _phrase_to_expr(rhs)):
            try:
                parse_expression(cand, known)
                return cand, "user"
            except (ValueError, SyntaxError):
                continue
    low = f"{name} {description}".lower()
    for keys, expr in _RULES:
        if any(k in low for k in keys):
            return expr, "keyword rules"
    for cand in (_phrase_to_expr(name), _phrase_to_expr(description)):
        cand = re.sub(r"\s+", " ", cand).strip()
        if not cand:
            continue
        try:
            parse_expression(cand, known)
            return cand, "keyword rules"
        except (ValueError, SyntaxError):
            continue
    return None, "keyword rules"
