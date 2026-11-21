// Plain-language summaries derived from an incident detail (shared by the issue card and evidence view).
import { PLATFORM_LABEL, usd } from './theme'
import type { Fix, IncidentDetail, IncidentSummary, WorldState } from './types'

export const isBaseline = (f: Fix) => f.id === 'none' || f.id === 'do_nothing' || /do nothing/i.test(f.name)

export const recommendedFix = (d: IncidentDetail) => d.fixes.find((f) => f.id === (d.applied ?? d.recommended))

export const shortHypothesis = (name: string) => name.replace(/\s*\(.*\)\s*$/, '')

export const needsDecision = (i: IncidentSummary) => i.status === 'open' || i.status === 'persisting'

export function bestHypothesis(d: IncidentDetail) {
  return [...d.hypotheses].sort((a, b) => b.explained - a.explained)[0]
}

// Segment from the L2 trail step ("segments covering 80%: Fintech apps (71%), Strategy games (20%)"), else the category.
export function affectedCategories(d: IncidentDetail): string[] {
  for (const step of d.trail) {
    const m = step.finding.match(/segments covering \d+%:\s*([^;]+)/i)
    if (m) {
      const cats = m[1].split(/,\s*/).map((c) => c.replace(/\s*\(.*?\)\s*/g, '').trim()).filter(Boolean)
      if (cats.length) return cats
    }
  }
  return d.category ? [d.category] : []
}

export const isFraud = (d: IncidentDetail) => d.kind === 'fraud' || d.root === 'new_accounts' || !!d.l3

export function whatHappened(d: IncidentDetail, countryName: string) {
  const plat = PLATFORM_LABEL[d.platform] ?? d.platform
  const cats = affectedCategories(d).slice(0, 2).join(' and ').toLowerCase()
  if (isFraud(d)) return `${plat} sign-ups in ${countryName} jumped. Completions in ${cats} look like growth, but quality fell.`
  if (d.kind === 'tracking' || d.root === 'revenue')
    return `Advertisers confirm far fewer ${plat} completions in ${countryName} (${cats}). Activity is normal, revenue is not.`
  return d.trail[0]?.finding ?? d.title
}

export function why(d: IncidentDetail) {
  const best = bestHypothesis(d)
  if (!best) return { proven: false, text: 'Still looking into it.' }
  const pct = Math.round(best.explained * 100)
  const name = shortHypothesis(best.name)
  if (best.verdict === 'supported') return { proven: true, text: `Proven, ${pct}% explained: ${name.charAt(0).toLowerCase()}${name.slice(1)}.` }
  return { proven: false, text: `Not yet proven. Best lead: ${name.toLowerCase()} (${pct}%).` }
}

export function whatToDo(d: IncidentDetail) {
  const fix = recommendedFix(d)
  if (!fix) return 'No action tested yet.'
  return `${fix.name}: +${usd(fix.delta_p50_usd)} margin this week vs doing nothing.`
}

// Name of a planned event, e.g. "Weekend Boost (Casual games, …): rewards +36% …" → "Weekend Boost".
export const eventName = (event: string) => event.split(/[(:]/)[0].trim()

// One status sentence for the home screen, most urgent first.
export function statusSentence(state: WorldState): { text: string; tone: 'ok' | 'issue' | 'neutral' } {
  const name = (iso: string) => state.countries.find((c) => c.iso === iso)?.name ?? iso
  const decide = [...new Set(state.incidents.filter(needsDecision).map((i) => i.country))]
  if (decide.length) return { text: decide.length === 1 ? `${name(decide[0])} needs attention` : `${decide.length} countries need attention`, tone: 'issue' }
  const applied = state.incidents.filter((i) => i.status === 'fix_applied')
  if (applied.length) return { text: `Fix applied in ${name(applied[0].country)} · checking the result`, tone: 'neutral' }
  const watch = state.countries.filter((c) => c.status === 'watch')
  if (watch.length) return { text: watch.length === 1 ? `${watch[0].name} looks unusual · watching` : `${watch.length} countries look unusual · watching`, tone: 'issue' }
  const waiting = state.countries.filter((c) => c.status === 'waiting')
  if (waiting.length) return { text: `Data still arriving from ${waiting.map((c) => c.name).join(', ')}`, tone: 'neutral' }
  const explained = state.countries.filter((c) => c.status === 'explained')
  if (explained.length === 1) {
    const ev = state.explained.find((e) => e.country === explained[0].iso)
    return { text: `${explained[0].name}: ${ev ? eventName(ev.event) : 'planned change'}, as planned`, tone: 'neutral' }
  }
  if (explained.length) return { text: `${explained.length} planned changes, as expected`, tone: 'neutral' }
  return { text: `All ${state.countries.length} countries as expected`, tone: 'ok' }
}

// "Fake-account cluster in Canada (Android)" → "Fake accounts in Canada"; "Tracking break in United Kingdom (iOS, …)"
// → "Tracking break in the United Kingdom".
export function shortTitle(title: string) {
  let t = title.replace(/\s*\(.*\)\s*$/, '').replace(/^Fake-account cluster/i, 'Fake accounts')
  t = t.replace(/ in (United Kingdom|United States|Netherlands|Philippines)\b/, ' in the $1')
  return t
}

// The card's two plain lines: what is going on, and why Argus is sure.
export function cardLines(card: { what_happened: string; why: string } | undefined, fraud: boolean): [string, string] {
  if (!card) return ['…', '…']
  let first = card.what_happened.split(/(?<=\.)\s/)[0]
  const n = card.what_happened.match(/About (\d+) fake accounts/i)
  if (fraud && n) first = `About ${Math.round(Number(n[1]) / 10) * 10} fake accounts are farming high-paying offers.`
  const pct = card.why.match(/(\d+)% explained/)
  const clause = card.why
    .replace(/\s*\(.*?\)\s*\.?$/, '')
    .replace(/\s+and they share .*$/i, '')
    .replace(/^Their stated interests/i, 'their interests')
  const proven = /proven/i.test(card.why)
  const body = clause.charAt(0).toLowerCase() + clause.slice(1)
  const second = `${proven ? 'Proven' : 'Likely'}: ${body}${pct ? ` (${pct[1]}% explained)` : ''}.`
  return [first, second]
}

const KPI_PLAIN: Record<string, string> = {
  new_accounts: 'New sign-ups',
  active_users: 'Active users',
  completions: 'Completions',
  revenue: 'Revenue',
  rewards: 'Rewards',
  margin: 'Margin',
  quality_per_completion: 'Quality per completion',
}
export function metricLabel(meta: { kpi: string; unit: string } | undefined) {
  if (!meta) return ''
  const name = KPI_PLAIN[meta.kpi] ?? meta.kpi
  return `${name} ${/usd/i.test(meta.unit) ? '($) ' : ''}per hour`
}
