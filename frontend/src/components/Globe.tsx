import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildWorldGeoJson } from '../lib/countryGeometry'
import { geometryContains, isOnGlobe } from '../lib/globeHit'
import { AURORA, STATUS_COLOR, STATUS_LABEL, potentialColor, usd } from '../lib/theme'
import type { CountryState, CountryStatus } from '../lib/types'

export type GlobeMode = 'health' | 'potential'

type Props = {
  countries: CountryState[]
  mode: GlobeMode
  selectedIso: string | null
  insetRight?: number // px covered by the right-hand card; the globe centres in the remaining space
  onSelect: (iso: string | null) => void
}

const BASE_LAND = AURORA.land
const HOME_VIEW = { center: [-30, 28] as [number, number], zoom: 1.95 }

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sources: {},
  layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': AURORA.oceanOut } }],
}

function fillColors(countries: CountryState[], mode: GlobeMode): Record<string, string> {
  if (mode === 'health') return Object.fromEntries(countries.map((c) => [c.iso, STATUS_COLOR[c.status]]))
  // Rank-based (on % uplift when available) so one large market does not wash out the rest.
  const v = (c: CountryState) => c.potential_pct ?? c.potential_usd_day
  const ranked = [...countries].sort((a, b) => v(a) - v(b))
  const n = Math.max(1, ranked.length - 1)
  return Object.fromEntries(ranked.map((c, i) => [c.iso, potentialColor(i / n)]))
}

function matchExpr(colors: Record<string, string>, fallback: string): any {
  const entries = Object.entries(colors)
  if (!entries.length) return fallback
  return ['match', ['get', 'iso'], ...entries.flat(), fallback]
}

const MARKER_STATUSES: CountryStatus[] = ['incident', 'watch', 'explained', 'waiting']

