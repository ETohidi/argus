// Hierarchical zoom, made visible: Earth › Country › Segment › Users at the left edge. The current level is lit;
// clicking a higher level zooms back out. Below, how little Argus had to open (real counts from the backend).
export type Level = 'earth' | 'country' | 'segment' | 'users'
const LEVELS: { id: Level; label: string }[] = [
  { id: 'earth', label: 'Earth' },
  { id: 'country', label: 'Country' },
  { id: 'segment', label: 'Segment' },
  { id: 'users', label: 'Users' },
]

type Props = {
  level: Level
  counts?: { segments_opened?: number; segments_total?: number; users_checked?: number; users_total?: number }
  onLevel: (l: Level) => void
}

const fmt = (n: number) => n.toLocaleString('en-US')
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : fmt(n))

export default function LevelRail({ level, counts, onLevel }: Props) {
  const at = LEVELS.findIndex((l) => l.id === level)
  return (
    <nav aria-label="Zoom level" className="frost pointer-events-auto absolute left-4 top-1/2 z-[45] w-[200px] -translate-y-1/2 rounded-2xl px-3 py-3">
      <ol className="relative">
        <span className="absolute bottom-3 left-[7px] top-3 w-px bg-line" aria-hidden />
        {LEVELS.map((l, i) => {
          const current = i === at
          const reachable = i < at
          return (
            <li key={l.id}>
              <button
                onClick={() => reachable && onLevel(l.id)}
                disabled={!reachable}
                aria-current={current ? 'step' : undefined}
                className={`relative flex w-full items-center gap-2.5 py-1.5 text-left text-[14px] ${current ? 'font-semibold text-ok' : reachable ? 'text-fg hover:text-ok' : 'cursor-default text-fg-2'}`}
                title={reachable ? `Zoom out to ${l.label}` : undefined}
              >
                <span className={`relative z-10 h-[15px] w-[15px] shrink-0 rounded-full ring-2 ${current ? 'bg-ok ring-ok/40' : reachable ? 'bg-fg-2 ring-transparent' : 'bg-panel ring-line'}`} />
                {l.label}
              </button>
            </li>
          )
        })}
      </ol>
      {counts?.segments_total != null && (
        <p className="mt-2 border-t border-line pt-2 text-[14px] leading-snug text-fg-2">
          Argus opened <span className="text-fg">{fmt(counts.segments_opened ?? 0)}</span> of {fmt(counts.segments_total)} segments
          {counts.users_total != null && (
            <>
              <br />
              checked <span className="text-fg">{fmt(counts.users_checked ?? 0)}</span> of {compact(counts.users_total)} users
            </>
          )}
        </p>
      )}
    </nav>
  )
}
