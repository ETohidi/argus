import { useEffect, useState, type ReactNode } from 'react'
import CausalGraph from './charts/CausalGraph'
import FanChart, { relativeSeries } from './charts/FanChart'
import L3Scatter from './charts/L3Scatter'
import NormalZoneChart from './charts/NormalZoneChart'
import ShapleyBars from './charts/ShapleyBars'
import { bestHypothesis, isBaseline, isFraud, shortHypothesis } from '../lib/incident'
import { MINT, NEUTRAL, VERDICT_COLOR, usd } from '../lib/theme'
import type { IncidentDetail, Level } from '../lib/types'

export type EvidenceTab = 'graph' | 'users' | 'proof' | 'fixes' | 'details'
const TABS: { id: EvidenceTab; label: string }[] = [
  { id: 'graph', label: 'Causal graph' },
  { id: 'users', label: 'Users' },
  { id: 'proof', label: 'Proof' },
  { id: 'fixes', label: 'Fixes' },
  { id: 'details', label: 'Details' },
]

// Plain names for the metric nodes used in captions.
const PLAIN: Record<string, string> = {
  new_accounts: 'new sign-ups',
  active_users: 'active users',
  impressions: 'offer views',
  starts: 'offer starts',
  completions: 'completions',
  revenue: 'revenue',
  rewards: 'user rewards',
  quality: 'user quality',
  margin: 'margin',
  quality_per_completion: 'quality per completion',
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function graphCaption(d: IncidentDetail) {
  const root = d.graph.nodes.find((n) => n.state === 'root')
  if (!root) return 'No single broken link was found in the causal graph.'
  const rootName = PLAIN[root.id] ?? root.label.toLowerCase()
  // The money metrics a dashboard shows, downstream of the root: they only move because the root broke.
  const downstream = new Set<string>()
  const queue = [root.id]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of d.graph.edges) if (e.source === id && !downstream.has(e.target)) downstream.add(e.target), queue.push(e.target)
  }
  const symptoms = ['revenue', 'margin'].filter((id) => downstream.has(id)).map((id) => PLAIN[id])
  if (!symptoms.length) return `${cap(rootName)} broke; everything downstream follows from it.`
  return `${cap(rootName)} broke. ${cap(joinAnd(symptoms))} ${symptoms.length === 1 ? 'is only a symptom' : 'are only symptoms'}.`
}

function usersCaption(d: IncidentDetail) {
  if (!d.l3) return `No need to look at individual users: the broken link is ${PLAIN[d.root ?? ''] ?? 'a business mechanism'}, not people.`
  const s = d.l3.summary
  const emu = s.top_devices.some((x) => /emu|emulator|sdk|generic/i.test(x))
  return `${s.n_flagged} new accounts whose tastes make no sense, ${emu ? 'on shared emulators' : `sharing devices like ${s.top_devices[0]}`}.`
}

function proofCaption(d: IncidentDetail) {
  const best = bestHypothesis(d)
  if (!best) return 'No hypothesis tested yet.'
  const pct = Math.round(best.explained * 100)
  if (best.verdict !== 'supported') return `No explanation passes the bar yet: the best one accounts for ${pct}% of the change.`
  const without = isFraud(d) ? 'without them' : d.kind === 'tracking' || d.root === 'revenue' ? 'with tracking repaired' : `without ${shortHypothesis(best.name).toLowerCase()}`
  return `Replay the twin ${without}: ${pct}% of the change disappears.`
}

function fixesCaption(d: IncidentDetail) {
  const best = d.fixes.find((f) => f.id === d.recommended)
  if (!best) return 'No fixes tested.'
  return `Fast-forward a week in the twin: ${best.name.toLowerCase()} keeps ${usd(best.delta_p50_usd)} more margin than doing nothing.`
}

type Props = {
  detail: IncidentDetail | null
  title: string
  initialTab?: EvidenceTab
  approving: boolean
  onApprove: (fixId: string) => void
  onClose: () => void
}

