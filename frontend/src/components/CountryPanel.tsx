import { useState } from 'react'
import { PLATFORM_LABEL, STATUS_COLOR, STATUS_LABEL, usd } from '../lib/theme'
import type { CountryDetail, CountryState, IncidentSummary, PotentialResponse } from '../lib/types'

const KPI_OPTIONS = [
  { id: 'worst', label: 'Worst KPI' },
  { id: 'completions', label: 'Completions' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'quality_per_completion', label: 'Quality' },
]

function cellColor(z: number) {
  const a = Math.min(1, Math.abs(z) / 8)
  if (Math.abs(z) < 2) return `rgba(45,212,191,${0.08 + a * 0.25})`
  if (Math.abs(z) < 4) return `rgba(251,191,36,${0.2 + a * 0.5})`
  return `rgba(244,63,94,${0.35 + a * 0.55})`
}

type Props = {
  country: CountryState
  detail: CountryDetail | null
  incidents: IncidentSummary[]
  potential: PotentialResponse | null
  onBack: () => void
  onOpenIncident: (id: string) => void
}

export default function CountryPanel({ country, detail, incidents, potential, onBack, onOpenIncident }: Props) {
  const [kpi, setKpi] = useState('worst')
  const pot = potential?.countries.find((c) => c.iso === country.iso)
  const platforms = [...new Set(detail?.segments.map((s) => s.platform) ?? [])]
  const categories = [...new Set(detail?.segments.map((s) => s.category) ?? [])]
  const zOf = (s: CountryDetail['segments'][number]) => {
    if (kpi !== 'worst') return s.kpi_z[kpi] ?? 0
    return Object.values(s.kpi_z).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0)
  }
  const k = country.kpis
  const tiles = [
    ['New accounts', Math.round(k.new_accounts).toLocaleString(), '/h'],
    ['Completions', Math.round(k.completions).toLocaleString(), '/h'],
    ['Revenue', usd(k.revenue), '/h'],
    ['Rewards', usd(k.rewards), '/h'],
    ['Margin', usd(k.margin), '/h'],
    ['Quality / compl.', k.quality_per_completion.toFixed(3), ''],
  ]
  const mine = incidents.filter((i) => i.country === country.iso && i.status !== 'resolved')
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-700/50 px-5 pb-3 pt-4">
        <button onClick={onBack} className="mb-2 text-[11px] text-slate-400 hover:text-slate-200">
          ← Back to globe
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-slate-50">{country.name}</h2>
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: STATUS_COLOR[country.status], background: `${STATUS_COLOR[country.status]}1c` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[country.status] }} />
            {STATUS_LABEL[country.status]}
          </span>
        </div>
        <div className="num mt-0.5 text-[11px] text-slate-500">
          health z {country.health_z.toFixed(2)} · potential +{usd(country.potential_usd_day)}/day
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {mine.map((inc) => (
          <button key={inc.id} onClick={() => onOpenIncident(inc.id)} className="fade-up flex w-full items-center gap-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-left hover:bg-rose-500/15">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-rose-400" />
            </span>
            <span className="flex-1 text-[12.5px] font-medium text-rose-100">{inc.title}</span>
            <span className="text-[11px] text-rose-300">Open →</span>
          </button>
        ))}

        <div className="grid grid-cols-3 gap-2">
          {tiles.map(([l, v, u]) => (
            <div key={l} className="card px-2.5 py-2">
              <div className="text-[10px] text-slate-500">{l}</div>
              <div className="num text-[13px] font-semibold text-slate-100">
                {v}
                <span className="text-[10px] font-normal text-slate-500">{u}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="card p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="section-title">L2 · platform × category</div>
          </div>
          <div className="mb-3 flex flex-wrap gap-1">
            {KPI_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => setKpi(o.id)}
                className={`rounded-full px-2 py-0.5 text-[10.5px] ${kpi === o.id ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!detail ? (
            <div className="h-32 animate-pulse rounded-lg bg-slate-800/50" />
          ) : (
            <div className="grid gap-1" style={{ gridTemplateColumns: `58px repeat(${categories.length}, 1fr)` }}>
              <div />
              {categories.map((c) => (
                <div key={c} className="truncate pb-1 text-center text-[10px] capitalize text-slate-400" title={c}>
                  {c.replace(/ (games|apps|cashback)$/i, '')}
                </div>
              ))}
              {platforms.map((p) => (
                <div key={p} className="contents">
                  <div className="flex items-center text-[11px] text-slate-300">{PLATFORM_LABEL[p] ?? p}</div>
                  {categories.map((c) => {
                    const s = detail.segments.find((x) => x.platform === p && x.category === c)
                    if (!s) return <div key={c} />
                    const z = zOf(s)
                    return (
                      <div
                        key={c}
                        className="fade-up flex aspect-square flex-col items-center justify-center rounded-md text-center transition-colors duration-700"
                        style={{ background: cellColor(z) }}
                        title={Object.entries(s.kpi_z).map(([k, v]) => `${k}: ${v.toFixed(1)}`).join('\n')}
                      >
                        <div className="num text-[12px] font-semibold text-white">{z > 0 ? '+' : ''}{z.toFixed(1)}</div>
                        <div className="num text-[9px] text-white/60">{usd(s.deviation_usd_h)}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10.5px] text-slate-500">Cell: z vs twin forecast · deviation USD/h</div>
        </section>

        {pot && (
          <section className="card p-3.5">
            <div className="section-title mb-2">Potential · taste model</div>
            <div className="num text-[20px] font-semibold text-fuchsia-300">+{usd(pot.potential_usd_day)}/day</div>
            <div className="text-[11.5px] text-slate-400">if the offer feed matched local taste</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {pot.top_categories.map((c) => (
                <span key={c} className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 capitalize text-fuchsia-200">
                  {c}
                </span>
              ))}
              {pot.explain.map((c) => (
                <span key={c} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  {c}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
