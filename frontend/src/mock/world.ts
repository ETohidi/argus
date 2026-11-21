// A small, deterministic stand-in for the backend world. Shapes match docs/API.md.
// It is not a model of the business: just enough dynamics to make the UI tell the
// demo story (promo explained, bot farm detected, fix approved, prediction verified).
import type {
  CountryDetail,
  CountryState,
  CountryStatus,
  ExplainedChange,
  IncidentDetail,
  IncidentStatus,
  IncidentSummary,
  InjectType,
  Kpis,
  MetricResponse,
  PotentialResponse,
  WorldState,
} from '../lib/types'
import { buildIncidentDetail } from './incidents'

export const MOCK_COUNTRIES = [
  ['US', 'United States', 39.8, -98.6, 900_000, 1.0, -6],
  ['CA', 'Canada', 56.1, -106.3, 140_000, 0.9, -5],
  ['MX', 'Mexico', 23.6, -102.5, 200_000, 0.3, -6],
  ['BR', 'Brazil', -14.2, -51.9, 300_000, 0.3, -3],
  ['GB', 'United Kingdom', 54.0, -2.0, 250_000, 0.85, 0],
  ['DE', 'Germany', 51.2, 10.4, 200_000, 0.85, 1],
  ['FR', 'France', 46.6, 2.2, 150_000, 0.7, 1],
  ['NL', 'Netherlands', 52.1, 5.3, 70_000, 0.8, 1],
  ['ES', 'Spain', 40.5, -3.7, 110_000, 0.55, 1],
  ['IT', 'Italy', 41.9, 12.6, 100_000, 0.55, 1],
  ['PL', 'Poland', 51.9, 19.1, 90_000, 0.4, 1],
  ['SE', 'Sweden', 60.1, 18.6, 50_000, 0.8, 1],
  ['TR', 'Türkiye', 39.0, 35.2, 100_000, 0.2, 3],
  ['ZA', 'South Africa', -30.6, 22.9, 60_000, 0.25, 2],
  ['IN', 'India', 20.6, 78.9, 350_000, 0.12, 5],
  ['ID', 'Indonesia', -0.8, 113.9, 180_000, 0.15, 7],
  ['PH', 'Philippines', 12.9, 121.8, 160_000, 0.15, 8],
  ['JP', 'Japan', 36.2, 138.3, 120_000, 0.9, 9],
  ['KR', 'South Korea', 35.9, 127.8, 80_000, 0.7, 9],
  ['AU', 'Australia', -25.3, 133.8, 90_000, 0.85, 10],
] as const

export const CATEGORY_KEYS = ['casual', 'strategy', 'fintech', 'streaming', 'shopping', 'surveys']
export const PLATFORMS = ['ios', 'android']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TOTAL_DAU = MOCK_COUNTRIES.reduce((s, c) => s + c[4], 0)

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type MockEvent = {
  type: InjectType
  country: string
  platform: string
  start: number
  fixedAt?: number
}

type MockIncident = {
  id: string
  kind: 'bot_farm' | 'tracking_break'
  country: string
  platform: string
  detectedAt: number
  appliedAt: number | null
  applied: string | null
  event: MockEvent
}

export class MockWorld {
  t = 336
  rand = mulberry32(42)
  events: MockEvent[] = []
  incidents: MockIncident[] = []
  explained: ExplainedChange[] = []
  extraMetrics: string[] = []
  noise = new Map<string, number>()

  label() {
    const day = Math.floor(this.t / 24)
    const hh = String(this.t % 24).padStart(2, '0')
    return `Day ${day + 1} · ${DAYS[day % 7]} ${hh}:00 UTC`
  }

  inject(type: InjectType, country: string, platform?: string) {
    const ev: MockEvent = {
      type,
      country,
      platform: platform ?? (type === 'bot_farm' ? 'android' : type === 'tracking_break' ? 'ios' : 'all'),
      start: this.t,
    }
    this.events.push(ev)
    return ev
  }

  step(hours: number) {
    for (let i = 0; i < hours; i++) {
      this.t += 1
      this.noise.clear()
      this.tick()
    }
  }

