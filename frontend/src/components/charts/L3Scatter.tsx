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
        <Stat label="Accounts sampled" value={String(s.n_users)} />
        <Stat label="Flagged" value={String(s.n_flagged)} tone="text-problem" />
        <Stat label="Interests fit" value={`${s.coherence_flagged.toFixed(2)} vs ${s.coherence_others.toFixed(2)}`} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={M.t} y2={H - M.b} stroke="#1E2140" />
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#1E2140" />
            <text x={x(v)} y={H - M.b + 13} fontSize={9.5} fill="#7B7FA8" textAnchor="middle" className="num">
              {v}
            </text>
            <text x={M.l - 6} y={y(v) + 3} fontSize={9.5} fill="#7B7FA8" textAnchor="end" className="num">
              {v}
            </text>
          </g>
        ))}
        <text x={(W + M.l) / 2} y={H - 2} fontSize={10} fill="#7B7FA8" textAnchor="middle">
          Interests fit what they do →
        </text>
        <text transform={`translate(10,${(H - M.b) / 2}) rotate(-90)`} fontSize={10} fill="#7B7FA8" textAnchor="middle">
          Payout focus →
        </text>
        {others.map((p, i) => (
          <circle key={i} cx={x(p.coherence)} cy={y(p.payout_focus)} r={2} fill="#3CF2C4" opacity={0.3} />
        ))}
        {flagged.map((p, i) => (
          <circle key={`f${i}`} cx={x(p.coherence)} cy={y(p.payout_focus)} r={2.6} fill="#FF4D8D" opacity={0.9} className="fade-in" style={{ animationDelay: `${300 + i * 6}ms` }} />
        ))}
        {flagged.length > 0 && (
          <g>
            <ellipse cx={x(cx)} cy={y(cy)} rx={46} ry={22} fill="none" stroke="#FF6FA3" strokeDasharray="4 3" />
            <text x={x(cx) + 52} y={y(cy) - 4} fontSize={10.5} fill="#FF8FB7" fontWeight={600}>
              Fake accounts
            </text>
            <text x={x(cx) + 52} y={y(cy) + 9} fontSize={9.5} fill="#7B7FA8">
              {s.top_devices[0]}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-3 text-[13px] leading-relaxed text-fg-2">
        Real people's interests fit what they do (life signals predict what they complete). Bots chase payouts regardless.
      </p>
    </div>
  )
}

function Stat({ label, value, tone = 'text-fg' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-2 py-1.5">
      <div className={`num text-[16px] font-semibold ${tone}`}>{value}</div>
      <div className="text-[13px] text-fg-2">{label}</div>
    </div>
  )
}
