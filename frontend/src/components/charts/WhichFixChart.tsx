import { useSvgFont } from '../../lib/useSvgFont'
import { bandPath, monotonePath, type Pt } from '../../lib/curves'
import { isBaseline } from '../../lib/incident'
import { AURORA, MINT, PINK, usd } from '../../lib/theme'
import type { Fix } from '../../lib/types'

type Props = { fixes: Fix[]; recommended: string; applied: string | null; width?: number; height?: number }


// One chart for the decision: each option's cumulative margin over the next 7 days, measured against today's daily
// pace (day-1 margin of doing nothing, repeated). Doing nothing sinks as advertisers react (event dots); the best
// option is thick and labelled with its real gain over doing nothing.
export default function WhichFixChart({ fixes, recommended, applied, width: W = 896, height: H = 380 }: Props) {
  const { ref: svgRef, px } = useSvgFont<SVGSVGElement>(W)
  const FS = px(14)
  const base = fixes.find(isBaseline) ?? fixes[0]
  const pace = base.p50[0] // margin per day at today's pace
  const rel = (arr: number[]) => [0, ...arr.map((v, i) => v - pace * (i + 1))]
  const lines = fixes.map((f) => ({ f, p10: rel(f.p10), p50: rel(f.p50), p90: rel(f.p90) }))
  const all = lines.flatMap((l) => [...l.p10, ...l.p90])
  let lo = Math.min(0, ...all)
  let hi = Math.max(0, ...all)
  const pad = (hi - lo) * 0.08 || 1
  lo -= pad
  hi += pad
  const events = base.events ?? []
  const M = { l: 16, r: 230, t: 16 + events.length * (FS + 8), b: FS + 16 }
  const n = base.days.length
  const x = (day: number) => M.l + (day / n) * (W - M.l - M.r)
  const y = (v: number) => H - M.b - ((v - lo) / (hi - lo)) * (H - M.t - M.b)
  const pts = (arr: number[]): Pt[] => arr.map((v, i) => [x(i), y(v)])
  const highlight = applied ?? recommended

  // Direct labels at the line ends, nudged apart so they never overlap.
  const labels = lines
    .map((l) => ({
      l,
      y: y(l.p50[n]),
      text: isBaseline(l.f) ? 'Doing nothing' : `${l.f.name}  ${l.f.delta_p50_usd >= 0 ? '+' : ''}${usd(l.f.delta_p50_usd)}`,
    }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + FS + 8)

  const colour = (f: Fix) => (f.id === highlight ? MINT : isBaseline(f) ? PINK : AURORA.fg2)
  const valueAtHour = (arr: number[], h: number) => {
    const d = Math.min(n, Math.max(0, h / 24))
    const i = Math.floor(d)
    const k = d - i
    return i >= n ? arr[n] : arr[i] + (arr[i + 1] - arr[i]) * k
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative margin of each fix over the next week">
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke={AURORA.line} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
        <text key={d} x={x(d)} y={H - 4} fontSize={FS} fill={AURORA.fg2} textAnchor={d === 0 ? 'start' : 'middle'}>
          {d === 0 ? 'now' : `day ${d}`}
        </text>
      ))}
      {lines
        .slice()
        .sort((a, b) => Number(a.f.id === highlight) - Number(b.f.id === highlight))
        .map(({ f, p10, p50, p90 }) => {
          const c = colour(f)
          const best = f.id === highlight
          return (
            <g key={f.id}>
              <path d={bandPath(pts(p90), pts(p10))} fill={c} opacity={best ? 0.16 : isBaseline(f) ? 0.12 : 0.035} />
              <path d={monotonePath(pts(p50))} fill="none" stroke={c} strokeWidth={best ? 3.5 : isBaseline(f) ? 2 : 1.5} strokeLinecap="round" opacity={best || isBaseline(f) ? 1 : 0.8} className={best && !applied ? 'fix-glow' : undefined} />
            </g>
          )
        })}
      {/* Advertiser reactions on the do-nothing route: dots on the line, labels in a row at the top. */}
      {(base.events ?? []).map((e, i) => {
        const vx = x(Math.min(n, e.after_h / 24))
        const vy = y(valueAtHour(lines.find((l) => l.f.id === base.id)!.p50, e.after_h))
        const ly = FS + i * (FS + 8) // label rows above the plot area
        return (
          <g key={e.label}>
            <line x1={vx} x2={vx} y1={ly + 6} y2={vy - 7} stroke={PINK} strokeOpacity={0.45} strokeDasharray="2 3" />
            <circle cx={vx} cy={vy} r={5} fill={AURORA.bg} stroke={PINK} strokeWidth={2} />
            <text x={vx + 6} y={ly + 4} fontSize={FS} fill="#FF8FB7">
              {e.label} · {Math.round(e.after_h)} h
            </text>
          </g>
        )
      })}
      {labels.map(({ l, y: ly, text }) => (
        <text key={l.f.id} x={W - M.r + 12} y={ly + 4} fontSize={FS} fill={colour(l.f)} fontWeight={l.f.id === highlight ? 600 : 400}>
          {text}
        </text>
      ))}
    </svg>
  )
}
