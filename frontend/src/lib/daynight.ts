// Night-side shading for the globe: a grid of cells whose opacity follows the sun's elevation, so the
// terminator is a soft twilight band rather than a hard edge.
import type { FeatureCollection, Polygon } from 'geojson'

const RAD = Math.PI / 180
const CELL = 3 // degrees (≈7k cells; fine enough for a soft terminator)

// Sub-solar point for a UTC hour; declination fixed to late November (about −20°), when this demo runs.
export function subsolar(utcHour: number, declination = -20) {
  return { lng: (12 - utcHour) * 15, lat: declination }
}

function sunElevation(lng: number, lat: number, sun: { lng: number; lat: number }) {
  const cos = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lng - sun.lng) * RAD)
  return Math.asin(Math.max(-1, Math.min(1, cos))) / RAD
}

export function nightCells(utcHour: number, maxOpacity = 0.55): FeatureCollection<Polygon, { o: number }> {
  const sun = subsolar(utcHour)
  const features: FeatureCollection<Polygon, { o: number }>['features'] = []
  for (let lat = -84; lat < 84; lat += CELL) {
    for (let lng = -180; lng < 180; lng += CELL) {
      const e = sunElevation(lng + CELL / 2, lat + CELL / 2, sun)
      // Full darkness below −12° (nautical twilight), none above +2°.
      const o = Math.max(0, Math.min(1, (2 - e) / 14)) * maxOpacity
      if (o < 0.01) continue
      features.push({
        type: 'Feature',
        properties: { o: Math.round(o * 100) / 100 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[lng, lat], [lng + CELL, lat], [lng + CELL, lat + CELL], [lng, lat + CELL], [lng, lat]]],
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
