import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildWorldGeoJson } from '../lib/countryGeometry'
import { STATUS_COLOR, STATUS_LABEL, potentialColor, usd } from '../lib/theme'
import type { CountryState, CountryStatus } from '../lib/types'

export type GlobeMode = 'health' | 'potential'

type Props = {
  countries: CountryState[]
  mode: GlobeMode
  selectedIso: string | null
  onSelect: (iso: string | null) => void
}

const BASE_LAND = '#152030'
const HOME_VIEW = { center: [-30, 28] as [number, number], zoom: 1.7 }

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sources: {},
  layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': '#081321' } }],
}

function fillColors(countries: CountryState[], mode: GlobeMode): Record<string, string> {
  if (mode === 'health') return Object.fromEntries(countries.map((c) => [c.iso, STATUS_COLOR[c.status]]))
  const vals = countries.map((c) => c.potential_usd_day)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  return Object.fromEntries(countries.map((c) => [c.iso, potentialColor((c.potential_usd_day - lo) / (hi - lo || 1))]))
}

function matchExpr(colors: Record<string, string>, fallback: string): any {
  const entries = Object.entries(colors)
  if (!entries.length) return fallback
  return ['match', ['get', 'iso'], ...entries.flat(), fallback]
}

const MARKER_STATUSES: CountryStatus[] = ['incident', 'watch', 'explained', 'waiting']

export default function Globe({ countries, mode, selectedIso, onSelect }: Props) {
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
        'sky-color': '#02040a',
        'horizon-color': '#0f2a44',
        'fog-color': '#081321',
        'fog-ground-blend': 0.6,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.4],
      } as any)
      map.addSource('world', { type: 'geojson', data: buildWorldGeoJson() as any })
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
        paint: { 'line-color': '#0a1220', 'line-width': 0.6 },
      })
      map.addLayer({
        id: 'watched-outline',
        type: 'line',
        source: 'world',
        filter: ['!=', ['get', 'iso'], ''],
        paint: { 'line-color': '#e2e8f0', 'line-opacity': 0.25, 'line-width': 0.8 },
      })
      map.addLayer({
        id: 'selected-outline',
        type: 'line',
        source: 'world',
        filter: ['==', ['get', 'iso'], '__none__'],
        paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-blur': 0.5 },
      })
      loadedRef.current = true
      paint()
    })

    map.on('mousemove', 'watched', (e) => {
      const iso = e.features?.[0]?.properties?.iso as string | undefined
      const c = countriesRef.current.find((x) => x.iso === iso)
      if (!c) return
      canvas.style.cursor = 'pointer'
      const line =
        modeRef.current === 'health'
          ? `<span style="color:${STATUS_COLOR[c.status]}">● ${STATUS_LABEL[c.status]}</span> · z ${c.health_z.toFixed(1)}`
          : `Potential <b>+${usd(c.potential_usd_day)}</b>/day`
      popup.setLngLat(e.lngLat).setHTML(`<div class="font-semibold">${c.name}</div><div>${line}</div>`).addTo(map)
    })
    map.on('mouseleave', 'watched', () => {
      canvas.style.cursor = ''
      popup.remove()
    })
    map.on('click', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['watched'] })[0]
      const iso = f?.properties?.iso as string | undefined
      if (iso) onSelectRef.current(iso)
    })

    return () => {
      cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', note)
      canvas.removeEventListener('wheel', note)
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
  }, [])

  function paint() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setPaintProperty('watched', 'fill-color', matchExpr(fillColors(countriesRef.current, modeRef.current), BASE_LAND))
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

  // Fly to the selected country, or back to the whole globe.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const run = () => {
      map.setFilter('selected-outline', ['==', ['get', 'iso'], selectedIso ?? '__none__'])
      const c = countriesRef.current.find((x) => x.iso === selectedIso)
      if (c) map.flyTo({ center: [c.lng, c.lat - 4], zoom: c.iso === 'US' || c.iso === 'CA' || c.iso === 'BR' || c.iso === 'AU' ? 2.6 : 3.3, duration: 1800, essential: true })
      else map.flyTo({ center: [map.getCenter().lng, HOME_VIEW.center[1]], zoom: HOME_VIEW.zoom, duration: 1600, essential: true })
    }
    if (loadedRef.current) run()
    else map.once('load', run)
  }, [selectedIso])

  return <div ref={containerRef} className="absolute inset-0" />
}
