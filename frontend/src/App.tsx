import { useCallback, useEffect, useRef, useState } from 'react'
import AddMetricDialog from './components/AddMetricDialog'
import CountryPanel from './components/CountryPanel'
import Globe, { type GlobeMode } from './components/Globe'
import IncidentDetail from './components/IncidentDetail'
import IncidentFeed from './components/IncidentFeed'
import TopBar from './components/TopBar'
import { api, onBackendChange, type Backend } from './lib/api'
import { POTENTIAL_STOPS, STATUS_COLOR, STATUS_LABEL, usd } from './lib/theme'
import type { CountryDetail, CountryStatus, DemoScene, IncidentDetail as Detail, InjectType, MetricResponse, PotentialResponse, WorldState } from './lib/types'

// Default targets for the inject buttons (the demo script), overridden by the selected country.
const INJECT_DEFAULT: Record<InjectType, { country: string; platform?: string }> = {
  promo: { country: 'DE' },
  bot_farm: { country: 'CA', platform: 'android' },
  tracking_break: { country: 'GB', platform: 'ios' },
  data_delay: { country: 'FR' },
}

export default function App() {
  const [state, setState] = useState<WorldState | null>(null)
  const [backend, setBackend] = useState<Backend>('unknown')
  const [mode, setMode] = useState<GlobeMode>('health')
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [incidentId, setIncidentId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [countryIso, setCountryIso] = useState<string | null>(null)
  const [countryDetail, setCountryDetail] = useState<CountryDetail | null>(null)
  const [potential, setPotential] = useState<PotentialResponse | null>(null)
  const [metricOpen, setMetricOpen] = useState(false)
  const [metricResult, setMetricResult] = useState<MetricResponse | null>(null)
  const [approving, setApproving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [lastScene, setLastScene] = useState<DemoScene | null>(null)
  const busyRef = useRef(false)

  useEffect(() => onBackendChange(setBackend), [])

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  // Initial load + background polling while paused.
  useEffect(() => {
    api.state().then(setState).catch(() => {})
    api.potential().then(setPotential).catch(() => {})
    const id = window.setInterval(() => {
      if (!busyRef.current) api.state().then(setState).catch(() => {})
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  // Play: one sim hour every 1.2 s.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      if (!busyRef.current) run(() => api.step(1).then(setState))
    }, 1200)
    return () => window.clearInterval(id)
  }, [playing, run])

  // Keep the open incident and country in sync with the world clock.
  const t = state?.clock.t
  useEffect(() => {
    if (incidentId) api.incident(incidentId).then(setDetail).catch(() => setDetail(null))
    else setDetail(null)
  }, [incidentId, t])
  useEffect(() => {
    if (countryIso) api.country(countryIso).then(setCountryDetail).catch(() => setCountryDetail(null))
    else setCountryDetail(null)
  }, [countryIso, t])
  useEffect(() => {
    if (mode === 'potential') api.potential().then(setPotential).catch(() => {})
  }, [mode, t])

  const step = (h: number) => run(() => api.step(h).then(setState))

  const inject = (type: InjectType) =>
    run(async () => {
      const target = countryIso ? { country: countryIso, platform: INJECT_DEFAULT[type].platform } : INJECT_DEFAULT[type]
      await api.inject(type, target.country, target.platform)
      flash(`${type.replace('_', ' ')} scheduled · ${target.country}${target.platform ? ' ' + target.platform : ''}`)
      setState(await api.state())
    })

  const demo = (scene: DemoScene) =>
    run(async () => {
      const r = await api.demo(scene)
      setState(r.state)
      setLastScene(scene)
      if (scene === 'start') {
        setIncidentId(null)
        setCountryIso(null)
        setMode('health')
      }
      if (scene === 'new_metric') {
        setMetricResult(r.metric ?? null)
        setMetricOpen(true)
      }
      if (r.incident_id && scene !== 'bot_farm') {
        setCountryIso(null)
        setIncidentId(r.incident_id)
      }
      flash(`Scene · ${scene.replace('_', ' ')}`)
    })

  const approve = async (fixId: string) => {
    if (!incidentId) return
    setApproving(true)
    try {
      setDetail(await api.approve(incidentId, fixId))
      setState(await api.state())
      flash('Fix approved · applied to reality')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setApproving(false)
    }
  }

  const selectCountry = (iso: string | null) => {
    setIncidentId(null)
    setCountryIso(iso)
  }
  const openIncident = (id: string) => {
    setCountryIso(null)
    setIncidentId(id)
  }

  const country = state?.countries.find((c) => c.iso === countryIso) ?? null
  const focusIso = countryIso ?? detail?.country ?? null

  return (
    <div className="flex h-full flex-col">
      <TopBar
        clock={state?.clock.label ?? 'connecting…'}
        playing={playing}
        busy={busy}
        mode={mode}
        onPlay={() => setPlaying((p) => !p)}
        onStep={step}
        onMode={setMode}
        onDemo={demo}
        onInject={inject}
        onAddMetric={() => {
          setMetricResult(null)
          setMetricOpen(true)
        }}
        lastScene={lastScene}
      />

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {state && <Globe countries={state.countries} mode={mode} selectedIso={focusIso} onSelect={selectCountry} />}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(4,7,13,0.75))]" />
          {state && <GlobalStats state={state} />}
          <Legend mode={mode} />
          {toast && (
            <div className="fade-up absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-slate-600/50 bg-ink-850/90 px-4 py-1.5 text-[12px] capitalize text-slate-200 shadow-xl backdrop-blur">
              {toast}
            </div>
          )}
        </main>

        <aside className="panel relative z-10 w-[468px] shrink-0 border-l border-slate-700/40">
          {!state ? (
            <div className="p-6 text-slate-500">Loading world…</div>
          ) : detail && incidentId ? (
            <IncidentDetail key={detail.id} detail={detail} onBack={() => setIncidentId(null)} onApprove={approve} approving={approving} />
          ) : country ? (
            <CountryPanel country={country} detail={countryDetail} incidents={state.incidents} potential={potential} onBack={() => selectCountry(null)} onOpenIncident={openIncident} />
          ) : (
            <IncidentFeed state={state} onOpen={openIncident} onCountry={selectCountry} />
          )}
        </aside>
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-4 border-t border-slate-700/40 bg-ink-900/90 px-4 text-[12px] text-slate-400">
        <span className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute h-full w-full animate-ping rounded-full bg-teal-400 opacity-50" />
            <span className="relative h-2 w-2 rounded-full bg-teal-400" />
          </span>
          {state ? (
            <span>
              Watching <b className="num text-slate-100">{state.attention.watched_series}</b> series ·{' '}
              <b className="num text-slate-100">{state.attention.investigations}</b> investigation{state.attention.investigations === 1 ? '' : 's'} ·{' '}
              <b className="num text-pink-300">{state.attention.l3_runs}</b> deep dive{state.attention.l3_runs === 1 ? '' : 's'} (L3)
            </span>
          ) : (
            'connecting…'
          )}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-slate-500">L1 business → L2 segment → L3 users, descending only where impact × uncertainty is high</span>
          <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${backend === 'live' ? 'bg-teal-400/15 text-teal-300' : 'bg-amber-400/15 text-amber-300'}`}>
            {backend === 'live' ? 'live twin' : backend === 'mock' ? 'mock data' : '…'}
          </span>
        </span>
      </footer>

      {metricOpen && (
        <AddMetricDialog
          initial={metricResult}
          onClose={() => setMetricOpen(false)}
          onAdded={() => {
            api.state().then(setState).catch(() => {})
          }}
        />
      )}
    </div>
  )
}

function GlobalStats({ state }: { state: WorldState }) {
  const sum = (k: 'revenue' | 'margin' | 'completions') => state.countries.reduce((s, c) => s + c.kpis[k], 0)
  const counts = state.countries.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {})
  return (
    <div className="pointer-events-none absolute left-5 top-5 space-y-3">
      <div>
        <div className="section-title">Marketplace · last hour</div>
        <div className="mt-1 flex gap-6">
          <Kpi label="Revenue" value={usd(sum('revenue'))} />
          <Kpi label="Margin" value={usd(sum('margin'))} />
          <Kpi label="Completions" value={Math.round(sum('completions')).toLocaleString()} />
        </div>
      </div>
      <div className="flex gap-1.5">
        {(['ok', 'watch', 'incident', 'explained', 'waiting'] as CountryStatus[])
          .filter((s) => counts[s])
          .map((s) => (
            <span key={s} className="flex items-center gap-1.5 rounded-full bg-ink-900/70 px-2 py-0.5 text-[11px] text-slate-300 ring-1 ring-slate-700/50">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              <span className="num font-semibold">{counts[s]}</span> {STATUS_LABEL[s].toLowerCase()}
            </span>
          ))}
      </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num text-[22px] font-semibold text-slate-50 transition-all">{value}</div>
      <div className="text-[10.5px] text-slate-500">{label} / h</div>
    </div>
  )
}

function Legend({ mode }: { mode: GlobeMode }) {
  return (
    <div className="pointer-events-none absolute bottom-5 left-5 rounded-xl bg-ink-900/70 px-3 py-2.5 ring-1 ring-slate-700/50 backdrop-blur">
      {mode === 'health' ? (
        <div className="space-y-1">
          {(Object.keys(STATUS_COLOR) as CountryStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-2 text-[11px] text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}
            </div>
          ))}
        </div>
      ) : (
        <div className="w-48">
          <div className="mb-1.5 text-[11px] text-slate-300">Untapped potential · USD/day</div>
          <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${POTENTIAL_STOPS.map(([o, c]) => `${c} ${o * 100}%`).join(',')})` }} />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>low</span>
            <span>high</span>
          </div>
        </div>
      )}
    </div>
  )
}
