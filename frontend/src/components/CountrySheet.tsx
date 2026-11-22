import { useState } from 'react'
import { PINK, PINK_SOFT, PLATFORM_LABEL, STATUS_COLOR, usd } from '../lib/theme'
import type { CountryDetail, CountryState, IncidentSummary, PotentialResponse, SeriesPoint } from '../lib/types'
import NormalZoneChart from './charts/NormalZoneChart'
import { growthLine } from '../lib/incident'

const KPI_OPTIONS = [
  { id: 'worst', label: 'Most unusual' },
  { id: 'new_accounts', label: 'Sign-ups' },
  { id: 'completions', label: 'Completions' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'quality_per_completion', label: 'Quality' },
]

// Calm cells: neutral within the usual range, soft pink when drifting, pink when clearly off.
function cellStyle(z: number) {
  const a = Math.abs(z)
  if (a < 2) return { background: 'rgba(123,127,168,0.10)', color: '#9A9CC4' }
  if (a < 4) return { background: `${PINK_SOFT}33`, color: '#FFC2D8' }
  return { background: `${PINK}${a >= 8 ? 'cc' : '88'}`, color: '#FFF0F6' }
}

type Props = {
  country: CountryState
  detail: CountryDetail | null
  incident: IncidentSummary | undefined
  potential: PotentialResponse | null
  growth?: boolean // Growth mode: add what users like vs see, and what showing more of it is worth
  onOpenIncident: (id: string) => void
  onEvidence: (id: string) => void
  onClose: () => void
}

// Country click: the main point first (name, one verdict, three numbers vs usual, a sparkline with the usual band),
// what is moving only when something is unusual, and the full platform × offer grid on request.
export default function CountrySheet({ country, detail, incident, potential, growth, onOpenIncident, onEvidence, onClose }: Props) {
  const [kpi, setKpi] = useState('worst')
  const [grid, setGrid] = useState(false)
  const sum = detail?.summary
  const status = sum?.status ?? country.status
  const color = STATUS_COLOR[status]
  const series: SeriesPoint[] = (sum?.series.points ?? []).map((p) => ({ t: p.t, label: p.label, actual: p.value, expected: p.usual, lo: p.lo, hi: p.hi }))
  const pot = growth ? potential?.countries.find((c) => c.iso === country.iso) : undefined
  return (
    <section className="fade-up pointer-events-auto w-[380px] rounded-3xl bg-panel/90 p-7 ring-1 ring-line/50 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <h2 className="flex items-center gap-2.5 text-[24px] font-semibold leading-tight text-fg">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          {country.name}
        </h2>
        <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full px-2 text-[16px] text-fg-2 hover:text-fg">
          ×
        </button>
      </div>
      {sum ? (
        <p className="mt-1.5 text-[16px] leading-snug" style={{ color: status === 'ok' ? 'var(--color-fg-2)' : status === 'incident' ? color : 'var(--color-fg)' }}>
          {sum.verdict}
        </p>
      ) : (
        <div className="mt-2 h-5 w-48 animate-pulse rounded bg-line/50" />
      )}

      {/* Key numbers in plain words. */}
      <dl className="mt-5 space-y-1.5 text-[13px]">
        {sum
          ? sum.numbers.slice(0, 3).map((n) => {
              const off = n.usual ? Math.abs(n.value / n.usual - 1) : 0
              return (
                <div key={n.label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-fg-2">{n.label}</dt>
                  <dd className={`whitespace-nowrap text-right tabular-nums ${off >= 0.25 && status !== 'ok' ? 'text-fg' : 'text-fg-2'}`}>{n.line}</dd>
                </div>
              )
            })
          : [0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-line/40" />)}
      </dl>

      {series.length > 1 && (
        <figure className="mt-5">
          <div className="mb-1 text-[13px] text-fg-2">{sum?.series.metric ?? 'Margin per hour'}, last 24 h</div>
          <NormalZoneChart series={series} width={324} height={72} showStart={false} />
          <figcaption className="mt-1 text-[13px] text-fg-2">Grey = usual for this time of day</figcaption>
        </figure>
      )}

      {/* What's moving: only when something is unusual. */}
      {sum && sum.moving.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[13px] text-fg-2">What's moving</h3>
          <ul className="mt-1.5 space-y-1 text-[13px] text-fg">
            {sum.moving.slice(0, 2).map((m) => (
              <li key={m.line} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                {m.line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pot && (
        <p className="mt-5 text-[13px] leading-relaxed text-fg-2">
          {growthLine(pot, country.name).replace(/^[^:]{1,40}:\s*/, '').replace(/^./, (ch) => ch.toUpperCase())}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between text-[13px]">
        <button onClick={() => setGrid((g) => !g)} className="text-fg-2 hover:text-fg" aria-expanded={grid}>
          {grid ? 'Hide segments' : 'All segments →'}
        </button>
        {incident && (
          <span className="flex gap-4">
            <button onClick={() => onOpenIncident(incident.id)} className="text-fg-2 hover:text-fg">
              Issue card
            </button>
            <button onClick={() => onEvidence(incident.id)} className="text-problem hover:text-fg">
              See the evidence →
            </button>
          </span>
        )}
      </div>

      {grid && detail && <SegmentGrid detail={detail} kpi={kpi} onKpi={setKpi} />}
    </section>
  )
}

// Full platform × offer grid: one row per offer type (full names, wrapping), one column per platform.
function SegmentGrid({ detail, kpi, onKpi }: { detail: CountryDetail; kpi: string; onKpi: (k: string) => void }) {
  const platforms = [...new Set(detail.segments.map((s) => s.platform))]
  const categories = [...new Set(detail.segments.map((s) => s.category))]
  const zOf = (s: CountryDetail['segments'][number]) =>
    kpi !== 'worst' ? (s.kpi_z[kpi] ?? 0) : Object.values(s.kpi_z).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0)
  return (
    <div className="fade-in mt-4">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {KPI_OPTIONS.map((o) => (
          <button key={o.id} onClick={() => onKpi(o.id)} className={`text-[13px] ${kpi === o.id ? 'text-fg' : 'text-fg-2 hover:text-fg'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid items-center gap-x-2 gap-y-1.5" style={{ gridTemplateColumns: `1fr repeat(${platforms.length}, 64px)` }}>
        <div />
        {platforms.map((p) => (
          <div key={p} className="text-center text-[13px] text-fg-2">
            {PLATFORM_LABEL[p] ?? p}
          </div>
        ))}
        {categories.map((c) => (
          <div key={c} className="contents">
            <div className="text-[13px] leading-tight text-fg-2">{c}</div>
            {platforms.map((p) => {
              const s = detail.segments.find((x) => x.platform === p && x.category === c)
              if (!s) return <div key={p} />
              const z = zOf(s)
              return (
                <div
                  key={p}
                  className="num flex h-8 items-center justify-center rounded-lg text-[13px] transition-colors duration-700"
                  style={cellStyle(z)}
                  title={`${c} on ${PLATFORM_LABEL[p] ?? p}: margin ${s.deviation_usd_h >= 0 ? '+' : ''}${usd(s.deviation_usd_h)} an hour vs usual`}
                >
                  {z > 0 ? '+' : ''}
                  {z.toFixed(1)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[13px] text-fg-2">How unusual: 0 = usual, 4 or more = clearly off</div>
    </div>
  )
}
