import { useState, type ReactNode } from 'react'
import CausalGraph from './charts/CausalGraph'
import FanChart, { relativeSeries } from './charts/FanChart'
import L3Scatter from './charts/L3Scatter'
import ShapleyBars from './charts/ShapleyBars'
import { PLATFORM_LABEL, VERDICT_COLOR, usd } from '../lib/theme'
import type { Fix, IncidentDetail as Detail, IncidentStatus, Level } from '../lib/types'

type Audience = 'ceo' | 'manager' | 'engineer'
const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'ceo', label: 'CEO', hint: 'L1 · money' },
  { id: 'manager', label: 'Manager', hint: 'L2 · segment' },
  { id: 'engineer', label: 'Engineer', hint: 'L3 · mechanism' },
]

export const LEVEL_STYLE: Record<Level, string> = {
  L1: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
  L2: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  L3: 'bg-pink-500/15 text-pink-300 ring-pink-400/30',
}

export const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: 'bg-rose-500/15 text-rose-300',
  persisting: 'bg-rose-500/25 text-rose-200',
  fix_applied: 'bg-amber-500/15 text-amber-300',
  verified: 'bg-teal-500/15 text-teal-300',
  resolved: 'bg-slate-500/20 text-slate-300',
}

const FIX_COLORS = ['#94a3b8', '#2dd4bf', '#38bdf8', '#a78bfa', '#f472b6']
const isBaseline = (f: Fix) => f.id === 'none' || f.id === 'do_nothing' || /do nothing/i.test(f.name)

type Props = {
  detail: Detail
  onBack: () => void
  onApprove: (fixId: string) => void
  approving: boolean
}

export default function IncidentDetail({ detail, onBack, onApprove, approving }: Props) {
  const [aud, setAud] = useState<Audience>('engineer')
  const d = detail
  const show = {
    trail: aud !== 'ceo',
    graph: aud === 'engineer',
    shapley: aud !== 'ceo',
    hypotheses: aud !== 'ceo',
    l3: aud === 'engineer' && d.l3,
    fixes: true,
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-700/50 px-5 pb-3 pt-4">
        <button onClick={onBack} className="mb-2 text-[11px] text-slate-400 hover:text-slate-200">
          ← All incidents
        </button>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold leading-snug text-slate-50">{d.title}</h2>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${STATUS_STYLE[d.status]}`}>
            {d.status.replace('_', ' ')}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
          <Tag>{d.country}</Tag>
          <Tag>{PLATFORM_LABEL[d.platform] ?? d.platform}</Tag>
          <Tag>{d.category}</Tag>
          <Tag>detected h{d.detected_at}</Tag>
        </div>
        <div className="mt-3 grid grid-cols-3 rounded-lg bg-slate-900/70 p-0.5">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              onClick={() => setAud(a.id)}
              className={`rounded-md py-1.5 text-center transition ${aud === a.id ? 'bg-slate-700/80 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <div className="text-[12px] font-semibold">{a.label}</div>
              <div className="text-[9.5px] opacity-70">{a.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div key={aud} className="card fade-up border-l-2 !border-l-teal-400/70 p-3.5 text-[12.5px] leading-relaxed text-slate-200">
          <div className="section-title mb-1.5">Report for the {AUDIENCES.find((a) => a.id === aud)!.label}</div>
          {d.reports[aud]}
        </div>

        <Verification d={d} />

        {show.trail && (
          <Section title="Decision trail">
            <Trail d={d} />
          </Section>
        )}
        {show.graph && (
          <Section title="Causal graph walk">
            <CausalGraph nodes={d.graph.nodes} edges={d.graph.edges} />
          </Section>
        )}
        {show.shapley && (
          <Section title="Shapley contributions to Δmargin">
            <ShapleyBars items={d.contributions} />
          </Section>
        )}
        {show.hypotheses && (
          <Section title="Hypotheses · counterfactual in the twin">
            <Hypotheses d={d} />
          </Section>
        )}
        {show.l3 && d.l3 && (
          <Section title="L3 deep dive · taste coherence">
            <L3Scatter l3={d.l3} />
          </Section>
        )}
        {show.fixes && (
          <Section title={aud === 'ceo' ? 'Recommended action' : 'Fixes tested in the twin · fast-forward 7 days'}>
            <Fixes d={d} ceo={aud === 'ceo'} onApprove={onApprove} approving={approving} />
          </Section>
        )}
      </div>
    </div>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded bg-slate-800/80 px-1.5 py-0.5">{children}</span>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card fade-up p-3.5">
      <div className="section-title mb-3">{title}</div>
      {children}
    </section>
  )
}

function Trail({ d }: { d: Detail }) {
  return (
    <ol className="relative ml-1.5">
      <div className="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-sky-400/50 via-violet-400/40 to-pink-400/30" />
      {d.trail.map((s, i) => (
        <li key={i} className="fade-up relative pb-3 pl-6 last:pb-0" style={{ animationDelay: `${i * 90}ms` }}>
          <span className="absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 border-slate-900 bg-slate-400" />
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-px text-[9.5px] font-bold ring-1 ${LEVEL_STYLE[s.level]}`}>{s.level}</span>
            <span className="text-[12px] font-medium text-slate-100">{s.action}</span>
            <span className="num ml-auto text-[10px] text-slate-500">h{s.t}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-slate-400">{s.finding}</div>
        </li>
      ))}
    </ol>
  )
}

