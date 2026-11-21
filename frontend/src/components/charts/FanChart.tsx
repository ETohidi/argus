import type { Fix } from '../../lib/types'
import { usd } from '../../lib/theme'

const M = { l: 4, r: 4, t: 8, b: 20 }

type Props = {
  fix: Fix
  // Values are drawn relative to this reference (do-nothing p50), so the fans separate visually.
  reference: number[]
  domain: [number, number]
  color: string
  width?: number
  height?: number
}

export function relativeSeries(fix: Fix, reference: number[]) {
  const rel = (arr: number[]) => [0, ...arr.map((v, i) => v - (reference[i] ?? 0))]
  return { p10: rel(fix.p10), p50: rel(fix.p50), p90: rel(fix.p90) }
}

export default function FanChart({ fix, reference, domain, color, width: W = 200, height: H = 96 }: Props) {
  const { p10, p50, p90 } = relativeSeries(fix, reference)
  const fs = W >= 400 ? 13 : 8.5 // labels stay ~13 px when the chart is drawn large
  const n = p50.length - 1
  const x = (i: number) => M.l + (i / n) * (W - M.l - M.r)
  const y = (v: number) => H - M.b - ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (H - M.t - M.b)
  const band =
    p90.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ') +
    ' ' +
    p10
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${x(i)},${y(v)}`)
      .join(' ') +
    ' Z'
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const gid = `fan-${fix.id}`
  const end = p50[n]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={color} stopOpacity={0.28} />
          <stop offset="1" stopColor={color} stopOpacity={0.28} />
        </linearGradient>
      </defs>
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <line key={d} x1={x(d)} x2={x(d)} y1={M.t} y2={H - M.b} stroke="#1e293b" strokeWidth={0.6} />
      ))}
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.6} />
      <path d={band} fill={`url(#${gid})`} className="fade-in" />
      <path d={line(p50)} fill="none" stroke={color} strokeWidth={1.8} pathLength={1} className="draw" />
      <circle cx={x(n)} cy={y(end)} r={2.5} fill={color} />
      {[1, 7].map((d) => (
        <text key={d} x={x(d)} y={H - 3} fontSize={fs} fill="#64748b" textAnchor={d === 7 ? 'end' : 'middle'}>
          day {d}
        </text>
      ))}
      <text x={W - M.r - 4} y={Math.max(M.t + 8, Math.min(H - M.b - 4, y(end) + (end >= 0 ? -6 : 12)))} fontSize={fs} fill="#cbd5e1" textAnchor="end" className="num">
        {end >= 0 ? '+' : ''}
        {usd(end)}
      </text>
    </svg>
  )
}