  // Event severity in z units at the current time (0 = no effect).
  eventZ(ev: MockEvent): number {
    const h = this.t - ev.start
    if (h < 0) return 0
    const inc = this.incidents.find((i) => i.event === ev)
    if (ev.type === 'bot_farm') {
      const ramp = Math.min(9.3, 0.6 + 1.45 * h)
      if (inc?.appliedAt != null) return ramp * Math.exp(-(this.t - inc.appliedAt) / 3)
      return ramp
    }
    if (ev.type === 'tracking_break') {
      const ramp = Math.min(7.4, 1.2 + 2.2 * h)
      if (inc?.appliedAt != null) return ramp * Math.exp(-(this.t - inc.appliedAt) / 4)
      return ramp
    }
    if (ev.type === 'promo') return h < 48 ? 5.1 : 0
    return 0
  }

  tick() {
    for (const ev of this.events) {
      const h = this.t - ev.start
      if (ev.type === 'promo' && h >= 1 && h < 48 && !this.explained.some((e) => e.country === ev.country && e.t >= ev.start)) {
        this.explained.unshift({
          t: this.t,
          country: ev.country,
          event: 'Weekend Boost (games)',
          naive_z: 5.1,
          twin_z: 0.7,
        })
      }
      if ((ev.type === 'bot_farm' || ev.type === 'tracking_break') && !this.incidents.some((i) => i.event === ev)) {
        const z = this.eventZ(ev)
        const prevZ = ev.type === 'bot_farm' ? Math.min(9.3, 0.6 + 1.45 * (h - 1)) : Math.min(7.4, 1.2 + 2.2 * (h - 1))
        if (z >= 4 && prevZ >= 4 - 1.5) {
          this.incidents.unshift({
            id: `inc-${this.incidents.length + 1}`,
            kind: ev.type,
            country: ev.country,
            platform: ev.platform,
            detectedAt: this.t,
            appliedAt: null,
            applied: null,
            event: ev,
          })
        }
      }
    }
  }

  incidentStatus(inc: MockIncident): IncidentStatus {
    if (inc.appliedAt == null) return this.t - inc.detectedAt >= 6 ? 'persisting' : 'open'
    const since = this.t - inc.appliedAt
    if (since >= 48) return 'resolved'
    if (since >= 24) return 'verified'
    return 'fix_applied'
  }

  impact(inc: MockIncident) {
    const z = this.eventZ(inc.event)
    const base = inc.kind === 'bot_farm' ? 812 : 640
    return Math.round(base * (z / (inc.kind === 'bot_farm' ? 9.3 : 7.4)) * 10) / 10
  }

  summary(inc: MockIncident): IncidentSummary {
    const name = MOCK_COUNTRIES.find((c) => c[0] === inc.country)?.[1] ?? inc.country
    const title =
      inc.kind === 'bot_farm'
        ? `Fraud cluster inflating ${name} Android installs`
        : `Advertiser confirms only 15% of ${name} iOS game completions`
    const status = this.incidentStatus(inc)
    const impact = this.impact(inc)
    return {
      id: inc.id,
      title,
      country: inc.country,
      status,
      severity: impact > 400 ? 'high' : impact > 150 ? 'medium' : 'low',
      impact_usd_h: impact,
    }
  }

  countryNoise(iso: string) {
    let n = this.noise.get(iso)
    if (n === undefined) {
      n = (this.rand() + this.rand() + this.rand() - 1.5) * 1.1
      this.noise.set(iso, n)
    }
    return n
  }

  kpis(iso: string, dau: number, value: number, tz: number, z: number, kind?: InjectType): Kpis {
    const localHour = (((this.t + tz) % 24) + 24) % 24
    const rhythm = 0.55 + 0.45 * Math.sin(((localHour - 9) / 24) * 2 * Math.PI) + 0.25
    const share = dau / TOTAL_DAU
    const completions = (854_000 / 24) * share * rhythm * (1 + this.countryNoise(iso) * 0.02)
    const avgPayout = 3.1 * value + 0.5
    let newAccounts = (dau * 0.012 * rhythm) / 24 * 4
    let comp = completions
    let revenue = completions * avgPayout
    let quality = 0.41
    if (kind === 'bot_farm') {
      newAccounts *= 1 + z * 0.35
      comp *= 1 + z * 0.03
      revenue *= 1 + z * 0.02
      quality *= 1 - z * 0.045
    }
    if (kind === 'tracking_break') revenue *= 1 - z * 0.035
    const rewards = comp * avgPayout * 0.55
    return {
      new_accounts: Math.round(newAccounts),
      completions: Math.round(comp),
      revenue: Math.round(revenue),
      rewards: Math.round(rewards),
      margin: Math.round(revenue * 0.97 - rewards),
      quality_per_completion: Math.round(quality * 1000) / 1000,
    }
  }

