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
  if (!best) return { proven: false, text: 'Still investigating.' }
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

// One status sentence for the home screen, most urgent first.
export function statusSentence(state: WorldState): { text: string; tone: 'ok' | 'issue' | 'neutral' } {
  const name = (iso: string) => state.countries.find((c) => c.iso === iso)?.name ?? iso
  const decide = state.incidents.filter(needsDecision)
  if (decide.length) return { text: decide.length === 1 ? `1 issue needs a decision · ${name(decide[0].country)}` : `${decide.length} issues need a decision`, tone: 'issue' }
  const applied = state.incidents.filter((i) => i.status === 'fix_applied')
  if (applied.length) return { text: `Fix applied in ${name(applied[0].country)} · verifying the prediction`, tone: 'neutral' }
  const watch = state.countries.filter((c) => c.status === 'watch')
  if (watch.length) return { text: watch.length === 1 ? `Watching ${watch[0].name} closely` : `Watching ${watch.length} markets closely`, tone: 'issue' }
  const waiting = state.countries.filter((c) => c.status === 'waiting')
  if (waiting.length) return { text: `Waiting for data from ${waiting.map((c) => c.name).join(', ')} · no alert`, tone: 'neutral' }
  const explained = state.countries.filter((c) => c.status === 'explained')
  if (explained.length) return { text: explained.length === 1 ? '1 change explained · no alert' : `${explained.length} changes explained · no alert`, tone: 'neutral' }
  return { text: `All ${state.countries.length} markets within forecast`, tone: 'ok' }
}
