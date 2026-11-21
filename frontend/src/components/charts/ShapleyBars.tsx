import { usd } from '../../lib/theme'

const NAMES: Record<string, string> = {
  new_accounts: 'New accounts',
  active_users: 'Active users',
  impressions: 'Impressions',
  starts: 'Starts',
  completions: 'Completions',
  revenue: 'Revenue / acceptance',
  rewards: 'Reward share',
  quality: 'Quality',
}

export default function ShapleyBars({ items }: { items: { mechanism: string; value_usd: number }[] }) {
  const sorted = [...items].sort((a, b) => Math.abs(b.value_usd) - Math.abs(a.value_usd))
  const max = Math.max(1, ...sorted.map((i) => Math.abs(i.value_usd)))
  const total = items.reduce((s, i) => s + i.value_usd, 0)
  return (
    <div className="space-y-2">
      {sorted.map((it, i) => {
        const w = (Math.abs(it.value_usd) / max) * 50
        const neg = it.value_usd < 0
        return (
          <div key={it.mechanism} className="grid grid-cols-[150px_1fr_80px] items-center gap-3 text-[13px]">
            <span className="truncate text-slate-300">{NAMES[it.mechanism] ?? it.mechanism}</span>
            <div className="relative h-3.5">
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
              <div
                className="grow-x absolute inset-y-0.5 rounded-sm"
                style={{
                  left: neg ? `${50 - w}%` : '50%',
                  width: `${Math.max(w, 0.4)}%`,
                  background: neg ? '#f97316' : '#2dd4bf',
                  transformOrigin: neg ? 'right' : 'left',
                  animationDelay: `${i * 60}ms`,
                }}
              />
            </div>
            <span className={`num text-right ${neg ? 'text-orange-300' : 'text-teal-300'}`}>{usd(it.value_usd)}/h</span>
          </div>
        )
      })}
      <div className="mt-3 flex justify-between border-t border-slate-800 pt-3 text-[13px] text-slate-500">
        <span>Exact Shapley values over 8 mechanisms; they add up to the margin change</span>
        <span className="num font-semibold text-slate-200">Σ {usd(total)}/h</span>
      </div>
    </div>
  )
}
