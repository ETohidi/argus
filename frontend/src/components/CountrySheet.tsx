import { useState } from 'react'
import { api } from '../lib/api'
import { PINK, PINK_SOFT, PLATFORM_LABEL, STATUS_COLOR } from '../lib/theme'
import type { CountryDetail, CountryState, IncidentSummary, OfferMixWhatIf, PotentialResponse, SeriesPoint } from '../lib/types'
import NormalZoneChart from './charts/NormalZoneChart'
import TwinFutures, { TwinButton } from './charts/TwinFutures'
import { RECOMMENDER_CAPTION } from './EvidenceView'

// Category metrics for the segment grid (sign-ups are per platform and get their own row).
const KPI_OPTIONS = [
  { id: 'worst', label: 'Most unusual' },
  { id: 'completions', label: 'Completions' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'quality_per_completion', label: 'Value per completion' },
]

// Colour only: neutral within the usual range, soft pink when drifting, pink when clearly off. Words on hover.
function cellStyle(z: number) {
  const a = Math.abs(z)
  if (a < 2) return { background: 'rgba(123,127,168,0.16)' }
  if (a < 4) return { background: `${PINK_SOFT}55` }
  return { background: `${PINK}${a >= 8 ? 'ee' : 'aa'}` }
}
const zWords = (z: number) => {
  const a = Math.abs(z)
  return a < 2 ? 'as usual' : `${a < 4 ? 'a bit' : 'clearly'} ${z > 0 ? 'above' : 'below'} usual`
}

type Props = {
  country: CountryState
  detail: CountryDetail | null
  incident: IncidentSummary | undefined
  potential: PotentialResponse | null
  explainedAt?: number // when the planned event was first seen (fallback for the chart marker)
  growth?: boolean // Growth mode: the growth card instead of the risk view
  segments: boolean // the segment grid is open (the rail's "Segment" level)
  onSegments: (open: boolean) => void
  onWhy: (incidentId: string) => void
  onUsers: (incidentId: string) => void
  onClose: () => void
}

export default function CountrySheet(p: Props) {
  return p.growth ? <GrowthCard {...p} /> : <RiskView {...p} />
}