  countryState(): CountryState[] {
    return MOCK_COUNTRIES.map(([iso, name, lat, lng, dau, value, tz]) => {
      let status: CountryStatus = 'ok'
      let z = this.countryNoise(iso)
      let kind: InjectType | undefined
      for (const ev of this.events.filter((e) => e.country === iso)) {
        const h = this.t - ev.start
        if (h < 0) continue
        if (ev.type === 'data_delay' && h < 3) {
          status = 'waiting'
          kind = 'data_delay'
        }
        if (ev.type === 'promo' && h >= 1 && h < 48 && status === 'ok') {
          status = 'explained'
          z = 0.7
          kind = 'promo'
        }
        if (ev.type === 'bot_farm' || ev.type === 'tracking_break') {
          const ez = this.eventZ(ev)
          if (ez < 0.8) continue
          kind = ev.type
          const signed = ev.type === 'bot_farm' ? -ez * 0.88 : -ez
          if (Math.abs(signed) > Math.abs(z)) z = signed
          const inc = this.incidents.find((i) => i.event === ev)
          if (inc && inc.appliedAt == null) status = 'incident'
          else if (inc && Math.abs(z) < 2) status = 'ok'
          else if (Math.abs(z) >= 2.5) status = inc ? 'incident' : 'watch'
        }
      }
      return {
        iso,
        name,
        lat,
        lng,
        status,
        health_z: Math.round(z * 100) / 100,
        kpis: this.kpis(iso, dau, value, tz, Math.abs(z), kind),
        potential_usd_day: this.potential(iso),
      }
    })
  }

  potential(iso: string) {
    const c = MOCK_COUNTRIES.find((x) => x[0] === iso)!
    const r = mulberry32(iso.charCodeAt(0) * 31 + iso.charCodeAt(1))()
    return Math.round(((c[4] / 1000) * c[5] * (6 + r * 22) + 300) / 10) * 10
  }

  state(): WorldState {
    const incidents = this.incidents.map((i) => this.summary(i))
    const active = incidents.filter((i) => i.status === 'open' || i.status === 'persisting' || i.status === 'fix_applied')
    return {
      clock: { t: this.t, label: this.label() },
      countries: this.countryState(),
      incidents,
      explained: this.explained.slice(0, 10),
      attention: {
        watched_series: 120 + this.extraMetrics.length * 20,
        investigations: active.length,
        l3_runs: this.incidents.filter((i) => i.kind === 'bot_farm').length,
      },
    }
  }

  incident(id: string): IncidentDetail | null {
    const inc = this.incidents.find((i) => i.id === id)
    if (!inc) return null
    const s = this.summary(inc)
    return buildIncidentDetail({
      id: inc.id,
      title: s.title,
      status: s.status,
      kind: inc.kind,
      country: inc.country,
      countryName: MOCK_COUNTRIES.find((c) => c[0] === inc.country)?.[1] ?? inc.country,
      platform: inc.platform,
      detectedAt: inc.detectedAt,
      applied: inc.applied,
      hoursSinceApply: inc.appliedAt == null ? null : this.t - inc.appliedAt,
      impact: this.impact(inc),
    })
  }

  approve(id: string, fixId: string): IncidentDetail | null {
    const inc = this.incidents.find((i) => i.id === id)
    if (!inc) return null
    if (inc.appliedAt == null) {
      inc.appliedAt = this.t
      inc.applied = fixId
    }
    return this.incident(id)
  }