export default function Globe({ countries, mode, selectedIso, insetRight = 0, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const loadedRef = useRef(false)
  const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; status: CountryStatus }>())
  const countriesRef = useRef(countries)
  const modeRef = useRef(mode)
  const selectedRef = useRef(selectedIso)
  const onSelectRef = useRef(onSelect)
  countriesRef.current = countries
  modeRef.current = mode
  selectedRef.current = selectedIso
  onSelectRef.current = onSelect

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
      attributionControl: false,
      renderWorldCopies: false,
      maxZoom: 5,
      minZoom: 1,
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __argusMap?: MapLibreMap }).__argusMap = map // for edge hit-tests
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'argus-popup' })

    let lastInteraction = -Infinity
    let prev = performance.now()
    let frame = 0
    const note = () => (lastInteraction = performance.now())
    const spin = (now: number) => {
      const dt = Math.min(now - prev, 100)
      prev = now
      if (!selectedRef.current && now - lastInteraction > 12_000 && !map.isMoving()) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng + dt * 0.0035, c.lat] })
      }
      frame = requestAnimationFrame(spin)
    }
    const canvas = map.getCanvas()
    canvas.addEventListener('pointerdown', note)
    canvas.addEventListener('wheel', note, { passive: true })
    frame = requestAnimationFrame(spin)

    map.on('load', () => {
      map.setSky({
        'sky-color': AURORA.bg,
        'horizon-color': '#2B2470',
        'fog-color': AURORA.oceanIn,
        'fog-ground-blend': 0.6,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 4, 0.35], // violet glow around the globe
      } as any)
      map.addSource('world', { type: 'geojson', data: world as any })
      map.addLayer({
        id: 'land',
        type: 'fill',
        source: 'world',
        paint: { 'fill-color': BASE_LAND, 'fill-opacity': 1 },
      })
      map.addLayer({
        id: 'watched',
        type: 'fill',
        source: 'world',
        filter: ['!=', ['get', 'iso'], ''],
        paint: { 'fill-color': BASE_LAND, 'fill-opacity': 0.82, 'fill-color-transition': { duration: 800 } as any },
      })
      map.addLayer({
        id: 'borders',
        type: 'line',
        source: 'world',
        paint: { 'line-color': AURORA.border, 'line-width': 0.5 },
      })
      map.addLayer({
        id: 'watched-outline',
        type: 'line',
        source: 'world',
        filter: ['!=', ['get', 'iso'], ''],
        paint: { 'line-color': AURORA.fg2, 'line-opacity': 0.25, 'line-width': 0.5 },
      })
      map.addLayer({
        id: 'hover-outline',
        type: 'line',
        source: 'world',
        filter: ['==', ['get', 'iso'], '__none__'],
        paint: { 'line-color': AURORA.fg, 'line-opacity': 0.7, 'line-width': 1.2 },
      })
      map.addLayer({
        id: 'selected-outline',
        type: 'line',
        source: 'world',
        filter: ['==', ['get', 'iso'], '__none__'],
        paint: { 'line-color': AURORA.fg, 'line-width': 1.6 },
      })
      loadedRef.current = true
      paint()
    })

    // Hover and click only react to watched countries under the pointer on the visible globe surface.
    const world = buildWorldGeoJson()
    const geometryByIso = new Map(world.features.filter((f) => f.properties.iso).map((f) => [f.properties.iso, f.geometry]))
    const countryAt = (point: { x: number; y: number }): string | null => {
      if (!loadedRef.current || !isOnGlobe(map, point)) return null
      const { lng, lat } = map.unproject([point.x, point.y])
      for (const f of map.queryRenderedFeatures([point.x, point.y], { layers: ['watched'] })) {
        const iso = f.properties?.iso as string | undefined
        const g = iso ? geometryByIso.get(iso) : undefined
        if (iso && g && geometryContains(g, lng, lat)) return iso
      }
      return null
    }
    let hovered: string | null = null
    const clearHover = () => {
      if (hovered === null && !popup.isOpen()) return
      hovered = null
      canvas.style.cursor = ''
      popup.remove()
      if (loadedRef.current) map.setFilter('hover-outline', ['==', ['get', 'iso'], '__none__'])
    }
    map.on('mousemove', (e) => {
      const iso = countryAt(e.point)
      const c = iso ? countriesRef.current.find((x) => x.iso === iso) : undefined
      if (!c) return clearHover()
      note() // hovering a country pauses auto-rotation
      if (hovered !== c.iso) {
        hovered = c.iso
        map.setFilter('hover-outline', ['==', ['get', 'iso'], c.iso])
      }
      canvas.style.cursor = 'pointer'
      const line =
        modeRef.current === 'health'
          ? `<span style="color:${STATUS_COLOR[c.status]}">● ${STATUS_LABEL[c.status]}</span> · z ${c.health_z.toFixed(1)}`
          : `Potential <b>+${usd(c.potential_usd_day)}</b>/day${c.potential_pct != null ? ` · +${c.potential_pct.toFixed(1)}% margin` : ''}`
      popup.setLngLat(e.lngLat).setHTML(`<div class="font-semibold">${c.name}</div><div>${line}</div>`).addTo(map)
    })
    // The globe moves under a still pointer (auto-rotation, fly-to), so a stale hover is cleared on movement too.
    map.on('movestart', clearHover)
    canvas.addEventListener('mouseleave', clearHover)
    map.on('click', (e) => {
      const iso = countryAt(e.point)
      if (iso) onSelectRef.current(iso)
    })

    return () => {
      cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', note)
      canvas.removeEventListener('wheel', note)
      canvas.removeEventListener('mouseleave', clearHover)
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
  }, [])

  function paint() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setPaintProperty('watched', 'fill-color', matchExpr(fillColors(countriesRef.current, modeRef.current), BASE_LAND))
    // Calm Earth: healthy markets stay faint so only the affected country stands out.
    const opacity =
      modeRef.current === 'health'
        ? Object.fromEntries(countriesRef.current.map((c) => [c.iso, c.status === 'ok' ? 0.28 : c.status === 'explained' || c.status === 'waiting' ? 0.6 : 0.95]))
        : {}
    const entries = Object.entries(opacity)
    map.setPaintProperty('watched', 'fill-opacity', entries.length ? (['match', ['get', 'iso'], ...entries.flat(), 0.85] as any) : 0.85)
    syncMarkers()
  }

  function syncMarkers() {
    const map = mapRef.current
    if (!map) return
    const want = new Map(
      countriesRef.current
        .filter((c) => modeRef.current === 'health' && MARKER_STATUSES.includes(c.status))
        .map((c) => [c.iso, c]),
    )
    for (const [iso, m] of markersRef.current) {
      const c = want.get(iso)
      if (!c || c.status !== m.status) {
        m.marker.remove()
        markersRef.current.delete(iso)
      }
    }
    for (const [iso, c] of want) {
      if (markersRef.current.has(iso)) continue
      const el = document.createElement('div')
      el.className = `argus-marker argus-marker--${c.status}`
      el.innerHTML = '<span></span><span></span><i></i>'
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onSelectRef.current(iso)
      })
      const marker = new maplibregl.Marker({ element: el, opacityWhenCovered: '0' } as any).setLngLat([c.lng, c.lat]).addTo(map)
      markersRef.current.set(iso, { marker, status: c.status })
    }
  }

  useEffect(paint, [countries, mode])

  // Fly to the selected country, or back to the whole globe, keeping clear of the right-hand card.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const run = () => {
      map.setFilter('selected-outline', ['==', ['get', 'iso'], selectedIso ?? '__none__'])
      const padding = { top: 0, bottom: 0, left: 0, right: insetRight }
      const c = countriesRef.current.find((x) => x.iso === selectedIso)
      if (c)
        map.flyTo({
          center: [c.lng, c.lat - 4],
          zoom: ['US', 'CA', 'BR', 'AU'].includes(c.iso) ? 2.3 : ['IN', 'ID', 'MX', 'ZA'].includes(c.iso) ? 2.8 : 3.3,
          padding,
          duration: 1800,
          essential: true,
        })
      else map.flyTo({ center: [map.getCenter().lng, HOME_VIEW.center[1]], zoom: HOME_VIEW.zoom, padding, duration: 1600, essential: true })
    }
    if (loadedRef.current) run()
    else map.once('load', run)
  }, [selectedIso, insetRight])

  // maplibre-gl.css forces position: relative on the container, so size it from a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
