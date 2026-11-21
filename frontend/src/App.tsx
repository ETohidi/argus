import { useCallback, useEffect, useRef, useState } from 'react'
import CountrySheet from './components/CountrySheet'
import EvidenceView, { type EvidenceTab } from './components/EvidenceView'
import Globe, { type GlobeMode } from './components/Globe'
import IssueCard from './components/IssueCard'
import MetricGraphPanel from './components/MetricGraphPanel'
import ScenarioMenu, { SCENE_LABEL } from './components/ScenarioMenu'
import TimelineStrip from './components/TimelineStrip'
import TopBar from './components/TopBar'
import { api, onBackendChange, type Backend } from './lib/api'
import { eventName, needsDecision, shortTitle, statusSentence } from './lib/incident'
import { toOutcome, type MetricOutcome } from './lib/metrics'
import { DEMO_SCENES } from './lib/types'
import type { CountryDetail, DemoScene, IncidentDetail, InjectType, MetricGraph, PotentialResponse, TimelineEvent, WorldState } from './lib/types'

// Default targets for the inject actions (the demo script), overridden by the selected country.
const INJECT_DEFAULT: Record<InjectType, { country: string; platform?: string }> = {
  promo: { country: 'DE' },
  bot_farm: { country: 'CA', platform: 'android' },
  tracking_break: { country: 'GB', platform: 'ios' },
  data_delay: { country: 'FR' },
}

