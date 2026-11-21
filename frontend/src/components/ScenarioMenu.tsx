import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Backend } from '../lib/api'
import { DEMO_SCENES, type DemoScene, type InjectType, type WorldState } from '../lib/types'

export const SCENE_LABEL: Record<DemoScene, string> = {
  start: 'Fresh world',
  promo: 'Planned promo in Germany',
  bot_farm: 'Bot farm in Canada',
  investigate: 'Investigate',
  approve: 'Approve the fix',
  verify: 'Verify after 24 h',
  new_metric: 'Add a new metric',
  tracking_break: 'Tracking break in the UK',
}

const INJECTS: { type: InjectType; label: string }[] = [
  { type: 'promo', label: 'Promo' },
  { type: 'bot_farm', label: 'Bot farm' },
  { type: 'tracking_break', label: 'Tracking break' },
  { type: 'data_delay', label: 'Data delay' },
]

type Props = {
  state: WorldState | null
  backend: Backend
  playing: boolean
  busy: boolean
  lastScene: DemoScene | null
  injectTarget: string
  onPlay: () => void
  onStep: (h: number) => void
  onDemo: (s: DemoScene) => void
  onInject: (t: InjectType) => void
  onAddMetric: () => void
}

// Every operator control lives behind one quiet button, so the recorded screen stays clean.
// Shortcuts work with the menu closed: 1–8 run the demo scenes, Space plays / pauses.
export default function ScenarioMenu(p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [])
  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }
  const a = p.state?.attention
  return (
    <div ref={ref} className="absolute bottom-6 left-8 z-30">
      {open && (
        <div className="fade-up absolute bottom-12 left-0 w-[340px] rounded-2xl bg-slate-900/95 p-5 text-[13px] text-slate-300 shadow-2xl ring-1 ring-slate-700/50">
          <Group title="Time">
            <div className="flex gap-2">
              <Btn onClick={p.onPlay} hint="Space">{p.playing ? 'Pause' : 'Play'}</Btn>
              <Btn onClick={() => p.onStep(1)} disabled={p.busy}>+1 h</Btn>
              <Btn onClick={() => p.onStep(6)} disabled={p.busy}>+6 h</Btn>
            </div>
          </Group>
          <Group title="Demo scenes">
            <ol className="-mx-2">
              {DEMO_SCENES.map((s, i) => (
                <li key={s}>
                  <button
                    onClick={act(() => p.onDemo(s))}
                    disabled={p.busy}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-800/70 disabled:opacity-40 ${p.lastScene === s ? 'text-teal-300' : ''}`}
                  >
                    <kbd className="num w-4 text-center text-slate-500">{i + 1}</kbd>
                    {SCENE_LABEL[s]}
                  </button>
                </li>
              ))}
            </ol>
          </Group>
          <Group title={`Inject into ${p.injectTarget}`}>
            <div className="flex flex-wrap gap-2">
              {INJECTS.map((x) => (
                <Btn key={x.type} onClick={act(() => p.onInject(x.type))} disabled={p.busy}>
                  {x.label}
                </Btn>
              ))}
            </div>
          </Group>
          <Group title="Metrics" last>
            <Btn onClick={act(p.onAddMetric)}>Add a metric…</Btn>
          </Group>
          <div className="mt-4 border-t border-slate-800 pt-3 text-slate-500">
            {p.backend === 'live' ? 'Live twin' : p.backend === 'mock' ? 'Mock data (backend unreachable)' : 'Connecting…'}
            {a && (
              <div className="mt-1">
                Watching {a.watched_series} series · {a.investigations} investigation{a.investigations === 1 ? '' : 's'} · {a.l3_runs} deep dive
                {a.l3_runs === 1 ? '' : 's'} (L3)
              </div>
            )}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full px-4 py-2 text-[13px] ring-1 transition ${open ? 'text-slate-200 ring-slate-600' : 'text-slate-500 ring-slate-800 hover:text-slate-300'}`}
      >
        Scenario
      </button>
    </div>
  )
}

function Group({ title, children, last }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={last ? '' : 'mb-4'}>
      <div className="mb-2 text-slate-500">{title}</div>
      {children}
    </div>
  )
}

function Btn({ children, onClick, disabled, hint }: { children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-lg bg-slate-800/80 px-3 py-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
      {children}
      {hint && <span className="ml-2 text-slate-500">{hint}</span>}
    </button>
  )
}
