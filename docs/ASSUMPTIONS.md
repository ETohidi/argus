# Simulation assumptions

Argus runs against a simulated marketplace (`backend/argus/reality.py`). All numbers are invented to look like a
rewarded user-acquisition business; none are Almedia data. The assumptions that shape what the demo shows:

## Marketplace
- 20 countries, 2 platforms, 6 advertiser categories; ~$1.51M advertiser revenue and ~43% contribution margin per day.
- Users get 55% of the advertiser payout as reward; advertisers confirm 97% of completions.
- Hourly noise: lognormal 3% plus Poisson-like counting noise on impressions, starts and completions; 6% on sign-ups.
- **Offer mix:** payout per completion varies by offer within a category (lognormal σ = 0.06 per segment-hour), and the
  share of completions advertisers confirm wobbles (σ = 0.015). Revenue and rewards per completion are therefore never
  exactly constant, so counterfactual explanations land below 100%.

## Production feed (Potential mode)
- **The simulated production feed is payout-heavy:** offer impressions per category ∝ local taste × payout
  (`alloc ∝ pref · payout^1.0`). This is a modelling choice for the demo, not a claim about Freecash's real feed.
- Start rate responds to taste fit: `start_rate ∝ (taste share / feed share)^0.6`, clipped to [0.4, 2.0].
- Argus's twin does not know the true taste shares. It estimates local demand from the taste model applied to sampled
  users' life signals, and assumes the same elasticity (0.6) without the clipping. It searches feeds that blend the
  current allocation with that demand and reports the best one as `potential_usd_day` / `potential_pct`.
- Validation (seed 42): the twin shows **+2.0–2.9%** margin per country; re-running the simulator with the twin's
  proposed feed yields **+4.7–6.0%**. The twin is conservative because it does not know about the clipping.

## Incidents
- **Bot farm:** ramps to 320 accounts over 10 h; bots are always online, complete fintech and strategy-game offers,
  deliver ~no advertiser value, use emulator devices and scripted onboarding answers.
- **Advertiser reaction:** if fake completions exceed 20% of a country × category for 24 h, advertisers charge back half
  the revenue; after 48 h they cut budget (impressions × 0.4).
- **Tracking break:** advertisers confirm only 15% of completions in the affected segment until fixed (~18 h after
  notification).
- **Data delay:** one country delivers 45% of rows for one hour; backfilled two hours later.
- **Fix effects in the twin:** block (fake activity → 0, 30% chance the farm returns at half strength after 24–48 h),
  verify new accounts (fake activity × 0.05, genuine sign-ups × 0.88), cap rewards (fake activity × 0.4, reward share
  0.35 on strategy + fintech, genuine starts × 0.85). The attack trajectory is extrapolated from excess sign-ups.

## Alerting
- L1 watch: 20 countries × 6 KPIs (plus added metrics), 3 h windows, z against the twin forecast with backtest σ
  (inflated 1.3× for out-of-sample use).
- Amber ("watch") at |z| ≥ 4 for one hour; an incident needs 2+ hours and impact > $150/h, or |z| ≥ 8.