function Hypotheses({ d }: { d: Detail }) {
  return (
    <div className="space-y-2.5">
      {d.hypotheses.map((h, i) => (
        <div key={h.name}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className={h.verdict === 'rejected' ? 'text-slate-400' : 'text-slate-100'}>{h.name}</span>
            <span className="flex items-center gap-2">
              <span className="num text-[11px] text-slate-300">{Math.round(h.explained * 100)}%</span>
              <span
                className="rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: VERDICT_COLOR[h.verdict], background: `${VERDICT_COLOR[h.verdict]}1f` }}
              >
                {h.verdict}
              </span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="grow-x h-full origin-left rounded-full"
              style={{ width: `${Math.max(1, h.explained * 100)}%`, background: VERDICT_COLOR[h.verdict], animationDelay: `${i * 80}ms` }}
            />
          </div>
        </div>
      ))}
      <div className="pt-1 text-[10.5px] text-slate-500">Explained share = v(all) − v(all ∖ H), over v(all) − v(none). Supported at ≥ 80%.</div>
    </div>
  )
}

function Fixes({ d, ceo, onApprove, approving }: { d: Detail; ceo: boolean; onApprove: (id: string) => void; approving: boolean }) {
  const all = d.fixes
  const baseline = all.find(isBaseline) ?? all[0]
  const reference = baseline.p50
  const rel = all.map((f) => relativeSeries(f, reference))
  const lo = Math.min(0, ...rel.flatMap((r) => r.p10))
  const hi = Math.max(0, ...rel.flatMap((r) => r.p90))
  const list = ceo ? all.filter((f) => f.id === (d.applied ?? d.recommended)) : all
  return (
    <div className={ceo ? '' : 'grid grid-cols-2 gap-2.5'}>
      {list.map((f) => (
        <FixCard
          key={f.id}
          f={f}
          color={FIX_COLORS[all.indexOf(f) % FIX_COLORS.length]}
          reference={reference}
          domain={[lo, hi]}
          recommended={f.id === d.recommended}
          applied={d.applied}
          onApprove={onApprove}
          approving={approving}
          big={ceo}
        />
      ))}
      <div className={`${ceo ? 'mt-2' : 'col-span-2'} text-[10.5px] text-slate-500`}>
        Cumulative margin vs do nothing (p50) over 7 days. Band p10–p90, line p50 of 40 Monte Carlo runs.
      </div>
    </div>
  )
}

