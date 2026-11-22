import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { METRIC_PLAIN } from '../lib/metrics'
import { PLATFORM_LABEL } from '../lib/theme'
import type { CountryDetail, GraphEdge, IncidentDetail, ReplayBlock } from '../lib/types'
import CausalGraph, { defaultRole, type NodeRole } from './charts/CausalGraph'
import FakeAccountPicture from './charts/FakeAccountPicture'
import NormalZoneChart from './charts/NormalZoneChart'

// "Watch Argus think": a ~15 s replay of how Argus found an issue, level by level.
// 1 Earth: the number leaves its usual band. 2 Country: one driving cell glows. 3 The causal graph, walked from margin
// backwards. 4 Users: the fake-account ring. 5 Proof: the "without them" line drops back into the band.
// Uses the incident detail's `replay` block when the backend sends it; otherwise builds each step from the same data.

type Step = { key: string; level: string; sentence: string; ms: number }
const VERDICT_ROLE: Record<string, NodeRole> = { fine: 'normal', affected: 'symptom', cause: 'broke' }
const WALK_MS = 380
const STORY = ['new_accounts', 'active_users', 'starts', 'completions', 'revenue', 'rewards', 'margin']
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const plain = (id: string) => METRIC_PLAIN[id] ?? id
const timeOf = (label?: string) => label?.replace(/^[A-Za-z]{3}\s+/, '') ?? ''

// Walk order when the backend has none: from margin backwards (breadth-first over parents), story nodes only.
function deriveWalk(d: IncidentDetail) {
  const nodes = new Map(d.graph.nodes.map((n) => [n.id, n]))
  const keep = new Set([...STORY.filter((id) => nodes.has(id)), ...d.graph.nodes.filter((n) => n.state === 'root').map((n) => n.id)])
  const order: string[] = []
  const q = ['margin']
  while (q.length) {
    const id = q.shift()!
    if (order.includes(id) || !keep.has(id)) continue
    order.push(id)
    for (const e of d.graph.edges) if (e.target === id) q.push(e.source)
  }
  const verdict = (id: string): 'fine' | 'affected' | 'cause' => {
    const role = defaultRole(nodes.get(id)!)
    return role === 'broke' ? 'cause' : role === 'symptom' || id === 'margin' || id === 'revenue' ? (nodes.get(id)!.state === 'normal' ? 'fine' : 'affected') : 'fine'
  }
  return order.map((node) => ({ node, verdict: verdict(node) }))
}

