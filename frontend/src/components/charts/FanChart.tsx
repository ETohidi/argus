import type { Fix } from '../../lib/types'
import { usd } from '../../lib/theme'

const W = 200
const H = 92
const M = { l: 4, r: 4, t: 6, b: 14 }

type Props = {
  fix: Fix
  baseline?: Fix
  domain: [number, number]
  color: string
}

export default function FanChart({ fix, baseline, domain, color }: Props) {
  const days = [0, ...fix.days]
  const n = days.length - 1
  const x = (i: number) => M.l + (i / n) * (W - M.l - M.r)
  const y = (v: number) => H - M.b - ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (H - M.t - M.b)
  const p10 = [0, ...fix.p10]
  const p50 = [0, ...fix.p50]
  const p90 = [0, ...fix.p90]
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
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.45} />
          <stop offset="1" stopColor={color} stopOpacity={0.12} />
        </linearGradient>
      </defs>
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <line key={d} x1={x(d)} x2={x(d)} y1={M.t} y2={H - M.b} stroke="#1e293b" strokeWidth={0.6} />
      ))}
      {baseline && baseline.id !== fix.id && (
        <path d={line([0, ...baseline.p50])} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
      )}
      <path d={band} fill={`url(#${gid})`} className="fade-up" />
      <path d={line(p50)} fill="none" stroke={color} strokeWidth={1.8} pathLength={1} className="draw" />
      <circle cx={x(n)} cy={y(p50[n])} r={2.5} fill={color} />
      {[1, 7].map((d) => (
        <text key={d} x={x(d)} y={H - 3} fontSize={8} fill="#64748b" textAnchor="middle">
          d{d}
        </text>
      ))}
      <text x={W - M.r} y={M.t + 8} fontSize={8.5} fill="#cbd5e1" textAnchor="end" className="num">
        {usd(p50[n])}
      </text>
    </svg>
  )
}
