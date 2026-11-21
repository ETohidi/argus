import type { GlobeMode } from './Globe'
import { POTENTIAL_STOPS, STATUS_COLOR, STATUS_LABEL } from '../lib/theme'
import type { CountryStatus } from '../lib/types'

type Props = {
  clock: string
  status: { text: string; tone: 'ok' | 'issue' | 'neutral' }
  mode: GlobeMode
  onMode: (m: GlobeMode) => void
}

const TONE: Record<Props['status']['tone'], string> = { ok: STATUS_COLOR.ok, issue: STATUS_COLOR.incident, neutral: STATUS_COLOR.explained }

// Home bar (L1): logo, clock, one status sentence, the mode toggle and a colour legend on hover. Nothing else.
export default function TopBar({ clock, status, mode, onMode }: Props) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-8 px-8 py-6">
      <div className="pointer-events-auto flex items-baseline gap-3">
        <span className="text-[16px] font-semibold tracking-[0.3em] text-fg">ARGUS</span>
        <span className="num text-[13px] text-fg-2">{clock}</span>
      </div>

      <div key={status.text} className="fade-in pointer-events-auto flex items-center gap-2.5 text-[16px] text-fg">
        <span className={`h-2 w-2 rounded-full ${status.tone === 'issue' ? 'animate-pulse' : ''}`} style={{ background: TONE[status.tone] }} />
        {status.text}
      </div>

      <div className="pointer-events-auto ml-auto flex items-center gap-3">
        <div className="flex rounded-full bg-panel/70 p-1 ring-1 ring-line/50">
          {(['health', 'potential'] as GlobeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onMode(m)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition ${mode === m ? 'bg-line/80 text-fg' : 'text-fg-2 hover:text-fg'}`}
            >
              {m === 'health' ? 'Health' : 'Potential'}
            </button>
          ))}
        </div>
        <div className="group relative">
          <button aria-label="Colour legend" className="grid h-8 w-8 place-items-center rounded-full text-[13px] text-fg-2 ring-1 ring-line/50 hover:text-fg">
            ?
          </button>
          <div className="invisible absolute right-0 top-10 w-60 rounded-xl bg-panel/95 p-4 text-[13px] text-fg opacity-0 ring-1 ring-line/50 transition group-hover:visible group-hover:opacity-100">
            {mode === 'health' ? (
              <ul className="space-y-2">
                {(Object.keys(STATUS_COLOR) as CountryStatus[]).map((s) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                    {STATUS_LABEL[s]}
                  </li>
                ))}
              </ul>
            ) : (
              <div>
                <div className="mb-2">Untapped potential, as % of each market's margin</div>
                <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${POTENTIAL_STOPS.map(([o, c]) => `${c} ${o * 100}%`).join(',')})` }} />
                <div className="mt-1 flex justify-between text-fg-2">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