function FixCard(p: {
  f: Fix
  color: string
  reference: number[]
  domain: [number, number]
  recommended: boolean
  applied: string | null
  onApprove: (id: string) => void
  approving: boolean
  big: boolean
}) {
  const { f } = p
  const isApplied = p.applied === f.id
  const canApprove = !p.applied && !isBaseline(f)
  return (
    <div
      className={`relative rounded-lg border p-2.5 ${
        isApplied ? 'border-teal-400/60 bg-teal-400/5' : p.recommended ? 'border-teal-400/40 bg-slate-900/40' : 'border-slate-700/50 bg-slate-900/30'
      }`}
      title={f.description}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="text-[12px] font-semibold leading-tight text-slate-100">{f.name}</div>
        {p.recommended && !isApplied && <span className="shrink-0 rounded bg-teal-400/15 px-1 text-[9px] font-bold uppercase text-teal-300">Best</span>}
        {isApplied && <span className="shrink-0 rounded bg-teal-400/20 px-1 text-[9px] font-bold uppercase text-teal-200">Applied</span>}
      </div>
      <div className={`num text-[11px] ${f.delta_p50_usd > 0 ? 'text-teal-300' : f.delta_p50_usd < 0 ? 'text-rose-300' : 'text-slate-500'}`}>
        {isBaseline(f) ? 'baseline' : `${f.delta_p50_usd >= 0 ? '+' : ''}${usd(f.delta_p50_usd)} vs do nothing`}
      </div>
      <FanChart fix={f} reference={p.reference} domain={p.domain} color={p.color} {...(p.big ? { width: 400, height: 150 } : {})} />
      {p.big && <p className="mb-2 text-[11.5px] leading-snug text-slate-300">{f.description}</p>}
      <div className="line-clamp-2 min-h-[26px] text-[10px] leading-tight text-slate-500">{f.advertiser_risk}</div>
      {canApprove && (
        <button
          disabled={p.approving}
          onClick={() => p.onApprove(f.id)}
          className={`mt-2 w-full rounded-md py-1.5 text-[11.5px] font-semibold transition ${
            p.recommended
              ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 shadow-[0_0_18px_rgba(45,212,191,0.35)] hover:brightness-110'
              : 'bg-slate-700/60 text-slate-200 hover:bg-slate-600/70'
          } disabled:opacity-50`}
        >
          {p.approving ? 'Applying…' : 'Approve'}
        </button>
      )}
    </div>
  )
}

function Verification({ d }: { d: Detail }) {
  if (!d.applied) return null
  const v = d.verification
  const fix = d.fixes.find((f) => f.id === d.applied)
  const [p10, p50, p90] = v.predicted ?? [fix?.p10[0] ?? 0, fix?.p50[0] ?? 0, fix?.p90[0] ?? 0]
  const tone =
    v.status === 'verified' ? 'border-teal-400/50 bg-teal-400/10 text-teal-200' : v.status === 'missed' ? 'border-rose-400/50 bg-rose-400/10 text-rose-200' : 'border-amber-400/40 bg-amber-400/5 text-amber-200'
  const pos = v.actual != null && p90 > p10 ? Math.max(0, Math.min(1, (v.actual - p10) / (p90 - p10))) : null
  return (
    <div className={`fade-up flex items-center gap-3 rounded-xl border p-3 ${tone}`}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-current/10 text-lg">
        {v.status === 'verified' ? '✓' : v.status === 'missed' ? '!' : <span className="h-3 w-3 animate-ping rounded-full bg-amber-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold">
          {v.status === 'verified' ? 'Prediction verified' : v.status === 'missed' ? 'Prediction missed → twin recalibrated' : `${fix?.name ?? 'Fix'} applied · verifying in 24 h`}
        </div>
        <div className="num text-[10.5px] opacity-80">
          day-1 band {usd(p10)} – {usd(p90)} · p50 {usd(p50)}
          {v.actual != null && ` · actual ${usd(v.actual)}`}
        </div>
        {pos != null && (
          <div className="relative mt-1.5 h-1.5 rounded-full bg-current/20">
            <div className="absolute -top-0.5 h-2.5 w-1 rounded bg-white" style={{ left: `calc(${pos * 100}% - 2px)` }} />
          </div>
        )}
      </div>
    </div>
  )
}
