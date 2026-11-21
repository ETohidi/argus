import { usd } from '../lib/theme'
import type { IncidentDetail, IncidentSummary } from '../lib/types'
import { recommendedFix } from '../lib/incident'

type Props = {
  summary: IncidentSummary
  detail: IncidentDetail | null // arrives later (the first fetch can take a few seconds)
  countryName: string
  approving: boolean
  onApprove: (fixId: string) => void
  onEvidence: () => void
  onClose: () => void
}

// "+$85/h of 'growth'" → ["+$85/h", "of 'growth'"]
function splitAmount(s: string): [string, string] {
  const m = s.match(/^\s*([+−-]?\$[\d,.]+[kM]?(?:\/h)?)\s*(.*)$/)
  return m ? [m[1], m[2].replace(/'([^']+)'/g, '“$1”')] : [s, '']
}

// L2 / manager: one decision, in plain words. No charts here; the evidence is one click away.
export default function IssueCard({ summary, detail, countryName, approving, onApprove, onEvidence, onClose }: Props) {
  const card = summary.card ?? detail?.card
  const status = summary.status
  const decided = status !== 'open' && status !== 'persisting'
  const fix = detail ? recommendedFix(detail) : undefined
  const [amount, amountNote] = splitAmount(card?.looks_like ?? `${usd(summary.impact_usd_h)}/h`)
  const atStake = card?.at_stake_7d_usd ?? summary.risk_7d_usd ?? 0

  return (
    <section className="fade-up pointer-events-auto w-[420px] rounded-3xl bg-slate-900/90 p-8 ring-1 ring-slate-700/50 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`text-[13px] ${decided ? 'text-slate-400' : 'text-orange-300'}`}>{card?.status_line ?? 'Needs a decision'}</div>
          <h2 className="mt-1 text-[24px] font-semibold leading-tight text-slate-50">{card?.title ?? summary.title}</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full px-2 text-[16px] text-slate-500 hover:text-slate-200">
          ×
        </button>
      </div>

      {!decided ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-6">
            <Big label="Looks like" value={amount} note={amountNote} />
            <Big label="Doing nothing costs" value={usd(atStake)} note="this week" tone="text-orange-300" />
          </div>
          <dl className="mt-8 space-y-4 text-[13px] leading-relaxed">
            <Line term="What happened" text={card?.what_happened} />
            <Line term="Why" text={card?.why} />
            <Line term="What to do" text={card?.what_to_do} />
          </dl>
          <button
            disabled={!fix || approving}
            onClick={() => fix && onApprove(fix.id)}
            className="mt-8 w-full rounded-xl bg-teal-400 py-3 text-[16px] font-semibold text-slate-950 transition hover:bg-teal-300 disabled:bg-slate-700 disabled:text-slate-400"
          >
            {approving ? 'Applying…' : fix ? `Approve: ${fix.name.toLowerCase()}` : 'Preparing the options…'}
          </button>
        </>
      ) : (
        <Outcome detail={detail} countryName={countryName} statusLine={card?.status_line} />
      )}

      <button onClick={onEvidence} className="mt-6 text-[13px] text-slate-400 hover:text-slate-100">
        See the evidence →
      </button>
    </section>
  )
}

function Big({ label, value, note, tone = 'text-slate-50' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <div className="text-[13px] text-slate-400">{label}</div>
      <div className={`num mt-1 text-[40px] font-semibold leading-none tracking-tight ${tone}`}>{value}</div>
      {note && <div className="mt-2 text-[13px] text-slate-500">{note}</div>}
    </div>
  )
}

function Line({ term, text }: { term: string; text?: string }) {
  return (
    <div>
      <dt className="text-slate-500">{term}</dt>
      <dd className="text-slate-200">{text ?? '…'}</dd>
    </div>
  )
}

// After approval: the verification state replaces the decision.
function Outcome({ detail, countryName, statusLine }: { detail: IncidentDetail | null; countryName: string; statusLine?: string }) {
  const v = detail?.verification
  const fix = detail ? recommendedFix(detail) : undefined
  const band = v?.predicted ?? (fix ? [fix.p10[0], fix.p50[0], fix.p90[0]] : null)
  if (v?.status === 'verified')
    return (
      <div className="mt-8">
        <div className="text-[24px] font-semibold leading-snug text-teal-300">
          {countryName} is green.
          <br />
          The prediction came true.
        </div>
        {band && v.actual != null && <BandBar band={band} actual={v.actual} />}
        <p className="mt-4 text-[13px] text-slate-400">
          {fix ? `${fix.name} was applied. ` : ''}Margin on the first day landed inside the range the twin predicted.
        </p>
      </div>
    )
  if (v?.status === 'missed')
    return (
      <div className="mt-8">
        <div className="text-[24px] font-semibold text-orange-300">The prediction missed.</div>
        <p className="mt-2 text-[13px] text-slate-400">{statusLine ?? 'The twin has been recalibrated.'}</p>
        {band && v.actual != null && <BandBar band={band} actual={v.actual} />}
      </div>
    )
  return (
    <div className="mt-8">
      <div className="text-[24px] font-semibold leading-snug text-slate-100">{fix ? `${fix.name} is live.` : 'The fix is live.'}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
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
      <div className="relative h-2 rounded-full bg-teal-400/20">
        <div className="absolute -top-1 h-4 w-1 rounded bg-teal-300" style={{ left: `calc(${pos * 100}% - 2px)` }} />
      </div>
      <div className="num mt-2 flex justify-between text-[13px] text-slate-500">
        <span>{usd(lo)}</span>
        <span className="text-teal-300">actual {usd(actual)}</span>
        <span>{usd(hi)}</span>
      </div>
    </div>
  )
}
