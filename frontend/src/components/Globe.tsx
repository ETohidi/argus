import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadWorldGeoJson } from '../lib/countryGeometry'
import { geometryContains, isOnGlobe } from '../lib/globeHit'
import { WORLD_COORDS, nightImage } from '../lib/daynight'
import { EarthImagery, graticule } from '../lib/earthImagery'
import type { GeoJSONSource, ImageSource } from 'maplibre-gl'
import { AURORA, STATUS_COLOR, STATUS_LABEL, potentialColor, usd } from '../lib/theme'
import type { CountryState, CountryStatus } from '../lib/types'

export type GlobeMode = 'health' | 'potential'

type Props = {
  countries: CountryState[]
  mode: GlobeMode
  selectedIso: string | null
  insetRight?: number // px covered by the right-hand card; the globe centres in the remaining space
  utcHour?: number // drives the day/night shading
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

// Health-mode fill opacity. Healthy markets: intensity by revenue share (US strongest), kept faint.
// During an incident every other market dims and the affected one carries `pulse`.
function opacityExpr(countries: CountryState[], pulse: number): unknown {
  const maxRev = Math.max(1, ...countries.map((c) => c.kpis.revenue))
  const anyIncident = countries.some((c) => c.status === 'incident')
  const entries = countries.map((c) => {
    let o: number
    if (c.status === 'incident') o = pulse
    else if (c.status === 'watch') o = 0.85
    else if (c.status === 'explained' || c.status === 'waiting') o = 0.55
    else o = 0.14 + 0.46 * Math.sqrt(c.kpis.revenue / maxRev)
    if (anyIncident && c.status !== 'incident') o *= 0.4
    return [c.iso, Math.round(o * 100) / 100]
  })
  return ['match', ['get', 'iso'], ...entries.flat(), 0.85]
}

// Only issues get a marker; explained / waiting markets are already told apart by their fill.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

const MARKER_STATUSES: CountryStatus[] = ['incident', 'watch']

export default function Globe({ countries, mode, selectedIso, insetRight = 0, utcHour, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const loadedRef = useRef(false)
  const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; status: CountryStatus }>())
  const countriesRef = useRef(countries)
  const modeRef = useRef(mode)
  const selectedRef = useRef(selectedIso)
  const onSelectRef = useRef(onSelect)
  const hourRef = useRef(utcHour ?? 12)
  const earthRef = useRef<EarthImagery | null>(null)
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
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // crisp on Retina without 3× GPU cost
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __argusMap?: MapLibreMap }).__argusMap = map // for edge hit-tests
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'argus-popup' })

    let lastInteraction = -Infinity
    let prev = performance.now()
    let frame = 0
    let lastPulse = 0
    let lastHide = 0
    const note = () => (lastInteraction = performance.now())
    const spin = (now: number) => {
      const dt = Math.min(now - prev, 100)
      prev = now
      if (!selectedRef.current && now - lastInteraction > 12_000 && !map.isMoving()) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng + dt * 0.0035, c.lat] })
      }
      // Pulse the affected country (≈15 fps is plenty for a slow breathe).
      if (loadedRef.current && now - lastPulse > 66 && countriesRef.current.some((c) => c.status === 'incident') && modeRef.current === 'health') {
        lastPulse = now
        map.setPaintProperty('watched', 'fill-opacity', opacityExpr(countriesRef.current, 0.7 + 0.25 * Math.sin(now / 420)) as any)
      }
      if (now - lastHide > 120) {
        lastHide = now
        hideFarMarkers()
      }
      frame = requestAnimationFrame(spin)
    }
    // Markers on the hidden hemisphere (or right on the horizon) are hidden outright.
    const hideFarMarkers = () => {
      const c = map.getCenter()
      const toRad = Math.PI / 180
      for (const { marker } of markersRef.current.values()) {
        const p = marker.getLngLat()
        const cos = Math.sin(c.lat * toRad) * Math.sin(p.lat * toRad) + Math.cos(c.lat * toRad) * Math.cos(p.lat * toRad) * Math.cos((p.lng - c.lng) * toRad)
        marker.getElement().style.visibility = cos > 0.15 ? 'visible' : 'hidden'
      }
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
      // Country polygons arrive lazily (50m Natural Earth); until then the ocean shows alone.
      map.addSource('world', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      loadWorldGeoJson().then((world) => {
        geometryByIso = new Map(world.features.filter((f) => f.properties.iso).map((f) => [f.properties.iso, f.geometry]))
        ;(map.getSource('world') as GeoJSONSource | undefined)?.setData(world as any)
      })
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
      // Night side: one smooth image from the sun's elevation (updated when the hour changes).
      map.addSource('night', { type: 'image', url: nightImage(hourRef.current), coordinates: WORLD_COORDS })
      map.addLayer({ id: 'night', type: 'raster', source: 'night', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } })
      // Faint graticule.
      map.addSource('graticule', { type: 'geojson', data: graticule() })
      map.addLayer(
        { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': AURORA.fg2, 'line-opacity': 0.07, 'line-width': 0.5 } },
        'borders',
      )
      // NASA day / night imagery, loaded lazily; until then the flat ocean and land show.
      EarthImagery.load()
        .then(async (earth) => {
          earthRef.current = earth
          const { url, poleColor } = await earth.render(hourRef.current)
          if (!mapRef.current) return
          map.setPaintProperty('ocean', 'background-color', poleColor)
          map.addSource('earth', { type: 'image', url, coordinates: WORLD_COORDS })
          map.addLayer({ id: 'earth', type: 'raster', source: 'earth', paint: { 'raster-fade-duration': 0, 'raster-opacity': 1 } }, 'land')
          map.setPaintProperty('land', 'fill-opacity-transition', { duration: 800 } as any)
          map.setPaintProperty('land', 'fill-opacity', 0)
          map.setLayoutProperty('night', 'visibility', 'none') // night is part of the blended texture now
        })
        .catch(() => {}) // keep the flat look if the images can't load
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
    let geometryByIso = new Map<string, import('geojson').Geometry>()
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
          ? `<span style="color:${STATUS_COLOR[c.status]}">● ${STATUS_LABEL[c.status]}</span>`
          : `Opportunity: <b>+${usd(c.potential_usd_day)}</b> a day if offers matched local tastes`
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
    map.setPaintProperty('watched', 'fill-opacity', (modeRef.current === 'health' ? opacityExpr(countriesRef.current, 0.95) : 0.85) as any)
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

  // Day/night: recompute the night overlay when the simulated hour changes.
  useEffect(() => {
    if (utcHour == null || utcHour === hourRef.current) return
    hourRef.current = utcHour
    const map = mapRef.current
    const earth = earthRef.current
    if (earth && map?.getSource('earth')) {
      const hour = utcHour
      earth.render(hour).then(({ url, poleColor }) => {
        if (hour !== hourRef.current) return
        ;(map.getSource('earth') as ImageSource | undefined)?.updateImage({ url, coordinates: WORLD_COORDS })
        map.setPaintProperty('ocean', 'background-color', poleColor)
      })
    } else {
      const src = map?.getSource('night') as ImageSource | undefined
      src?.updateImage({ url: nightImage(utcHour), coordinates: WORLD_COORDS })
    }
  }, [utcHour])

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
          curve: 1.3,
          easing: easeOutCubic,
          essential: true,
        })
      else map.flyTo({ center: [map.getCenter().lng, HOME_VIEW.center[1]], zoom: HOME_VIEW.zoom, padding, duration: 1600, easing: easeOutCubic, essential: true })
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
