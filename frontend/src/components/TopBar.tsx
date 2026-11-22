import type { GlobeMode } from './Globe'
import ArgusEye from './ArgusEye'
import type { StatusSentence } from '../lib/incident'

type Props = {
  clock: string
  status: StatusSentence
  mode: GlobeMode
  onMode: (m: GlobeMode) => void
  growth?: { text: string; launchLabel: string; onLaunch: () => void } // Growth mode: one summary line and the new-market link
}

// Home bar (L1): logo, clock, one status sentence and the mode toggle. Nothing else.
export default function TopBar({ clock, status, mode, onMode, growth }: Props) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-8 px-8 py-6">
      <div className="pointer-events-auto flex items-center gap-3">
        <ArgusEye mood={status.mood} />
        <span className="text-[16px] font-semibold tracking-[0.3em] text-fg">ARGUS</span>
        <span className="num cursor-default text-[13px] text-fg-2" title="Simulated time: the marketplace runs hour by hour">
          {clock}
          <span className="text-fg-2/45"> · sim</span>
        </span>
      </div>

      {/* Calm needs no words: the blinking eye says it. The sentence appears only when something is happening. */}
      {mode === 'potential' && growth ? (
        <div key="growth" className="fade-in pointer-events-auto relative">
          <div className="text-[16px] text-fg">{growth.text}</div>
          <button onClick={growth.onLaunch} className="absolute left-0 top-full mt-1 whitespace-nowrap text-[13px] text-fg-2 hover:text-fg">
            {growth.launchLabel} →
          </button>
        </div>
      ) : (
        status.tone !== 'ok' && (
          <div key={status.text} className="fade-in pointer-events-auto flex items-center gap-2.5 text-[16px] text-fg">
            {status.text}
          </div>
        )
      )}

      <div className="pointer-events-auto ml-auto flex items-center gap-3">
        <div className="flex rounded-full bg-panel/70 p-1 ring-1 ring-line/50">
          {(['health', 'potential'] as GlobeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onMode(m)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition ${mode === m ? 'bg-line/80 text-fg' : 'text-fg-2 hover:text-fg'}`}
            >
              {m === 'health' ? 'Risks' : 'Growth'}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
