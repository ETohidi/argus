// World polygons from world-atlas (110m), tagged with ISO-2 codes for the countries Argus watches.
import countries110m from 'world-atlas/countries-110m.json'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

const ISO2_TO_NUMERIC: Record<string, string> = {
  US: '840', CA: '124', MX: '484', BR: '076', GB: '826', DE: '276', FR: '250', NL: '528', ES: '724', IT: '380',
  PL: '616', SE: '752', TR: '792', ZA: '710', IN: '356', ID: '360', PH: '608', JP: '392', KR: '410', AU: '036',
}
const NUMERIC_TO_ISO2 = new Map(Object.entries(ISO2_TO_NUMERIC).map(([a, n]) => [n, a]))

type Props = { iso: string; name: string }

export function buildWorldGeoJson(): FeatureCollection<Geometry, Props> {
  const topo = countries110m as any
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name?: string }>
  const features: Feature<Geometry, Props>[] = fc.features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .filter((f) => f.properties?.name !== 'Antarctica')
    .map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        iso: NUMERIC_TO_ISO2.get(String(f.id ?? '').padStart(3, '0')) ?? '',
        name: String(f.properties?.name ?? ''),
      },
    }))
  return { type: 'FeatureCollection', features }
}
