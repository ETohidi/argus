import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GlobeMode } from './Globe'
import { DEMO_SCENES, type DemoScene, type InjectType } from '../lib/types'

const SCENE_LABEL: Record<DemoScene, string> = {
  start: 'Start · fresh world',
  promo: 'Planned promo (DE)',
  bot_farm: 'Bot farm (CA Android)',
  investigate: 'Investigate',
  approve: 'Approve fix',
  verify: 'Verify after 24 h',
  new_metric: 'Add new metric',
  tracking_break: 'Tracking break (GB iOS)',
}

const INJECTS: { type: InjectType; label: string; icon: string }[] = [
  { type: 'promo', label: 'Promo', icon: '✦' },
  { type: 'bot_farm', label: 'Bot farm', icon: '⚠' },
  { type: 'tracking_break', label: 'Tracking break', icon: '⛓' },
  { type: 'data_delay', label: 'Data delay', icon: '⏳' },
]

type Props = {
  clock: string
  playing: boolean
  busy: boolean
  mode: GlobeMode
  onPlay: () => void
  onStep: (h: number) => void
  onMode: (m: GlobeMode) => void
  onDemo: (s: DemoScene) => void
  onInject: (t: InjectType) => void
  onAddMetric: () => void
  lastScene: DemoScene | null
}

export default function TopBar(p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-700/40 bg-ink-900/90 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5 pr-2">
        <svg viewBox="0 0 32 32" className="h-7 w-7">
          <circle cx="16" cy="16" r="13" fill="none" stroke="#2dd4bf" strokeWidth="2" opacity="0.5" />
          <ellipse cx="16" cy="16" rx="13" ry="7" fill="none" stroke="#2dd4bf" strokeWidth="2" />
          <circle cx="16" cy="16" r="4" fill="#2dd4bf" />
          <circle cx="16" cy="16" r="1.6" fill="#04070d" />
        </svg>
        <div className="leading-none">
          <div className="text-[17px] font-bold tracking-[0.32em] text-slate-50">ARGUS</div>
          <div className="mt-0.5 text-[9px] tracking-[0.18em] text-teal-300/70">SELF-DRIVING ANALYST</div>
        </div>
      </div>

      <Divider />

      <div className="flex items-center gap-1.5">
        <div className="num min-w-[178px] rounded-md bg-slate-900/80 px-2.5 py-1.5 text-[12.5px] text-slate-100 ring-1 ring-slate-700/60">{p.clock}</div>
        <IconBtn onClick={p.onPlay} active={p.playing} title={p.playing ? 'Pause' : 'Play'}>
          {p.playing ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M4 2.5v11l9-5.5z" /></svg>
          )}
        </IconBtn>
        <Btn onClick={() => p.onStep(1)} disabled={p.busy}>+1h</Btn>
        <Btn onClick={() => p.onStep(6)} disabled={p.busy}>+6h</Btn>
      </div>

      <Divider />

      <div className="flex rounded-lg bg-slate-900/80 p-0.5 ring-1 ring-slate-700/60">
        {(['health', 'potential'] as GlobeMode[]).map((m) => (
          <button
            key={m}
            onClick={() => p.onMode(m)}
            className={`rounded-md px-3 py-1 text-[12px] font-medium capitalize transition ${
              p.mode === m ? (m === 'health' ? 'bg-teal-400/20 text-teal-200' : 'bg-fuchsia-400/20 text-fuchsia-200') : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-slate-500">Inject</span>
        {INJECTS.map((i) => (
          <Btn key={i.type} onClick={() => p.onInject(i.type)} disabled={p.busy} tone={i.type === 'promo' ? 'neutral' : 'warn'}>
            <span className="opacity-70">{i.icon}</span> {i.label}
          </Btn>
        ))}
        <Divider />
        <Btn onClick={p.onAddMetric}>＋ Add metric</Btn>
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-teal-500/80 to-cyan-500/80 px-3 py-1.5 text-[12px] font-semibold text-slate-950 hover:brightness-110"
          >
            Demo <span className="text-[9px]">▼</span>
          </button>
          {open && (
            <div className="fade-up absolute right-0 top-10 w-60 overflow-hidden rounded-xl border border-slate-700/60 bg-ink-850/95 p-1 shadow-2xl backdrop-blur">
              {DEMO_SCENES.map((s, i) => (
                <button
                  key={s}
                  onClick={() => {
                    setOpen(false)
                    p.onDemo(s)
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-slate-700/50 ${p.lastScene === s ? 'text-teal-200' : 'text-slate-200'}`}
                >
                  <span className="num grid h-5 w-5 place-items-center rounded bg-slate-800 text-[10px] text-slate-400">{i + 1}</span>
                  {SCENE_LABEL[s]}
                  {p.lastScene === s && <span className="ml-auto text-[10px]">●</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function Divider() {
  return <div className="h-6 w-px bg-slate-700/60" />
}

function Btn({ children, onClick, disabled, tone = 'neutral' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'neutral' | 'warn' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium ring-1 transition disabled:opacity-40 ${
        tone === 'warn' ? 'bg-amber-500/5 text-amber-100/90 ring-amber-400/20 hover:bg-amber-500/15' : 'bg-slate-800/70 text-slate-200 ring-slate-700/60 hover:bg-slate-700/70'
      }`}
    >
      {children}
    </button>
  )
}

function IconBtn({ children, onClick, active, title }: { children: ReactNode; onClick: () => void; active?: boolean; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-md ring-1 transition ${active ? 'bg-teal-400/20 text-teal-200 ring-teal-400/40' : 'bg-slate-800/70 text-slate-200 ring-slate-700/60 hover:bg-slate-700/70'}`}
    >
      {children}
    </button>
  )
}
