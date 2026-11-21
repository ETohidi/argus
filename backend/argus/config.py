"""Static description of the simulated Freecash-like rewarded-ad marketplace.

All numbers are invented for the demo. They are shaped to look like a rewarded
user-acquisition business (advertisers pay per completed offer, users get a
share as reward), not taken from Almedia data.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Country:
    iso: str
    name: str
    lat: float
    lng: float
    dau: int          # daily active users (simulated)
    ios_share: float  # share of users on iOS
    value: float      # advertiser payout multiplier vs. US
    tz: int           # UTC offset used for the daily rhythm
    region: str


COUNTRIES: list[Country] = [
    Country("US", "United States", 39.8, -98.6, 900_000, 0.55, 1.00, -6, "North America"),
    Country("CA", "Canada", 56.1, -106.3, 140_000, 0.45, 0.90, -5, "North America"),
    Country("MX", "Mexico", 23.6, -102.5, 200_000, 0.20, 0.30, -6, "Latin America"),
    Country("BR", "Brazil", -14.2, -51.9, 300_000, 0.15, 0.30, -3, "Latin America"),
    Country("GB", "United Kingdom", 54.0, -2.0, 250_000, 0.50, 0.85, 0, "Europe"),
    Country("DE", "Germany", 51.2, 10.4, 200_000, 0.38, 0.85, 1, "Europe"),
    Country("FR", "France", 46.6, 2.2, 150_000, 0.35, 0.70, 1, "Europe"),
    Country("NL", "Netherlands", 52.1, 5.3, 70_000, 0.40, 0.80, 1, "Europe"),
    Country("ES", "Spain", 40.5, -3.7, 110_000, 0.25, 0.55, 1, "Europe"),
    Country("IT", "Italy", 41.9, 12.6, 100_000, 0.30, 0.55, 1, "Europe"),
    Country("PL", "Poland", 51.9, 19.1, 90_000, 0.20, 0.40, 1, "Europe"),
    Country("SE", "Sweden", 60.1, 18.6, 50_000, 0.50, 0.80, 1, "Europe"),
    Country("TR", "Türkiye", 39.0, 35.2, 100_000, 0.15, 0.20, 3, "Europe"),
    Country("ZA", "South Africa", -30.6, 22.9, 60_000, 0.20, 0.25, 2, "Africa"),
    Country("IN", "India", 20.6, 78.9, 350_000, 0.05, 0.12, 5, "Asia"),
    Country("ID", "Indonesia", -0.8, 113.9, 180_000, 0.10, 0.15, 7, "Asia"),
    Country("PH", "Philippines", 12.9, 121.8, 160_000, 0.12, 0.15, 8, "Asia"),
    Country("JP", "Japan", 36.2, 138.3, 120_000, 0.65, 0.90, 9, "Asia"),
    Country("KR", "South Korea", 35.9, 127.8, 80_000, 0.35, 0.70, 9, "Asia"),
    Country("AU", "Australia", -25.3, 133.8, 90_000, 0.55, 0.85, 10, "Oceania"),
]
C = len(COUNTRIES)
ISO_INDEX = {c.iso: i for i, c in enumerate(COUNTRIES)}

PLATFORMS = ["iOS", "Android"]
P = len(PLATFORMS)

# Advertiser categories: the "offer" is the ad. Games are the biggest group,
# but Freecash-style walls also carry apps, surveys and shopping cashback.
CATEGORIES = ["Casual games", "Strategy games", "Fintech apps", "Streaming apps", "Shopping cashback", "Surveys"]
CATEGORY_KEYS = ["casual", "strategy", "fintech", "streaming", "shopping", "surveys"]
K = len(CATEGORIES)

PAYOUT = np.array([3.0, 6.0, 14.0, 4.0, 2.0, 0.9])            # advertiser pays per completion (USD, US level)
START_RATE = np.array([0.060, 0.040, 0.020, 0.050, 0.050, 0.080])  # starts per impression
COMPLETION_RATE = np.array([0.35, 0.22, 0.30, 0.45, 0.40, 0.70])   # completions per start
QUALITY = np.array([0.30, 0.38, 0.50, 0.40, 0.25, 0.60])          # valuable users delivered per completion
REWARD_SHARE = 0.55            # share of advertiser payout that goes to the user
ACCEPTANCE = 0.97              # share of completions the advertiser confirms and pays
IMPRESSIONS_PER_ACTIVE = 6.0   # offer-wall impressions per active user-hour
NEW_ACCOUNT_STAY = 3           # a new account stays active for ~3 hours on day one
PLATFORM_COMPLETION = np.array([1.08, 0.95])  # iOS users finish slightly more often

# Taste archetypes (life-signal based personas) and their affinity to each advertiser category.
ARCHETYPES = ["Puzzle commuter", "Competitive gamer", "Money-minded", "Binge watcher", "Bargain hunter", "Quick earner"]
ARCHETYPE_AFFINITY = np.array([
    # casual strategy fintech streaming shopping surveys
    [0.55, 0.10, 0.05, 0.10, 0.10, 0.10],
    [0.10, 0.60, 0.05, 0.15, 0.05, 0.05],
    [0.05, 0.05, 0.55, 0.05, 0.15, 0.15],
    [0.10, 0.05, 0.05, 0.60, 0.10, 0.10],
    [0.10, 0.05, 0.10, 0.10, 0.50, 0.15],
    [0.15, 0.05, 0.05, 0.05, 0.15, 0.55],
])
A = len(ARCHETYPES)

# Archetype mixture per country (invented, regionally plausible flavour).
# Archetype mixture per region (invented). Order: puzzle commuter (casual), competitive gamer (strategy),
# money-minded (fintech), binge watcher (streaming), bargain hunter (shopping), quick earner (surveys).
# North America / Europe / Oceania lean streaming + fintech; Latin America / Africa / Asia lean casual games +
# surveys; Japan and South Korea have a strong strategy-games audience. See docs/ASSUMPTIONS.md.
_REGION_MIX = {
    "North America": [0.12, 0.12, 0.26, 0.30, 0.12, 0.08],
    "Europe": [0.14, 0.10, 0.22, 0.30, 0.14, 0.10],
    "Oceania": [0.14, 0.12, 0.22, 0.30, 0.14, 0.08],
    "Latin America": [0.32, 0.08, 0.05, 0.10, 0.10, 0.35],
    "Africa": [0.28, 0.06, 0.06, 0.10, 0.10, 0.40],
    "Asia": [0.32, 0.14, 0.05, 0.08, 0.08, 0.33],
}
_COUNTRY_MIX = {
    "JP": [0.20, 0.42, 0.06, 0.14, 0.08, 0.10],
    "KR": [0.18, 0.46, 0.06, 0.12, 0.08, 0.10],
}


def country_archetype_mix() -> np.ndarray:
    rng = np.random.default_rng(7)
    mix = np.zeros((C, A))
    for i, c in enumerate(COUNTRIES):
        base = np.array(_COUNTRY_MIX.get(c.iso, _REGION_MIX[c.region]))
        mix[i] = base * rng.uniform(0.8, 1.2, A)
        mix[i] /= mix[i].sum()
    return mix


# Life signals collected at onboarding (the recommender's inputs).
SIGNALS = ["commutes daily", "plays console games", "reads finance news", "watches series weekly",
           "uses coupons", "student", "parent", "night owl", "follows esports", "travels often",
           "has a side hustle", "listens to podcasts"]
S = len(SIGNALS)
# Probability that an archetype shows each life signal.
ARCHETYPE_SIGNALS = np.array([
    [0.80, 0.15, 0.20, 0.40, 0.30, 0.30, 0.40, 0.20, 0.05, 0.30, 0.20, 0.60],
    [0.30, 0.80, 0.10, 0.40, 0.10, 0.50, 0.15, 0.70, 0.75, 0.15, 0.15, 0.30],
    [0.50, 0.15, 0.85, 0.20, 0.35, 0.10, 0.40, 0.20, 0.05, 0.50, 0.55, 0.60],
    [0.30, 0.25, 0.10, 0.90, 0.25, 0.35, 0.35, 0.60, 0.15, 0.25, 0.10, 0.40],
    [0.35, 0.10, 0.25, 0.30, 0.90, 0.20, 0.60, 0.15, 0.05, 0.20, 0.35, 0.25],
    [0.40, 0.15, 0.15, 0.25, 0.40, 0.55, 0.25, 0.40, 0.05, 0.10, 0.60, 0.20],
])

HISTORY_HOURS = 14 * 24
