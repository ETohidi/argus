import { useEffect, useId, useRef, useState } from 'react'
import { bandPath, monotonePath, type Pt } from '../../lib/curves'
import type { SeriesPoint } from '../../lib/types'

type Props = {
  series: SeriesPoint[]
  leftAt?: { t: number; label: string } | null
  // Values to draw instead of series.actual (e.g. the counterfactual); the line animates between them.
  values?: number[]
  width?: number
  height?: number
  fontSize?: number
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3)

// Grey band = what the twin expected for each hour (lo..hi); line = what happened,
// white inside the band and orange outside it (exact, via an SVG mask of the band).
export default function NormalZoneChart({ series, leftAt, values, width: W = 356, height: H = 120, fontSize = 13 }: Props) {
  const id = useId().replace(/:/g, '')
  const target = values ?? series.map((p) => p.actual)
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const a = from.current.length === target.length ? from.current : target
    let raf = 0
    const tick = (now: number) => {
      const k = ease(Math.min(1, (now - start) / 900))
      const cur = target.map((v, i) => a[i] + (v - a[i]) * k)
      setShown(cur)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.join(',')])

  if (series.length < 2) return null
  const M = { l: 2, r: 2, t: leftAt ? fontSize + 10 : 6, b: fontSize + 10 }
  const all = [...series.flatMap((p) => [p.lo, p.hi, p.actual]), ...target]
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  const pad = (hi - lo) * 0.08 || 1
  lo -= pad
  hi += pad
  const n = series.length - 1
  const x = (i: number) => M.l + (i / n) * (W - M.l - M.r)
  const y = (v: number) => H - M.b - ((v - lo) / (hi - lo)) * (H - M.t - M.b)
  const upper: Pt[] = series.map((p, i) => [x(i), y(p.hi)])
  const lower: Pt[] = series.map((p, i) => [x(i), y(p.lo)])
  const band = bandPath(upper, lower)
  const line = monotonePath(shown.map((v, i) => [x(i), y(v)]))
  const li = leftAt ? series.findIndex((p) => p.t === leftAt.t) : -1
  const labelLeft = li >= 0 && x(li) > W * 0.55
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="What the twin expected versus what happened">
      <defs>
        <mask id={`out-${id}`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <rect width={W} height={H} fill="white" />
          <path d={band} fill="black" />
        </mask>
      </defs>
      <path d={band} fill="#7B7FA8" opacity={0.22} />
      <path d={monotonePath(series.map((p, i) => [x(i), y(p.expected)]))} fill="none" stroke="#7B7FA8" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 4" />
      <path d={line} fill="none" stroke="#F1F0FF" strokeWidth={2} strokeLinecap="round" />
      <path d={line} fill="none" stroke="#FF4D8D" strokeWidth={2.4} strokeLinecap="round" mask={`url(#out-${id})`} />
      {li >= 0 && (
        <g>
          <line x1={x(li)} x2={x(li)} y1={fontSize + 4} y2={H - M.b} stroke="#FF4D8D" strokeOpacity={0.6} strokeDasharray="2 3" />
          <text x={x(li) + (labelLeft ? 4 : -4)} y={fontSize} fontSize={fontSize} fill="#FF8FB7" textAnchor={labelLeft ? 'end' : 'start'}>
            Left the normal zone at {leftAt!.label}
          </text>
        </g>
      )}
      <text x={x(0)} y={H - 3} fontSize={fontSize} fill="#9A9CC4">
        {series[0].label}
      </text>
      <text x={x(n)} y={H - 3} fontSize={fontSize} fill="#9A9CC4" textAnchor="end">
        now
      </text>
    </svg>
  )
}
