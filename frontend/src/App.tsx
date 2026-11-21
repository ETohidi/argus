import { useCallback, useEffect, useRef, useState } from 'react'
import AddMetricDialog from './components/AddMetricDialog'
import CountryPanel from './components/CountryPanel'
import Globe, { type GlobeMode } from './components/Globe'
import IncidentDetail, { type Audience } from './components/IncidentDetail'
import MetricGraphPanel from './components/MetricGraphPanel'
import IncidentFeed from './components/IncidentFeed'
import ScenarioMenu from './components/ScenarioMenu'
import TopBar from './components/TopBar'
import { api, onBackendChange, type Backend } from './lib/api'
import { statusSentence } from './lib/incident'
import { DEMO_SCENES } from './lib/types'
import type { CountryDetail, DemoScene, IncidentDetail as Detail, InjectType, MetricGraph, MetricResponse, PotentialResponse, WorldState } from './lib/types'

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
  const [audience, setAudience] = useState<Audience>('engineer')
  const [graphView, setGraphView] = useState<{ highlight: string[] } | null>(null)
  const [metricGraph, setMetricGraph] = useState<MetricGraph | null>(null)
  const busyRef = useRef(false)
  const backendRef = useRef<Backend>('unknown')

  useEffect(
    () =>
      onBackendChange((b) => {
        const prev = backendRef.current
        backendRef.current = b
        setBackend(b)
        if (prev === 'live' && b === 'mock') flash('Twin unreachable — showing mock data')
        if (prev === 'mock' && b === 'live') flash('Twin connected')
      }),
    [],
  )

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }

  // Every state update goes through here so a backend restart (in-memory sessions lost, clock jumps back)
  // is announced instead of silently swapping the world.
  // Last clock seen per data source, so an outage that briefly falls back to the mock world
  // still lets us notice that the live twin came back with a fresh world.
  const lastSeen = useRef<Partial<Record<Backend, number>>>({})
  const expectReset = useRef(false)
  const applyState = useCallback((next: WorldState) => {
    const src = backendRef.current
    const prevT = lastSeen.current[src]
    const restarted = prevT != null && !expectReset.current && next.clock.t < prevT
    lastSeen.current[src] = next.clock.t
    expectReset.current = false
    if (restarted) {
      setIncidentId(null)
      setCountryIso(null)
      setGraphView(null)
      setPlaying(false)
      setLastScene(null)
      flash(src === 'live' ? 'Twin restarted — world reset' : 'Mock world reset')
    }
    setState(next)
  }, [])

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
    api.state().then(applyState).catch(() => {})
    api.potential().then(setPotential).catch(() => {})
    const id = window.setInterval(() => {
      if (!busyRef.current) api.state().then(applyState).catch(() => {})
    }, 4000)
    return () => window.clearInterval(id)
  }, [])

  // Play: one sim hour every 1.2 s.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      if (!busyRef.current) run(() => api.step(1).then(applyState))
    }, 1200)
    return () => window.clearInterval(id)
  }, [playing, run, applyState])

  // Keep the open incident and country in sync with the world clock.
  const t = state?.clock.t
  useEffect(() => {
    if (incidentId)
      api
        .incident(incidentId)
        .then(setDetail)
        .catch(() => {
          setDetail(null)
          setIncidentId(null)
        })
    else setDetail(null)
  }, [incidentId, t])
  useEffect(() => {
    if (graphView) api.graph().then(setMetricGraph).catch(() => setMetricGraph(null))
  }, [graphView, t])
  useEffect(() => {
    if (countryIso) api.country(countryIso).then(setCountryDetail).catch(() => setCountryDetail(null))
    else setCountryDetail(null)
  }, [countryIso, t])
  useEffect(() => {
    if (mode === 'potential') api.potential().then(setPotential).catch(() => {})
  }, [mode, t])

  const step = (h: number) => run(() => api.step(h).then(applyState))

  const inject = (type: InjectType) =>
    run(async () => {
      const target = countryIso ? { country: countryIso, platform: INJECT_DEFAULT[type].platform } : INJECT_DEFAULT[type]
      await api.inject(type, target.country, target.platform)
      flash(`${type.replace('_', ' ')} scheduled · ${target.country}${target.platform ? ' ' + target.platform : ''}`)
      applyState(await api.state())
    })

  const demo = (scene: DemoScene) =>
    run(async () => {
      if (scene === 'start') expectReset.current = true
      const r = await api.demo(scene)
      applyState(r.state)
      setLastScene(scene)
      setGraphView(null)
      // Leave the right panel on the view that tells this scene's story.
      switch (scene) {
        case 'start':
        case 'promo':
          setIncidentId(null)
          setCountryIso(null)
          setMode('health')
          break
        case 'bot_farm': {
          // First sighting: fly to the country and show its L2 heatmap; the incident opens on "investigate".
          const inc = r.state.incidents.find((i) => i.id === r.incident_id)
          setIncidentId(null)
          setCountryIso(inc?.country ?? null)
          break
        }
        case 'investigate':
        case 'approve':
        case 'verify':
          setAudience('ceo')
          break
        case 'tracking_break':
          setAudience('engineer')
          break
        case 'new_metric': {
          const node = r.metric?.node as { id?: string } | null | undefined
          setMetricResult(r.metric ?? null)
          setIncidentId(null)
          setCountryIso(null)
          setGraphView({ highlight: node?.id ? [node.id] : [] })
          break
        }
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
      applyState(await api.state())
      flash('Fix approved · applied to reality')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setApproving(false)
    }
  }

  const selectCountry = (iso: string | null) => {
    setIncidentId(null)
    setGraphView(null)
    setCountryIso(iso)
  }
  const openIncident = (id: string) => {
    setCountryIso(null)
    setGraphView(null)
    setIncidentId(id)
  }

  const openAddMetric = () => {
    setMetricResult(null)
    setMetricOpen(true)
  }

  // Keyboard shortcuts for recording without visible controls: 1–8 = demo scenes, Space = play / pause.
  const demoRef = useRef(demo)
  demoRef.current = demo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= DEMO_SCENES.length) {
        e.preventDefault()
        demoRef.current(DEMO_SCENES[n - 1])
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const country = state?.countries.find((c) => c.iso === countryIso) ?? null
  const focusIso = countryIso ?? detail?.country ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {state && <Globe countries={state.countries} mode={mode} selectedIso={focusIso} onSelect={selectCountry} />}
          <TopBar clock={state?.clock.label ?? 'Connecting…'} status={state ? statusSentence(state) : { text: 'Connecting to the twin…', tone: 'neutral' }} mode={mode} onMode={setMode} />
          <ScenarioMenu
            state={state}
            backend={backend}
            playing={playing}
            busy={busy}
            lastScene={lastScene}
            injectTarget={countryIso ? (state?.countries.find((c) => c.iso === countryIso)?.name ?? countryIso) : 'the demo markets'}
            onPlay={() => setPlaying((p) => !p)}
            onStep={step}
            onDemo={demo}
            onInject={inject}
            onAddMetric={openAddMetric}
          />
          {toast && (
            <div className="fade-up absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-[13px] text-slate-200 ring-1 ring-slate-700/50">
              {toast}
            </div>
          )}
        </main>

        <aside className="panel relative z-10 w-[468px] shrink-0 border-l border-slate-700/40">
          {!state ? (
            <div className="p-6 text-slate-500">Loading world…</div>
          ) : incidentId && detail?.id !== incidentId ? (
            <IncidentLoading onBack={() => setIncidentId(null)} />
          ) : detail && incidentId ? (
            <IncidentDetail
              key={detail.id}
              detail={detail}
              onBack={() => setIncidentId(null)}
              onApprove={approve}
              approving={approving}
              aud={audience}
              onAud={setAudience}
              countryName={state.countries.find((c) => c.iso === detail.country)?.name}
            />
          ) : graphView ? (
            <MetricGraphPanel graph={metricGraph} highlight={graphView.highlight} result={metricResult} onBack={() => setGraphView(null)} />
          ) : country ? (
            <CountryPanel country={country} detail={countryDetail} incidents={state.incidents} potential={potential} onBack={() => selectCountry(null)} onOpenIncident={openIncident} />
          ) : (
            <IncidentFeed state={state} onOpen={openIncident} onCountry={selectCountry} />
          )}
        </aside>
      </div>


      {metricOpen && (
        <AddMetricDialog
          initial={metricResult}
          onClose={() => setMetricOpen(false)}
          onAdded={(id) => {
            api.state().then(applyState).catch(() => {})
            setIncidentId(null)
            setCountryIso(null)
            setGraphView({ highlight: id ? [id] : [] })
          }}
        />
      )}
    </div>
  )
}

// First fetch of an incident can take a few seconds (the backend writes the audience reports with an LLM).
function IncidentLoading({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col px-5 pt-4">
      <button onClick={onBack} className="mb-3 self-start text-[11px] text-slate-400 hover:text-slate-200">
        ← All incidents
      </button>
      <div className="h-5 w-3/4 animate-pulse rounded bg-slate-800/70" />
      <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-slate-800/50" />
      <div className="mt-6 h-28 animate-pulse rounded-xl bg-slate-800/40" />
      <div className="mt-3 h-40 animate-pulse rounded-xl bg-slate-800/30" />
      <div className="mt-4 text-[12px] text-slate-500">Writing the reports…</div>
    </div>
  )
}
