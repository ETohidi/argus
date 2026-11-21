import { STATUS_STYLE } from './IncidentDetail'
import { STATUS_COLOR, usd } from '../lib/theme'
import type { WorldState } from '../lib/types'

const SEV_DOT = { high: '#f43f5e', medium: '#fbbf24', low: '#94a3b8' }

export default function IncidentFeed({ state, onOpen, onCountry }: { state: WorldState; onOpen: (id: string) => void; onCountry: (iso: string) => void }) {
  const name = (iso: string) => state.countries.find((c) => c.iso === iso)?.name ?? iso
  const active = state.incidents.filter((i) => i.status !== 'resolved')
  const resolved = state.incidents.filter((i) => i.status === 'resolved')
  const live = active.filter((i) => i.status === 'open' || i.status === 'persisting')
  const watching = state.countries.filter((c) => c.status === 'watch' || c.status === 'waiting')
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-700/50 px-5 py-4">
        <div className="section-title">Incident feed</div>
        <div className="mt-1 text-[13px] text-slate-300">
          {live.length === 0 ? (
            <span className="text-teal-300">
              All {state.countries.length} countries within forecast
              {active.length > 0 && <span className="text-slate-400"> · {active.length} being followed up</span>}
            </span>
          ) : (
            <span>
              <span className="font-semibold text-rose-300">{live.length}</span> open · {usd(live.reduce((s, i) => s + i.impact_usd_h, 0))}/h at stake
            </span>
          )}
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {active.map((inc, i) => (
          <button
            key={inc.id}
            onClick={() => onOpen(inc.id)}
            className="card fade-up group block w-full p-3 text-left transition hover:border-slate-500/50 hover:bg-slate-800/50"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {(inc.status === 'open' || inc.status === 'persisting') && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: SEV_DOT[inc.severity] }} />
                )}
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: SEV_DOT[inc.severity] }} />
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                {inc.id} · {name(inc.country)}
              </span>
              <span className={`ml-auto rounded-full px-2 py-px text-[10px] font-semibold uppercase ${STATUS_STYLE[inc.status]}`}>{inc.status.replace('_', ' ')}</span>
            </div>
            <div className="mt-1.5 text-[13px] font-medium leading-snug text-slate-100 group-hover:text-white">{inc.title}</div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
              <span className="capitalize">{inc.severity} severity</span>
              <span className="num text-rose-300">{usd(inc.impact_usd_h)}/h</span>
            </div>
          </button>
        ))}

        {active.length === 0 && (
          <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 animate-ping rounded-full border border-teal-400/30" />
              <div className="absolute inset-2 rounded-full border border-teal-400/60" />
              <div className="absolute inset-[18px] rounded-full bg-teal-400" />
            </div>
            <div className="text-[13px] font-medium text-slate-200">Watching quietly</div>
            <div className="text-[11.5px] text-slate-500">Every KPI in every country is compared with the twin's forecast each hour.</div>
          </div>
        )}

        {watching.length > 0 && (
          <div className="pt-2">
            <div className="section-title mb-2">Under watch</div>
            {watching.map((c) => (
              <button key={c.iso} onClick={() => onCountry(c.iso)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-slate-800/50">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />
                <span className="text-slate-200">{c.name}</span>
                <span className="ml-auto text-[11px] text-slate-500">{c.status === 'waiting' ? 'waiting for data · no alert' : `z ${c.health_z.toFixed(1)}`}</span>
              </button>
            ))}
          </div>
        )}

        {state.explained.length > 0 && (
          <div className="pt-2">
            <div className="section-title mb-2">Explained changes</div>
            {state.explained.map((e, i) => (
              <div key={i} className="fade-up mb-1.5 rounded-lg border border-slate-600/30 bg-slate-500/5 px-3 py-2 text-[11.5px]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  <span className="font-medium text-slate-200">{name(e.country)}</span>
                  <span className="text-slate-400">· {e.event}</span>
                  <span className="num ml-auto text-[10px] text-slate-500">h{e.t}</span>
                </div>
                <div className="mt-1 text-slate-400">
                  Naive detector <span className="num text-amber-300">z {e.naive_z.toFixed(1)}</span> would alert; twin with calendar{' '}
                  <span className="num text-teal-300">z {e.twin_z.toFixed(1)}</span>. No alert.
                </div>
              </div>
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <div className="pt-2">
            <div className="section-title mb-2">Resolved</div>
            {resolved.map((inc) => (
              <button key={inc.id} onClick={() => onOpen(inc.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-slate-400 hover:bg-slate-800/50">
                <span className="text-teal-400">✓</span>
                <span className="truncate">{inc.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
