import { useState } from 'react'
import { ORANGE, ORANGE_SOFT, PLATFORM_LABEL, STATUS_COLOR, STATUS_LABEL, usd } from '../lib/theme'
import type { CountryDetail, CountryState, IncidentSummary, PotentialResponse } from '../lib/types'

const KPI_OPTIONS = [
  { id: 'worst', label: 'Worst' },
  { id: 'new_accounts', label: 'Sign-ups' },
  { id: 'completions', label: 'Completions' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'quality_per_completion', label: 'Quality' },
]

// Calm cells: grey within forecast, soft orange when drifting, orange when broken.
function cellStyle(z: number) {
  const a = Math.abs(z)
  if (a < 2) return { background: 'rgba(148,163,184,0.08)', color: '#94a3b8' }
  if (a < 4) return { background: `${ORANGE_SOFT}33`, color: '#fed7aa' }
  return { background: `${ORANGE}${a >= 8 ? 'cc' : '88'}`, color: '#fff7ed' }
}

type Props = {
  country: CountryState
  detail: CountryDetail | null
  incident: IncidentSummary | undefined
  potential: PotentialResponse | null
  onOpenIncident: (id: string) => void
  onClose: () => void
}

// Country click: a small, closable sheet with three KPIs and the platform × category heatmap.
export default function CountrySheet({ country, detail, incident, potential, onOpenIncident, onClose }: Props) {
  const [kpi, setKpi] = useState('worst')
  const pot = potential?.countries.find((c) => c.iso === country.iso)
  const platforms = [...new Set(detail?.segments.map((s) => s.platform) ?? [])]
  const categories = [...new Set(detail?.segments.map((s) => s.category) ?? [])]
  const zOf = (s: CountryDetail['segments'][number]) =>
    kpi !== 'worst' ? (s.kpi_z[kpi] ?? 0) : Object.values(s.kpi_z).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0)
  const k = country.kpis
  return (
    <section className="fade-up pointer-events-auto w-[420px] rounded-3xl bg-slate-900/90 p-8 ring-1 ring-slate-700/50 backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[country.status] }} />
            {STATUS_LABEL[country.status]}
          </div>
          <h2 className="mt-1 text-[24px] font-semibold text-slate-50">{country.name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full px-2 text-[16px] text-slate-500 hover:text-slate-200">
          ×
        </button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Kpi label="Margin" value={usd(k.margin)} unit="/h" />
        <Kpi label="Completions" value={Math.round(k.completions).toLocaleString()} unit="/h" />
        <Kpi label="Sign-ups" value={Math.round(k.new_accounts).toLocaleString()} unit="/h" />
      </div>

      {incident && (
        <button onClick={() => onOpenIncident(incident.id)} className="mt-6 w-full rounded-xl px-4 py-3 text-left text-[13px] text-orange-200 ring-1 ring-orange-400/40 hover:bg-orange-400/5">
          {incident.card?.title ?? incident.title} →
        </button>
      )}

      <div className="mt-8 flex items-baseline justify-between">
        <h3 className="text-[13px] text-slate-400">Where it deviates</h3>
        <div className="flex gap-2">
          {KPI_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => setKpi(o.id)} className={`text-[13px] ${kpi === o.id ? 'text-slate-100' : 'text-slate-600 hover:text-slate-300'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {!detail ? (
        <div className="mt-3 h-28 animate-pulse rounded-xl bg-slate-800/50" />
      ) : (
        <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `64px repeat(${categories.length}, 1fr)` }}>
          <div />
          {categories.map((c) => (
            <div key={c} className="truncate pb-1 text-center text-[13px] text-slate-500" title={c}>
              {c.replace(/ (games|apps|cashback)$/i, '')}
            </div>
          ))}
          {platforms.map((p) => (
            <div key={p} className="contents">
              <div className="flex items-center text-[13px] text-slate-400">{PLATFORM_LABEL[p] ?? p}</div>
              {categories.map((c) => {
                const s = detail.segments.find((x) => x.platform === p && x.category === c)
                if (!s) return <div key={c} />
                const z = zOf(s)
                return (
                  <div
                    key={c}
                    className="num flex aspect-square items-center justify-center rounded-lg text-[13px] transition-colors duration-700"
                    style={cellStyle(z)}
                    title={`${Object.entries(s.kpi_z).map(([kk, v]) => `${kk}: ${v.toFixed(1)}`).join('\n')}\nmargin deviation ${usd(s.deviation_usd_h)}/h`}
                  >
                    {z > 0 ? '+' : ''}
                    {z.toFixed(1)}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[13px] text-slate-600">Deviation from the twin's forecast, in standard deviations</div>

      {pot && (
        <div className="mt-6 text-[13px] leading-relaxed text-slate-400">
          <span className="text-teal-300">+{usd(pot.potential_usd_day)}/day</span>
          {pot.potential_pct != null && ` (${pot.potential_pct.toFixed(1)}% of margin)`} if the feed matched local taste: more {pot.top_categories.join(' and ').toLowerCase()}.
        </div>
      )}
    </section>
  )
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className="num text-[16px] font-semibold text-slate-100">
        {value}
        <span className="text-[13px] font-normal text-slate-500">{unit}</span>
      </div>
    </div>
  )
}