// Risks: the main point first (verdict, three numbers vs usual, a sparkline with the expected band); what is moving
// only when something is unusual; "Segments ›" opens the grid, a pink cell opens "Users ›".
function RiskView({ country, detail, incident, explainedAt, segments, onSegments, onWhy, onUsers, onClose }: Props) {
  const sum = detail?.summary
  const status = sum?.status ?? country.status
  const color = STATUS_COLOR[status]
  const series: SeriesPoint[] = (sum?.series.points ?? []).map((pt) => ({ t: pt.t, label: pt.label, actual: pt.value, expected: pt.usual, lo: pt.lo, hi: pt.hi }))
  const markers = sum?.series.events ?? (status === 'explained' && explainedAt != null ? [{ t: explainedAt, label: 'Planned promo' }] : [])
  return (
    <section className="fade-up pointer-events-auto max-h-[calc(100vh-7.5rem)] w-[400px] overflow-y-auto rounded-3xl bg-panel/95 p-6 ring-1 ring-line/50 backdrop-blur">
      <Header name={country.name} color={color} onClose={onClose} />
      {sum ? (
        <p className="mt-1.5 text-[16px] leading-snug" style={{ color: status === 'incident' ? '#FF8FB7' : status === 'ok' ? '#9A9CC4' : '#F1F0FF' }}>
          {sum.verdict}
        </p>
      ) : (
        <div className="mt-2 h-5 w-48 animate-pulse rounded bg-line/50" />
      )}

      <dl className="mt-4 space-y-1.5 text-[16px]">
        {sum
          ? sum.numbers.slice(0, 3).map((n) => (
              <div key={n.label} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-fg-2">{n.label}</dt>
                <dd className="whitespace-nowrap text-right tabular-nums text-fg">{n.line}</dd>
              </div>
            ))
          : [0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-line/40" />)}
      </dl>

      {series.length > 1 && (
        <figure className="mt-4">
          <div className="mb-1 text-[14px] text-fg-2">{sum?.series.metric ?? 'Margin per hour'}, last 24 h</div>
          <NormalZoneChart series={series} width={352} height={92} showStart={false} markers={markers} />
        </figure>
      )}

      {sum && sum.moving.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[14px] text-fg-2">What's moving</h3>
          <ul className="mt-1.5 space-y-1 text-[16px] text-fg">
            {sum.moving.slice(0, 2).map((m) => (
              <li key={m.line} className="flex gap-2">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                {m.line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between text-[16px]">
        <button onClick={() => onSegments(!segments)} className="text-fg hover:text-ok" aria-expanded={segments}>
          {segments ? 'Hide segments' : 'Segments ›'}
        </button>
        {incident && (
          <button onClick={() => onWhy(incident.id)} className="font-semibold text-[#FF8FB7] hover:text-fg">
            Why? ›
          </button>
        )}
      </div>

      {segments && detail && <SegmentGrid detail={detail} incident={incident} onUsers={onUsers} />}
    </section>
  )
}

function Header({ name, color, onClose }: { name: string; color: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <h2 className="flex items-center gap-2.5 text-[24px] font-semibold leading-tight text-fg">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        {name}
      </h2>
      <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full px-2 text-[16px] text-fg-2 hover:text-fg">
        ×
      </button>
    </div>
  )
}

// Segment grid: one row per offer type (full names), one column per platform; colour only, plain words on hover.
// Sign-ups are counted per platform, so they get one row of their own instead of repeating across offer types.
function SegmentGrid({ detail, incident, onUsers }: { detail: CountryDetail; incident: IncidentSummary | undefined; onUsers: (id: string) => void }) {
  const [kpi, setKpi] = useState('worst')
  const platforms = [...new Set(detail.segments.map((s) => s.platform))]
  const categories = [...new Set(detail.segments.map((s) => s.category))]
  const zOf = (s: CountryDetail['segments'][number]) =>
    kpi !== 'worst'
      ? (s.kpi_z[kpi] ?? 0)
      : Object.entries(s.kpi_z)
          .filter(([k]) => k !== 'new_accounts')
          .reduce((m, [, v]) => (Math.abs(v) > Math.abs(m) ? v : m), 0)
  const signupZ = (pl: string) => detail.segments.find((s) => s.platform === pl)?.kpi_z.new_accounts ?? 0
  const titleOf = (i: IncidentSummary) => `${i.title} ${i.short_title ?? ''}`.toLowerCase()
  const usersFor = (pl: string) => (incident && titleOf(incident).includes(pl.toLowerCase()) ? incident : undefined)
  const hotCell = (z: number, pl: string) => (Math.abs(z) >= 4 ? usersFor(pl) : undefined)
  const cell = (z: number, label: string, pl: string) => {
    const hot = hotCell(z, pl)
    return (
      <button
        key={pl}
        onClick={() => hot && onUsers(hot.id)}
        className={`h-8 rounded-lg transition-colors duration-700 ${hot ? 'cursor-pointer ring-1 ring-[#FF8FB7]/70 hover:ring-2' : 'cursor-default'}`}
        style={cellStyle(z)}
        title={`${label} on ${PLATFORM_LABEL[pl] ?? pl}: ${zWords(z)}${hot ? ' · click: Users ›' : ''}`}
        aria-label={`${label} on ${PLATFORM_LABEL[pl] ?? pl}: ${zWords(z)}`}
      />
    )
  }
  const anyHot = platforms.some((pl) => hotCell(signupZ(pl), pl) || detail.segments.some((s) => s.platform === pl && hotCell(zOf(s), pl)))
  return (
    <div className="fade-in mt-4">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {KPI_OPTIONS.map((o) => (
          <button key={o.id} onClick={() => setKpi(o.id)} className={`text-[14px] ${kpi === o.id ? 'font-semibold text-fg' : 'text-fg-2 hover:text-fg'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid items-center gap-x-2 gap-y-1.5" style={{ gridTemplateColumns: `1fr repeat(${platforms.length}, 72px)` }}>
        <div />
        {platforms.map((pl) => (
          <div key={pl} className="text-center text-[14px] text-fg-2">
            {PLATFORM_LABEL[pl] ?? pl}
          </div>
        ))}
        <div className="text-[14px] font-semibold leading-tight text-fg">New sign-ups</div>
        {platforms.map((pl) => cell(signupZ(pl), 'New sign-ups', pl))}
        {categories.map((c) => (
          <div key={c} className="contents">
            <div className="text-[14px] leading-tight text-fg-2">{c}</div>
            {platforms.map((pl) => {
              const s = detail.segments.find((x) => x.platform === pl && x.category === c)
              return s ? cell(zOf(s), c, pl) : <div key={pl} />
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[14px] text-fg-2">Pink = clearly off usual; hover for words.</p>
      {anyHot && incident && (
        <button onClick={() => onUsers(incident.id)} className="mt-2 text-[16px] font-semibold text-[#FF8FB7] hover:text-fg">
          Users ›
        </button>
      )}
    </div>
  )
}

// Growth: what users like vs what they see, what it is worth, and the twin rollout.
function GrowthCard({ country, potential, onClose }: Props) {
  const pot = potential?.countries.find((c) => c.iso === country.iso)
  const [run, setRun] = useState<OfferMixWhatIf | null>(null)
  const [busy, setBusy] = useState(false)
  const [plays, setPlays] = useState(0)
  const mix = [...(pot?.mix ?? [])].sort((a, b) => Math.abs(b.liked - b.seen) - Math.abs(a.liked - a.seen)).slice(0, 4)
  const maxShare = Math.max(0.01, ...mix.flatMap((m) => [m.liked, m.seen]))
  const play = async () => {
    setPlays((n) => n + 1)
    if (run) return
    setBusy(true)
    try {
      setRun(await api.offerMix(country.iso))
    } finally {
      setBusy(false)
    }
  }
  const k = pot ? pot.potential_usd_day : 0
  return (
    <section className="fade-up pointer-events-auto max-h-[calc(100vh-7.5rem)] w-[420px] overflow-y-auto rounded-3xl bg-panel/95 p-6 ring-1 ring-line/50 backdrop-blur">
      <Header name={country.name} color="#3CF2C4" onClose={onClose} />
      {pot ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="num text-[40px] font-semibold leading-none text-ok">+${k >= 1000 ? `${(k / 1000).toFixed(1)}k` : Math.round(k)}</span>
            <span className="text-[22px] text-fg">a day</span>
          </div>
          <div className="mt-1 text-[16px] text-fg-2">if users saw more of what they like</div>

          {mix.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex gap-4 text-[14px]">
                <span className="flex items-center gap-1.5 text-fg"><span className="h-2.5 w-4 rounded-sm bg-ok" /> What they like</span>
                <span className="flex items-center gap-1.5 text-fg"><span className="h-2.5 w-4 rounded-sm bg-[#9A9CC4]" /> What they see</span>
              </div>
              <ul className="space-y-2.5">
                {mix.map((m) => (
                  <li key={m.category}>
                    <div className="text-[14px] text-fg">{m.category}</div>
                    {(['liked', 'seen'] as const).map((key) => (
                      <div key={key} className="mt-1 flex items-center gap-2">
                        <div className="h-2.5 flex-1 rounded-full bg-line/50">
                          <div className={`h-full rounded-full ${key === 'liked' ? 'bg-ok' : 'bg-[#9A9CC4]'}`} style={{ width: `${(m[key] / maxShare) * 100}%`, transition: 'width 0.6s ease' }} />
                        </div>
                        <span className="num w-10 text-right text-[14px] text-fg-2">{Math.round(m[key] * 100)}%</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[14px] text-fg-2">{RECOMMENDER_CAPTION}</p>
            </div>
          )}

          <div className="mt-5">
            <TwinButton onClick={play} busy={busy} done={plays > 0 && !!run} />
          </div>
          {run && (
            <div className="mt-3">
              <TwinFutures
                lines={[
                  { id: 'current', label: 'Current offers', color: '#9A9CC4', p10: [0, ...run.current.p10.map((v, i) => v - run.current.p50[i])], p50: [0, ...run.current.p50.map(() => 0)], p90: [0, ...run.current.p90.map((v, i) => v - run.current.p50[i])] },
                  { id: 'better', label: 'Better fit', color: '#3CF2C4', strong: true, p10: [0, ...run.better.p10.map((v, i) => v - run.current.p50[i])], p50: [0, ...run.better.p50.map((v, i) => v - run.current.p50[i])], p90: [0, ...run.better.p90.map((v, i) => v - run.current.p50[i])] },
                ]}
                xLabels={['now', ...run.days.map((d) => (d === run.days.length || d % 2 === 0 ? `day ${d}` : ''))]}
                gap={{ from: 'current', to: 'better', label: run.line }}
                width={560}
                height={280}
                playKey={plays}
                compact
              />
              <p className="mt-1 text-[14px] text-fg-2">Margin gained vs today's offers, cumulative over 7 days.</p>
            </div>
          )}
          <p className="mt-3 text-[14px] text-fg-2">Nothing changes live. A what-if in the twin.</p>
        </>
      ) : (
        <div className="mt-3 h-10 w-40 animate-pulse rounded bg-line/50" />
      )}
    </section>
  )
}
