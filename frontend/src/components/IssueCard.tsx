import { usd } from '../lib/theme'
import type { IncidentDetail, IncidentSummary } from '../lib/types'
import { cardLines, isFraud, metricLabel, recommendedFix, shortTitle } from '../lib/incident'
import NormalZoneChart from './charts/NormalZoneChart'

type Props = {
  summary: IncidentSummary
  detail: IncidentDetail | null // arrives later (the first fetch can take a few seconds)
  countryName: string
  foundLine?: string // "Found by Argus at 06:00, nobody asked · advertisers would react in ~22 h"
  approving: boolean
  onApprove: (fixId: string) => void
  onEvidence: () => void
  onReplay?: () => void // "How did Argus find this?" replay
  onClose: () => void
}

// "+$85/h of 'growth'" → "+$85" (shown as "Looks like: +$85 an hour")
function amountOf(s: string): string {
  const m = s.match(/^\s*([+−-]?\$[\d,.]+[kM]?)/)
  return m ? m[1].replace('-', '−') : s
}

// L2 / manager: one decision, in plain words. No charts here; the evidence is one click away.
export default function IssueCard({ summary, detail, countryName, foundLine, approving, onApprove, onEvidence, onReplay, onClose }: Props) {
  const card = summary.card ?? detail?.card
  const status = summary.status
  const decided = status !== 'open' && status !== 'persisting'
  const fix = detail ? recommendedFix(detail) : undefined
  const amount = amountOf(card?.looks_like ?? `${usd(summary.impact_usd_h)}`)
  const atStake = card?.at_stake_7d_usd ?? summary.risk_7d_usd ?? 0
  const [line1, line2] = cardLines(card, detail ? isFraud(detail) : /fake/i.test(card?.title ?? summary.title))
  // Status chip from the issue tracker: pink only while open, mint once verified or resolved.
  const recovered = status === 'resolved' && detail != null && !detail.applied
  const label = recovered ? 'Recovered without action' : (summary.status_label ?? card?.status_line ?? 'Open')
  const chip = !decided ? 'bg-problem/15 text-problem' : status === 'verified' || status === 'resolved' ? 'bg-ok/15 text-ok' : 'bg-neutral/15 text-fg-2'

  return (
    <section className="fade-up pointer-events-auto w-[420px] rounded-3xl bg-panel/95 p-7 ring-1 ring-line backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-[13px] ${chip}`}>{label}</span>
          <h2 className="mt-2 text-[24px] font-semibold leading-tight text-fg">{summary.short_title ?? detail?.short_title ?? shortTitle(card?.title ?? summary.title)}</h2>
          {(summary.title_detail ?? detail?.title_detail) && <p className="mt-1.5 text-[13px] leading-snug text-fg-2">{summary.title_detail ?? detail?.title_detail}</p>}
          {foundLine && <p className="mt-1 text-[13px] leading-snug text-fg-2">{foundLine}</p>}
          {onReplay && detail && (
            <button onClick={onReplay} className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-accent/15 px-3 py-1 text-[13px] text-accent ring-1 ring-accent/30 hover:bg-accent/25">
              How did Argus find this? <span aria-hidden>▶</span>
            </button>
          )}
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full px-2 text-[16px] text-fg-2 hover:text-fg">
          ×
        </button>
      </div>

      {!decided ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-6">
            <Big label="Looks like:" value={amount} note="an hour" />
            <Big label="Doing nothing costs" value={usd(atStake)} note="this week" tone="text-problem" />
          </div>
          {detail?.series && detail.series.length > 1 && (
            <figure className="mt-6">
              <div className="mb-1 text-[13px] text-fg-2">{metricLabel(detail.series_meta)}</div>
              <NormalZoneChart series={detail.series.slice(-24)} leftAt={detail.left_zone_at} width={364} height={100} showStart={false} />
              <figcaption className="mt-1 text-[13px] text-fg-2">Grey = usual for this time of day</figcaption>
            </figure>
          )}
          <div className="mt-5 space-y-2 text-[16px] leading-snug">
            <p className="text-fg">{line1}</p>
            <p className="text-fg-2">{line2}</p>
          </div>
          <button
            disabled={!fix || approving}
            onClick={() => fix && onApprove(fix.id)}
            className="mt-6 w-full rounded-xl bg-ok py-3 text-[16px] font-semibold text-bg transition hover:brightness-110 disabled:bg-line disabled:text-fg-2"
          >
            {approving ? 'Applying…' : fix ? `Approve: ${fix.name.toLowerCase()}` : 'Preparing the options…'}
          </button>
        </>
      ) : (
        <Outcome detail={detail} countryName={countryName} statusLine={card?.status_line} recovered={recovered} />
      )}

      <button onClick={onEvidence} className="mt-5 text-[13px] text-fg-2 hover:text-fg">
        See the evidence →
      </button>
    </section>
  )
}

