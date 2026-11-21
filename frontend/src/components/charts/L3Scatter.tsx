import type { L3Result } from '../../lib/types'

const W = 440
const H = 210
const M = { l: 32, r: 10, t: 10, b: 28 }

export default function L3Scatter({ l3 }: { l3: L3Result }) {
  const x = (v: number) => M.l + v * (W - M.l - M.r)
  const y = (v: number) => H - M.b - v * (H - M.t - M.b)
  const flagged = l3.points.filter((p) => p.flagged)
  const others = l3.points.filter((p) => !p.flagged)
  const cx = flagged.reduce((s, p) => s + p.coherence, 0) / (flagged.length || 1)
  const cy = flagged.reduce((s, p) => s + p.payout_focus, 0) / (flagged.length || 1)
  const s = l3.summary
  return (
    <div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="users sampled" value={String(s.n_users)} />
        <Stat label="flagged" value={String(s.n_flagged)} tone="text-rose-400" />
        <Stat label="coherence" value={`${s.coherence_flagged.toFixed(2)} vs ${s.coherence_others.toFixed(2)}`} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={M.t} y2={H - M.b} stroke="#1e293b" />
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#1e293b" />
            <text x={x(v)} y={H - M.b + 13} fontSize={9.5} fill="#64748b" textAnchor="middle" className="num">
              {v}
            </text>
            <text x={M.l - 6} y={y(v) + 3} fontSize={9.5} fill="#64748b" textAnchor="end" className="num">
              {v}
            </text>
          </g>
        ))}
        <text x={(W + M.l) / 2} y={H - 2} fontSize={10} fill="#94a3b8" textAnchor="middle">
          taste coherence →
        </text>
        <text transform={`translate(10,${(H - M.b) / 2}) rotate(-90)`} fontSize={10} fill="#94a3b8" textAnchor="middle">
          payout focus →
        </text>
        {others.map((p, i) => (
          <circle key={i} cx={x(p.coherence)} cy={y(p.payout_focus)} r={2} fill="#5eead4" opacity={0.35} />
        ))}
        {flagged.map((p, i) => (
          <circle key={`f${i}`} cx={x(p.coherence)} cy={y(p.payout_focus)} r={2.6} fill="#f43f5e" opacity={0.9} className="fade-up" style={{ animationDelay: `${300 + i * 6}ms` }} />
        ))}
        {flagged.length > 0 && (
          <g>
            <ellipse cx={x(cx)} cy={y(cy)} rx={46} ry={22} fill="none" stroke="#fb7185" strokeDasharray="4 3" />
            <text x={x(cx) + 52} y={y(cy) - 4} fontSize={10.5} fill="#fda4af" fontWeight={600}>
              fraud cluster
            </text>
            <text x={x(cx) + 52} y={y(cy) + 9} fontSize={9.5} fill="#94a3b8">
              {s.top_devices[0]}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        Real people have coherent tastes (life signals predict what they complete). Bots chase payouts regardless of taste.
      </p>
    </div>
  )
}

function Stat({ label, value, tone = 'text-slate-100' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-800/40 px-2 py-1.5">
      <div className={`num text-[13px] font-semibold ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}