// L3 / engineer: one large visual per tab with one sentence saying what it proves.
export default function EvidenceView({ detail: d, title, initialTab = 'graph', approving, onApprove, onClose }: Props) {
  const [tab, setTab] = useState<EvidenceTab>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const caption = !d
    ? 'Loading the evidence…'
    : tab === 'graph'
      ? graphCaption(d)
      : tab === 'users'
        ? usersCaption(d)
        : tab === 'proof'
          ? proofCaption(d)
          : tab === 'fixes'
            ? fixesCaption(d)
            : 'How Argus got here, and what it told each audience.'

  return (
    <div className="fade-in absolute inset-0 z-40 overflow-y-auto bg-bg/80 backdrop-blur-md">
      <div className="mx-auto max-w-[1040px] px-10 pb-16 pt-8">
        <button onClick={onClose} className="text-[13px] text-fg-2 hover:text-fg">
          ← Back to the Earth
        </button>
        <div className="mt-6 text-[13px] text-fg-2">The evidence</div>
        <h1 className="text-[24px] font-semibold text-fg">{title}</h1>

        <nav className="mt-8 flex gap-1 border-b border-line">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 pb-3 text-[16px] transition ${
                tab === t.id ? 'border-ok text-fg' : 'border-transparent text-fg-2 hover:text-fg'
              } ${t.id === 'details' ? 'ml-auto' : ''}`}
            >
              {t.id !== 'details' && <span className="num mr-2 text-[13px] text-fg-2">{i + 1}</span>}
              {t.label}
            </button>
          ))}
        </nav>

        <p key={`${tab}-${caption}`} className="fade-in mt-10 max-w-[760px] text-[24px] font-medium leading-snug text-fg">
          {caption}
        </p>

        <div key={tab} className="fade-in mt-10">
          {!d ? (
            <div className="h-[420px] animate-pulse rounded-2xl bg-panel/60" />
          ) : tab === 'graph' ? (
            <Frame narrow>
              <CausalGraph nodes={d.graph.nodes} edges={d.graph.edges} />
            </Frame>
          ) : tab === 'users' ? (
            d.l3 ? (
              <Frame narrow>
                <L3Scatter l3={d.l3} />
              </Frame>
            ) : (
              <Empty text="This incident was settled at the segment level (L2); no accounts were sampled." />
            )
          ) : tab === 'proof' ? (
            <Proof d={d} />
          ) : tab === 'fixes' ? (
            <Fixes d={d} approving={approving} onApprove={onApprove} />
          ) : (
            <Details d={d} />
          )}
        </div>
      </div>
    </div>
  )
}

function Frame({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto rounded-2xl bg-panel/60 p-8 ring-1 ring-line ${narrow ? 'max-w-[720px]' : ''}`}>{children}</div>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl bg-panel/60 p-10 text-center text-[16px] text-fg-2 ring-1 ring-line">{text}</div>
}