// Progressive disclosure, mirroring Argus' own abstraction levels:
// L1 home = the Earth and one status sentence; L2 = one issue card; L3 = the full-screen evidence.
export default function App() {
  const [state, setState] = useState<WorldState | null>(null)
  const [backend, setBackend] = useState<Backend>('unknown')
  const [mode, setMode] = useState<GlobeMode>('health')
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [lastScene, setLastScene] = useState<DemoScene | null>(null)
  // L2: the incident on the issue card, and its full detail (first fetch can take a few seconds).
  const [cardId, setCardId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [approving, setApproving] = useState(false)
  // L3 overlays.
  const [evidence, setEvidence] = useState<{ tab: EvidenceTab } | null>(null)
  const [graphView, setGraphView] = useState<{ highlight: string[]; outcome?: MetricOutcome | null; openForm?: boolean } | null>(null)
  const [metricGraph, setMetricGraph] = useState<MetricGraph | null>(null)
  // Country side sheet.
  const [countryIso, setCountryIso] = useState<string | null>(null)
  const [countryDetail, setCountryDetail] = useState<CountryDetail | null>(null)
  const [potential, setPotential] = useState<PotentialResponse | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])

  const busyRef = useRef(false)
  const backendRef = useRef<Backend>('unknown')
  const dismissed = useRef(new Set<string>())

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }, [])

  useEffect(
    () =>
      onBackendChange((b) => {
        const prev = backendRef.current
        backendRef.current = b
        setBackend(b)
        if (prev === 'live' && b === 'mock') flash('Simulation unreachable — showing sample data')
        if (prev === 'mock' && b === 'live') flash('Simulation connected')
      }),
    [flash],
  )

  const closeAll = () => {
    setCardId(null)
    setEvidence(null)
    setGraphView(null)
    setCountryIso(null)
  }

  // Every state update goes through here. A backend restart (in-memory sessions lost) shows up as the clock
  // jumping back; announce it instead of silently swapping the world. Clocks are tracked per data source so a
  // short outage that falls back to the mock world does not hide the restart.
  const lastSeen = useRef<Partial<Record<Backend, number>>>({})
  const expectReset = useRef(false)
  const applyState = useCallback(
    (next: WorldState) => {
      const src = backendRef.current
      const prevT = lastSeen.current[src]
      const restarted = prevT != null && !expectReset.current && next.clock.t < prevT
      lastSeen.current[src] = next.clock.t
      expectReset.current = false
      if (restarted) {
        setCardId(null)
        setEvidence(null)
        setGraphView(null)
        setCountryIso(null)
        setPlaying(false)
        setLastScene(null)
        dismissed.current.clear()
        flash(src === 'live' ? 'Simulation restarted — starting over' : 'Sample data reset')
      }
      setState(next)
    },
    [flash],
  )

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
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
    },
    [flash],
  )

  // Initial load + background polling while paused.
  useEffect(() => {
    api.state().then(applyState).catch(() => {})
    api.potential().then(setPotential).catch(() => {})
    const id = window.setInterval(() => {
      if (!busyRef.current) api.state().then(applyState).catch(() => {})
    }, 4000)
    return () => window.clearInterval(id)
  }, [applyState])

  // Play: one sim hour every 1.2 s.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      if (!busyRef.current) run(() => api.step(1).then(applyState))
    }, 1200)
    return () => window.clearInterval(id)
  }, [playing, run, applyState])

  // A new incident that needs a decision gets the card automatically (unless the user closed it).
  useEffect(() => {
    if (!state || cardId) return
    const next = state.incidents.find((i) => needsDecision(i) && !dismissed.current.has(i.id))
    if (next) setCardId(next.id)
  }, [state, cardId])

  // Keep the card's detail, the country sheet and the metric graph in sync with the world clock.
  const t = state?.clock.t
  useEffect(() => {
    if (!cardId) return setDetail(null)
    let live = true
    api
      .incident(cardId)
      .then((d) => live && setDetail(d))
      .catch(() => live && setCardId(null))
    return () => {
      live = false
    }
  }, [cardId, t])
  useEffect(() => {
    if (countryIso) api.country(countryIso).then(setCountryDetail).catch(() => setCountryDetail(null))
    else setCountryDetail(null)
  }, [countryIso, t])
  useEffect(() => {
    if (graphView) api.graph().then(setMetricGraph).catch(() => setMetricGraph(null))
  }, [graphView, t])
  useEffect(() => {
    if (mode === 'potential') api.potential().then(setPotential).catch(() => {})
  }, [mode, t])
  useEffect(() => {
    if (t != null) api.timeline().then((r) => setTimeline(r.events)).catch(() => setTimeline([]))
  }, [t])

  // Timeline click: incident events open that market's card; others just say what happened.
  const openTimelineEvent = (e: TimelineEvent) => {
    const incs = (state?.incidents ?? []).filter((i) => i.country === e.country)
    const inc = incs.find((i) => i.status !== 'resolved') ?? incs[incs.length - 1]
    if (inc && ['anomaly', 'detected', 'approved', 'verified'].includes(e.kind)) openIncident(inc.id)
    else flash(e.label)
  }

  const step = (h: number) => run(() => api.step(h).then(applyState))

  const inject = (type: InjectType) =>
    run(async () => {
      const target = countryIso ? { country: countryIso, platform: INJECT_DEFAULT[type].platform } : INJECT_DEFAULT[type]
      await api.inject(type, target.country, target.platform)
      flash(`${type.replace('_', ' ')} scheduled in ${target.country}`)
      applyState(await api.state())
    })

  // Each demo scene leaves the screen on the view that tells its part of the story.
  const demo = (scene: DemoScene) =>
    run(async () => {
      if (scene === 'start') expectReset.current = true
      const r = await api.demo(scene)
      applyState(r.state)
      setLastScene(scene)
      setEvidence(null)
      setGraphView(null)
      setCountryIso(null)
      switch (scene) {
        case 'start':
          dismissed.current.clear()
          setCardId(null)
          setMode('health')
          break
        case 'promo':
          setCardId(null)
          break
        case 'investigate':
          if (r.incident_id) setCardId(r.incident_id)
          setEvidence({ tab: 'graph' })
          break
        case 'new_metric': {
          // Play what Argus did by itself with the metric the scene just added.
          const node = r.metric?.node as { id?: string; expr?: string } | null | undefined
          const outcome = r.metric ? toOutcome(r.metric as never, '', []) : null
          setGraphView({ highlight: node?.id ? [node.id] : [], outcome })
          break
        }
        default: // bot_farm, approve, verify, tracking_break: the issue card
          if (r.incident_id) {
            dismissed.current.delete(r.incident_id)
            setCardId(r.incident_id)
          }
      }
      flash(SCENE_LABEL[scene])
    })

  const approve = async (fixId: string) => {
    if (!cardId) return
    setApproving(true)
    try {
      setDetail(await api.approve(cardId, fixId))
      applyState(await api.state())
      setEvidence(null)
      flash('Fix approved and applied')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setApproving(false)
    }
  }

  const selectCountry = (iso: string | null) => {
    setEvidence(null)
    setGraphView(null)
    setCountryIso(iso)
  }
  const openIncident = (id: string) => {
    setCountryIso(null)
    dismissed.current.delete(id)
    setCardId(id)
  }
  const closeCard = () => {
    if (cardId) dismissed.current.add(cardId)
    setCardId(null)
    setEvidence(null)
  }
  const openMetricGraph = () => {
    closeAll()
    setGraphView({ highlight: [] })
  }

  // Keyboard: 1–8 demo scenes, Space play / pause, E evidence, Esc closes the top layer.
  const keys = useRef({ demo, closeTop: () => {}, openEvidence: () => {} })
  keys.current = {
    demo,
    closeTop: () => (evidence ? setEvidence(null) : graphView ? setGraphView(null) : countryIso ? setCountryIso(null) : cardId ? closeCard() : undefined),
    openEvidence: () => cardId && setEvidence({ tab: 'graph' }),
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= DEMO_SCENES.length) {
        e.preventDefault()
        keys.current.demo(DEMO_SCENES[n - 1])
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'e' || e.key === 'E') keys.current.openEvidence()
      else if (e.key === 'Escape') keys.current.closeTop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const card = state?.incidents.find((i) => i.id === cardId)
  const country = state?.countries.find((c) => c.iso === countryIso) ?? null
  const cardCountry = state?.countries.find((c) => c.iso === card?.country)
  const focusIso = countryIso ?? card?.country ?? null
  const sideOpen = !!(country || card)
  const explained = state?.explained[0]

  return (
    <div className="relative h-full overflow-hidden bg-bg">
      {state && <Globe countries={state.countries} mode={mode} selectedIso={focusIso} insetRight={sideOpen ? 460 : 0} utcHour={state.clock.utc_hour ?? state.clock.t % 24} onSelect={selectCountry} />}

      <TopBar clock={state ? shortClock(state.clock) : 'Connecting…'} status={state ? statusSentence(state) : { text: 'Connecting…', tone: 'neutral', mood: 'calm' }} mode={mode} onMode={setMode} />

      {/* Right column: an explained change as a quiet note, then the issue card or the country sheet. */}
      <div className="pointer-events-none absolute bottom-8 right-8 top-24 z-20 flex flex-col items-end gap-4 overflow-y-auto">
        {explained && !country && !card && (
          <div className="fade-in pointer-events-auto max-w-[420px] text-right text-[13px] leading-relaxed text-fg-2">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-fg-2" />
            {state?.countries.find((c) => c.iso === explained.country)?.name ?? explained.country}: {eventName(explained.event)}, as planned
          </div>
        )}
        {country ? (
          <CountrySheet
            country={country}
            detail={countryDetail}
            incident={state?.incidents.find((i) => i.country === country.iso && i.status !== 'resolved')}
            potential={potential}
            onOpenIncident={openIncident}
            onClose={() => setCountryIso(null)}
          />
        ) : card ? (
          <IssueCard
            key={card.id}
            summary={card}
            detail={detail?.id === card.id ? detail : null}
            countryName={cardCountry?.name ?? card.country}
            approving={approving}
            onApprove={approve}
            onEvidence={() => setEvidence({ tab: 'graph' })}
            onClose={closeCard}
          />
        ) : null}
      </div>

      {state && (state.incidents.some((i) => i.status !== 'resolved') || timeline.some((e) => e.t >= state.clock.t - 72)) && (
        <div className="pointer-events-none absolute bottom-6 left-48 z-20 transition-[right] duration-300 ease-out" style={{ right: sideOpen ? 480 : 40 }}>
          <TimelineStrip
            events={timeline}
            now={state.clock.t}
            countryName={(iso) => state.countries.find((c) => c.iso === iso)?.name ?? iso}
            onOpen={openTimelineEvent}
          />
        </div>
      )}

      <ScenarioMenu
        state={state}
        backend={backend}
        playing={playing}
        busy={busy}
        lastScene={lastScene}
        injectTarget={country?.name ?? 'the demo markets'}
        onPlay={() => setPlaying((p) => !p)}
        onStep={step}
        onDemo={demo}
        onInject={inject}
        onAddMetric={openMetricGraph}
      />

      <div className="pointer-events-none absolute bottom-1.5 right-8 z-10 text-[13px] text-fg-2">Earth imagery: NASA Visible Earth</div>

      {toast && (
        <div className="fade-up pointer-events-none absolute left-1/2 top-24 z-50 -translate-x-1/2 rounded-full bg-panel/90 px-5 py-2 text-[13px] text-fg ring-1 ring-line/50">
          {toast}
        </div>
      )}

      {evidence && card && (
        <EvidenceView
          detail={detail?.id === card.id ? detail : null}
          title={shortTitle(card.card?.title ?? card.title)}
          initialTab={evidence.tab}
          approving={approving}
          onApprove={approve}
          onClose={() => setEvidence(null)}
        />
      )}
      {graphView && (
        <MetricGraphPanel
          key={graphView.outcome?.kind === 'added' ? graphView.outcome.id : 'graph'}
          graph={metricGraph}
          highlight={graphView.highlight}
          outcome={graphView.outcome}
          openForm={graphView.openForm}
          onAdded={() => {
            api.graph().then(setMetricGraph).catch(() => {})
            api.state().then(applyState).catch(() => {})
          }}
          onClose={() => setGraphView(null)}
        />
      )}

    </div>
  )
}

// "Mon 12:00": the clock without the day counter or the time zone.
function shortClock(c: WorldState['clock']) {
  if (c.day_of_week != null && c.utc_hour != null) return `${c.day_of_week} ${String(c.utc_hour).padStart(2, '0')}:00`
  const m = c.label.match(/([A-Z][a-z]{2}) (\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : c.label
}