export default function ReplayView({ detail: d, countryName, onClose }: { detail: IncidentDetail; countryName: string; onClose: () => void }) {
  const r: ReplayBlock = d.replay ?? {}
  const [country, setCountry] = useState<CountryDetail | null>(null)
  const [step, setStep] = useState(0)
  const [walkAt, setWalkAt] = useState(0)
  const [without, setWithout] = useState(false)
  const still = reducedMotion()

  useEffect(() => {
    if (!r.l2?.cells) api.country(d.country).then(setCountry).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.country])

  const walk = useMemo(() => r.walk?.steps ?? deriveWalk(d), [d, r.walk])
  const platform = PLATFORM_LABEL[d.platform] ?? d.platform
  const series = (r.l1?.series ?? d.series ?? []).slice(-24)
  const leftAt = r.l1?.left_at ?? d.left_zone_at
  // Proof uses the incident's own series: the "without them" line is computed for exactly that number.
  const proofSeries = (d.series ?? []).slice(-24)
  const metricWord = (d.series_meta?.label ?? 'The key number').split(',')[0].replace(/^New accounts/i, 'New sign-ups')
  const s = d.l3?.summary
  const shared = d.l3?.groups?.filter((g) => g.count >= 2).length ?? 0
  const share = d.counterfactual?.explained_share

  // One line per step (≤ 60 characters at 1440×900): the backend's sentence when it is that short, else a short one.
  const fit = (backend: string | undefined, short: string) => (backend && backend.length <= 60 ? backend : short)
  const cause = walk.find((w) => w.verdict === 'cause')
  const causeWord = cause ? plain(cause.node).toLowerCase() : 'the cause'
  const fraud = /fake/i.test(d.short_title ?? d.title)
  const tracking = /confirm/i.test(d.short_title ?? d.title) // advertisers stopped confirming offers
  const steps: Step[] = [
    { key: 'l1', level: 'Level 1 · the whole business', sentence: fit(r.l1?.sentence, `${metricWord} left the usual range${leftAt ? ` at ${timeOf(leftAt.label)}` : ''}.`), ms: 2800 },
    { key: 'l2', level: `Level 2 · inside ${countryName}`, sentence: fit(r.l2?.sentence, `It's ${/^(United|Netherlands|Philippines)/.test(countryName) ? 'the ' : ''}${countryName}, ${platform}.`), ms: 2300 },
    { key: 'walk', level: 'Level 2 · how the numbers connect', sentence: `Walking back from margin… ${causeWord} ${/s$/.test(causeWord) ? 'are' : 'is'} the cause.`, ms: 600 + walk.length * WALK_MS + 1000 },
    ...(d.l3 && s
      ? [{ key: 'l3', level: 'Level 3 · the users', sentence: fit(r.l3?.sentence, `${s.n_flagged} of ${s.n_users} users look fake, on ${shared || s.top_devices.length} shared devices.`), ms: 3000 }]
      : []),
    ...(d.counterfactual && share != null
      ? [{ key: 'proof', level: 'Proof', sentence: fit(r.proof?.sentence, `${fraud ? 'Without the fake accounts' : tracking ? 'With normal confirmations' : 'Without the cause'}, ${Math.round(share * 100)}% of the change disappears.`), ms: 3000 }]
      : []),
  ]
  const cur = steps[Math.min(step, steps.length - 1)]

  // Advance through the steps; Esc skips to the end (the issue card).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])
  useEffect(() => {
    if (still) return
    const t = window.setTimeout(() => (step + 1 < steps.length ? setStep(step + 1) : onClose()), cur.ms)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, still, steps.length])
  // Graph walk: one node every 450 ms. Proof: the "without them" line switches on after a beat.
  useEffect(() => {
    setWalkAt(0)
    setWithout(false)
    if (cur.key === 'walk') {
      const id = window.setInterval(() => setWalkAt((n) => Math.min(walk.length, n + 1)), WALK_MS)
      return () => window.clearInterval(id)
    }
    if (cur.key === 'proof') {
      const id = window.setTimeout(() => setWithout(true), 900)
      return () => window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.key])

  if (still) return <StaticList steps={steps} onClose={onClose} />

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-sm" role="dialog" aria-label="How Argus found this">
      <div className="flex items-center justify-between px-10 pt-8 text-[13px] text-fg-2">
        <span>How Argus found this</span>
        <button onClick={onClose} className="hover:text-fg">
          Skip · Esc
        </button>
      </div>
      <div key={cur.key} className="fade-up mx-auto mt-6 max-w-[960px] px-10 text-center">
        <div className="text-[13px] uppercase tracking-[0.18em] text-accent">{cur.level}</div>
        <h2 className="mt-3 whitespace-nowrap text-[28px] font-semibold leading-snug text-fg">{cur.sentence}</h2>
      </div>

      <div key={`v-${cur.key}`} className="fade-in mx-auto flex w-full max-w-[960px] flex-1 items-center justify-center px-10">
        {cur.key === 'l1' && series.length > 1 && (
          <div className="w-full">
            <div className="mb-2 text-[13px] text-fg-2">{r.l1?.metric ?? d.series_meta?.label}, last 24 h</div>
            <NormalZoneChart series={series} leftAt={leftAt} width={896} height={300} showStart={false} />
            <div className="mt-2 text-[13px] text-fg-2">Grey = usual for this time of day</div>
          </div>
        )}
        {cur.key === 'l2' && <Grid detail={d} cells={r.l2?.cells} country={country} />}
        {cur.key === 'walk' && <Walk d={d} walk={walk} at={walkAt} />}
        {cur.key === 'l3' && d.l3 && <FakeAccountPicture l3={d.l3} width={896} height={380} />}
        {cur.key === 'proof' && proofSeries.length > 1 && (
          <div className="w-full">
            <div className={`mb-3 inline-flex items-center gap-3 rounded-full px-4 py-2 text-[16px] ring-1 transition ${without ? 'bg-ok/10 text-fg ring-ok/50' : 'text-fg-2 ring-line'}`}>
              <span className={`relative h-6 w-10 rounded-full transition ${without ? 'bg-ok' : 'bg-line'}`}>
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-fg transition-all duration-300 ${without ? 'left-5' : 'left-1'}`} />
              </span>
              Without them
            </div>
            <div className="mb-2 text-[13px] text-fg-2">{d.series_meta?.label}, last 24 h</div>
            <NormalZoneChart
              series={proofSeries}
              leftAt={d.left_zone_at}
              values={without ? proofSeries.map((p) => new Map((d.counterfactual?.series ?? []).map((q) => [q.t, q.value])).get(p.t) ?? p.actual) : undefined}
              width={896}
              height={300}
              showStart={false}
            />
          </div>
        )}
      </div>

      <div className="flex justify-center gap-2.5 pb-10">
        {steps.map((st, i) => (
          <button
            key={st.key}
            onClick={() => setStep(i)}
            aria-label={`Step ${i + 1}`}
            className={`h-2 rounded-full transition-all ${i === step ? 'w-8 bg-fg' : i < step ? 'w-2 bg-fg-2' : 'w-2 bg-line'}`}
          />
        ))}
      </div>
    </div>
  )
}

// Level 2: compact platform × offer grid; only the driving cell glows pink.
function Grid({ detail: d, cells, country }: { detail: IncidentDetail; cells?: { platform: string; category: string; z: number; driving: boolean }[]; country: CountryDetail | null }) {
  const rows =
    cells ??
    (country?.segments ?? []).map((s) => ({
      platform: s.platform,
      category: s.category,
      z: Object.values(s.kpi_z).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0),
      driving: s.platform.toLowerCase() === d.platform.toLowerCase() && (!d.category || s.category.toLowerCase().startsWith(d.category.toLowerCase().slice(0, 4))),
    }))
  if (!rows.length) return <div className="h-64 w-[520px] animate-pulse rounded-2xl bg-line/40" />
  const platforms = [...new Set(rows.map((c) => c.platform))]
  const categories = [...new Set(rows.map((c) => c.category))]
  return (
    <div className="grid items-center gap-x-3 gap-y-2" style={{ gridTemplateColumns: `180px repeat(${platforms.length}, 120px)` }}>
      <div />
      {platforms.map((p) => (
        <div key={p} className="text-center text-[16px] text-fg-2">
          {PLATFORM_LABEL[p] ?? p}
        </div>
      ))}
      {categories.map((c) => (
        <div key={c} className="contents">
          <div className="text-[16px] text-fg-2">{c}</div>
          {platforms.map((p) => {
            const cell = rows.find((x) => x.platform === p && x.category === c)
            return <div key={p} className={`h-9 rounded-lg ${cell?.driving ? 'replay-glow bg-problem' : 'bg-line/50'}`} />
          })}
        </div>
      ))}
    </div>
  )
}

// The causal graph, walked from margin backwards: each node gets its verdict in turn; the cause pulses.
function Walk({ d, walk, at }: { d: IncidentDetail; walk: { node: string; verdict: string }[]; at: number }) {
  const ids = new Set(walk.map((w) => w.node))
  const nodes = d.graph.nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, label: plain(n.id) }))
  const edges: GraphEdge[] = d.graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const done = walk.slice(0, at)
  const roles = Object.fromEntries(done.map((w) => [w.node, VERDICT_ROLE[w.verdict] ?? 'normal']))
  const cause = done.find((w) => w.verdict === 'cause')?.node
  return (
    <div className="w-full max-w-[600px]">
      <CausalGraph nodes={nodes} edges={edges} roles={roles} pending={walk.slice(at).map((w) => w.node)} pulse={cause} dims={{ W: 600, nodeW: 170, nodeH: 44, row: 62 }} />
    </div>
  )
}

// Reduced motion: the same story as a static list.
function StaticList({ steps, onClose }: { steps: Step[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95" role="dialog" aria-label="How Argus found this">
      <div className="w-[640px] rounded-3xl bg-panel p-8 ring-1 ring-line">
        <h2 className="text-[24px] font-semibold text-fg">How Argus found this</h2>
        <ol className="mt-5 space-y-4">
          {steps.map((s, i) => (
            <li key={s.key} className="flex gap-4">
              <span className="num mt-0.5 text-[13px] text-fg-2">{i + 1}</span>
              <div>
                <div className="text-[13px] text-accent">{s.level}</div>
                <div className="text-[16px] text-fg">{s.sentence}</div>
              </div>
            </li>
          ))}
        </ol>
        <button onClick={onClose} className="mt-6 rounded-full bg-line px-5 py-2 text-[13px] text-fg hover:bg-line/70">
          Back to the issue
        </button>
      </div>
    </div>
  )
}