// Proof: replay the twin without the cause. The big toggle slides the observed line onto the counterfactual,
// back into the normal band; the other explanations tested are listed below.
function Proof({ d }: { d: IncidentDetail }) {
  const [without, setWithout] = useState(false)
  const cf = d.counterfactual
  const series = (d.series ?? []).slice(-24) // last day: the excursion stays readable
  const cfByT = new Map((cf?.series ?? []).map((p) => [p.t, p.value]))
  const cfValues = series.map((p) => cfByT.get(p.t) ?? p.actual)
  const share = cf?.explained_share ?? bestHypothesis(d)?.explained ?? 0
  const question = cf ? `What would it look like ${cf.label.charAt(0).toLowerCase()}${cf.label.slice(1)}?` : null
  const hyps = [...d.hypotheses].sort((a, b) => b.explained - a.explained)
  return (
    <div className="space-y-6">
      {series.length > 1 && (
        <Frame>
          {question && (
            <button
              onClick={() => setWithout((w) => !w)}
              aria-pressed={without}
              className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left text-[16px] ring-1 transition ${without ? 'bg-ok/10 text-fg ring-ok/50' : 'bg-bg/40 text-fg ring-line hover:ring-accent/60'}`}
            >
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${without ? 'bg-ok' : 'bg-line'}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-fg transition-all duration-300 ${without ? 'left-6' : 'left-1'}`} />
              </span>
              {question}
            </button>
          )}
          <div className="mt-6">
            <NormalZoneChart series={series} leftAt={d.left_zone_at} values={without ? cfValues : undefined} width={896} height={300} fontSize={13} />
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-6 text-[13px] text-fg-2">
            <span>{d.series_meta?.label ?? 'Alerting metric'} · grey = normal for this hour</span>
            <span className={`text-[16px] transition-opacity duration-300 ${without ? 'text-ok opacity-100' : 'opacity-0'}`}>
              {Math.round(share * 100)}% of the change disappears{share >= 0.8 ? ' — cause proven' : ''}
            </span>
          </div>
        </Frame>
      )}
      <Frame>
        <h3 className="mb-4 text-[16px] text-fg">Every explanation Argus tested</h3>
        <div className="space-y-4">
          {hyps.map((h) => (
            <div key={h.name} className="grid grid-cols-[1fr_180px_56px_80px] items-center gap-4 text-[13px]">
              <span className={h.verdict === 'supported' ? 'text-fg' : 'text-fg-2'}>{shortHypothesis(h.name)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(1, h.explained * 100)}%`, background: VERDICT_COLOR[h.verdict] }} />
              </div>
              <span className="num text-right text-fg">{Math.round(h.explained * 100)}%</span>
              <span className="text-right" style={{ color: h.verdict === 'supported' ? VERDICT_COLOR.supported : undefined }}>
                {h.verdict === 'supported' ? 'Proven' : h.verdict === 'partial' ? 'Partial' : 'Ruled out'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[13px] text-fg-2">Share of the change that vanishes when the twin is replayed without that explanation. Proven at 80% or more.</p>
      </Frame>
    </div>
  )
}

function Fixes({ d, approving, onApprove }: { d: IncidentDetail; approving: boolean; onApprove: (id: string) => void }) {
  const baseline = d.fixes.find(isBaseline) ?? d.fixes[0]
  const reference = baseline.p50
  const rel = d.fixes.map((f) => relativeSeries(f, reference))
  const lo = Math.min(0, ...rel.flatMap((r) => r.p10))
  const hi = Math.max(0, ...rel.flatMap((r) => r.p90))
  const v = d.verification
  return (
    <div>
      {d.applied && (
        <div className={`mb-6 rounded-2xl p-5 text-[16px] ring-1 ${v.status === 'verified' ? 'text-ok ring-ok/40' : v.status === 'missed' ? 'text-problem ring-problem/40' : 'text-fg ring-line'}`}>
          {v.status === 'verified'
            ? `Prediction verified: actual first-day margin ${usd(v.actual ?? 0)} landed inside the band.`
            : v.status === 'missed'
              ? 'Prediction missed: the twin was recalibrated.'
              : `${d.fixes.find((f) => f.id === d.applied)?.name ?? 'Fix'} applied. Verifying the prediction after 24 h.`}
        </div>
      )}
      <div className="grid grid-cols-2 gap-5">
        {d.fixes.map((f) => {
          const best = f.id === d.recommended
          const applied = d.applied === f.id
          const base = isBaseline(f)
          return (
            <div key={f.id} className={`rounded-2xl p-6 ring-1 ${best || applied ? 'bg-panel/80 ring-ok/50' : 'bg-panel/50 ring-line'}`}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="text-[16px] font-semibold text-fg">{f.name}</div>
                <div className={`num text-[16px] ${base ? 'text-fg-2' : f.delta_p50_usd >= 0 ? 'text-ok' : 'text-problem'}`}>
                  {base ? 'baseline' : `${f.delta_p50_usd >= 0 ? '+' : ''}${usd(f.delta_p50_usd)}`}
                </div>
              </div>
              <div className="mt-1 text-[13px] text-fg-2">{best ? 'Best option' : applied ? 'Applied' : f.advertiser_risk}</div>
              <div className="mt-4">
                <FanChart fix={f} reference={reference} domain={[lo, hi]} color={best || applied ? MINT : NEUTRAL} width={420} height={170} />
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-fg-2">{f.description}</p>
              {!d.applied && !base && (
                <button
                  disabled={approving}
                  onClick={() => onApprove(f.id)}
                  className={`mt-4 rounded-xl px-4 py-2 text-[13px] font-semibold disabled:opacity-50 ${best ? 'bg-ok text-bg hover:bg-ok' : 'bg-line text-fg hover:bg-line'}`}
                >
                  {approving ? 'Applying…' : 'Approve'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-6 text-[13px] text-fg-2">Margin gained vs doing nothing over 7 days. Band: p10–p90 of 40 simulated futures; line: median.</p>
    </div>
  )
}

const LEVEL_TEXT: Record<Level, string> = { L1: 'Business', L2: 'Segment', L3: 'Users' }

function Details({ d }: { d: IncidentDetail }) {
  const [aud, setAud] = useState<'ceo' | 'manager' | 'engineer'>('ceo')
  return (
    <div className="grid grid-cols-[1.1fr_1fr] gap-8">
      <section>
        <h3 className="mb-4 text-[16px] font-semibold text-fg">Decision trail</h3>
        <ol className="relative ml-2 border-l border-line">
          {d.trail.map((s, i) => (
            <li key={i} className="fade-up relative pb-6 pl-6 last:pb-0" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-fg-2" />
              <div className="flex items-baseline gap-3 text-[13px] text-fg-2">
                <span>
                  {s.level} · {LEVEL_TEXT[s.level]}
                </span>
                <span className="num">hour {s.t}</span>
              </div>
              <div className="mt-0.5 text-[13px] font-medium text-fg">{s.action}</div>
              <div className="text-[13px] leading-relaxed text-fg-2">{s.finding}</div>
            </li>
          ))}
        </ol>
      </section>
      <section className="space-y-8">
        <div>
          <div className="mb-4 flex items-baseline gap-4">
            <h3 className="text-[16px] font-semibold text-fg">Reports</h3>
            {(['ceo', 'manager', 'engineer'] as const).map((a) => (
              <button key={a} onClick={() => setAud(a)} className={`text-[13px] ${aud === a ? 'text-ok' : 'text-fg-2 hover:text-fg'}`}>
                {a === 'ceo' ? 'CEO' : a === 'manager' ? 'Manager' : 'Engineer'}
              </button>
            ))}
          </div>
          <p key={aud} className="fade-in text-[13px] leading-relaxed text-fg">
            {d.reports[aud]}
          </p>
          {d.reports.source && <div className="mt-2 text-[13px] text-fg-2">Written by {d.reports.source === 'llm' ? 'the language model' : 'templates'}.</div>}
        </div>
        <div>
          <h3 className="mb-4 text-[16px] font-semibold text-fg">Shapley contributions to the margin change</h3>
          <ShapleyBars items={d.contributions} />
        </div>
      </section>
    </div>
  )
}