  country(iso: string): CountryDetail | null {
    const c = MOCK_COUNTRIES.find((x) => x[0] === iso)
    if (!c) return null
    const r = mulberry32(this.t * 97 + iso.charCodeAt(0) * 7 + iso.charCodeAt(1))
    const g = () => (r() + r() + r() - 1.5) * 1.2
    const ev = this.events.find((e) => e.country === iso && (e.type === 'bot_farm' || e.type === 'tracking_break'))
    const z = ev ? this.eventZ(ev) : 0
    const promo = this.events.find((e) => e.country === iso && e.type === 'promo' && this.t - e.start < 48)
    const segments: CountryDetail['segments'] = []
    for (const platform of PLATFORMS) {
      for (const category of CATEGORY_KEYS) {
        const kz = { completions: g(), revenue: g(), rewards: g(), quality_per_completion: g() }
        let dev = g() * 12
        if (ev?.type === 'bot_farm' && platform === ev.platform && (category === 'fintech' || category === 'strategy')) {
          const w = category === 'fintech' ? 1 : 0.62
          kz.completions = 7.1 * w * (z / 9.3) + g() * 0.3
          kz.revenue = 6.0 * w * (z / 9.3) + g() * 0.3
          kz.rewards = 6.5 * w * (z / 9.3) + g() * 0.3
          kz.quality_per_completion = -8.2 * w * (z / 9.3) + g() * 0.3
          dev = 310 * w * (z / 9.3)
        }
        if (ev?.type === 'tracking_break' && platform === ev.platform && (category === 'casual' || category === 'strategy')) {
          const w = category === 'casual' ? 1 : 0.7
          kz.revenue = -7.4 * w * (z / 7.4) + g() * 0.3
          dev = -420 * w * (z / 7.4)
        }
        if (promo && (category === 'casual' || category === 'strategy')) {
          kz.rewards = 0.6 + g() * 0.3
        }
        segments.push({
          platform,
          category,
          kpi_z: Object.fromEntries(Object.entries(kz).map(([k, v]) => [k, Math.round(v * 100) / 100])),
          deviation_usd_h: Math.round(dev * 10) / 10,
        })
      }
    }
    return { iso, name: c[1], segments }
  }

  potentialResponse(): PotentialResponse {
    const cats = ['games', 'shopping', 'fintech', 'streaming', 'surveys']
    const why = ['gaming', 'commuter', 'money-minded', 'binge watcher', 'bargain hunter', 'quick earner']
    return {
      countries: MOCK_COUNTRIES.map(([iso]) => {
        const r = mulberry32(iso.charCodeAt(1) * 13 + iso.charCodeAt(0))
        const a = Math.floor(r() * cats.length)
        const b = (a + 1 + Math.floor(r() * (cats.length - 1))) % cats.length
        const e = Math.floor(r() * why.length)
        return {
          iso,
          potential_usd_day: this.potential(iso),
          top_categories: [cats[a], cats[b]],
          explain: [why[e], why[(e + 2) % why.length]],
        }
      }),
    }
  }

  addMetric(name: string, description: string): MetricResponse {
    const text = `${name} ${description}`.toLowerCase()
    const ratio = text.includes('per') || text.includes('/') || text.includes('rate')
    const formula = text.includes('reward') && text.includes('complet') ? 'rewards / completions' : ratio ? 'revenue / completions' : 'revenue - rewards'
    const parents = formula.split(/[^a-z_]+/).filter(Boolean)
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'new_metric'
    this.extraMetrics.push(id)
    return {
      node: {
        id,
        label: name,
        expr: formula,
        parents,
        kind: 'formula',
        aggregation: ratio ? 'ratio' : 'sum',
        unit: ratio ? 'USD/completion' : 'USD/h',
      },
      validation: {
        ok: true,
        checks: [
          { name: 'names', ok: true, detail: `parents ${parents.join(', ')} exist in the metric graph` },
          { name: 'identity', ok: true, detail: 'recomputed on 336 h of history, max rel. error 2.1e-12' },
          {
            name: 'aggregation',
            ok: true,
            detail: ratio ? 'ratio → non-additive; country totals use Σnum / Σden' : 'sum → additive across countries',
          },
          { name: 'monitoring', ok: true, detail: 'baseline learned, now watched in 20 countries' },
        ],
      },
    }
  }
}