function Big({ label, value, note, tone = 'text-fg' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <div className="text-[13px] text-fg-2">{label}</div>
      <div className={`num mt-1 text-[40px] font-semibold leading-none tracking-tight ${tone}`}>{value}</div>
      {note && <div className="mt-2 text-[13px] text-fg-2">{note}</div>}
    </div>
  )
}


// After approval: the verification state replaces the decision.
function Outcome({ detail, countryName, statusLine, recovered }: { detail: IncidentDetail | null; countryName: string; statusLine?: string; recovered?: boolean }) {
  if (recovered)
    return (
      <div className="mt-6">
        <div className="text-[24px] font-semibold leading-snug text-ok">{countryName} is back to normal.</div>
        <p className="mt-2 text-[13px] text-fg-2">It recovered on its own; no action was needed.</p>
      </div>
    )
  const v = detail?.verification
  const fix = detail ? recommendedFix(detail) : undefined
  const band = v?.predicted ?? (fix ? [fix.p10[0], fix.p50[0], fix.p90[0]] : null)
  if (v?.status === 'verified')
    return (
      <div className="mt-6">
        <div className="text-[24px] font-semibold leading-snug text-ok">
          {countryName} is back to normal.
          <br />
          The prediction came true.
        </div>
        {band && v.actual != null && <BandBar band={band} actual={v.actual} />}
        <p className="mt-4 text-[13px] text-fg-2">
          {fix ? `${fix.name} was applied. ` : ''}Margin on the first day landed inside the range Argus predicted.
        </p>
      </div>
    )
  if (v?.status === 'missed')
    return (
      <div className="mt-6">
        <div className="text-[24px] font-semibold text-problem">The prediction missed.</div>
        <p className="mt-2 text-[13px] text-fg-2">{statusLine ?? 'Argus has adjusted its expectations.'}</p>
        {band && v.actual != null && <BandBar band={band} actual={v.actual} />}
      </div>
    )
  return (
    <div className="mt-6">
      <div className="text-[24px] font-semibold leading-snug text-fg">{fix ? `${fix.name} is live.` : 'The fix is live.'}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
        Argus checks its own prediction after 24 hours
        {band ? `: first-day margin should land between ${usd(band[0])} and ${usd(band[2])}.` : '.'}
      </p>
    </div>
  )
}

function BandBar({ band, actual }: { band: number[]; actual: number }) {
  const [lo, , hi] = band
  const span = hi - lo || 1
  const pos = Math.max(0, Math.min(1, (actual - lo) / span))
  return (
    <div className="mt-5">
      <div className="relative h-2 rounded-full bg-ok/20">
        <div className="absolute -top-1 h-4 w-1 rounded bg-ok" style={{ left: `calc(${pos * 100}% - 2px)` }} />
      </div>
      <div className="num mt-2 flex justify-between text-[13px] text-fg-2">
        <span>{usd(lo)}</span>
        <span className="text-ok">actual {usd(actual)}</span>
        <span>{usd(hi)}</span>
      </div>
    </div>
  )
}
