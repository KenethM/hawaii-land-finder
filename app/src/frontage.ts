// Which road(s) does a lot face? Measures from each lot edge's midpoint to the nearest road line.
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import { closestOnSegment, localFrame, lotRing, type Pt } from './geo'

export interface RoadHit {
  point: Position // nearest point on the road (lon/lat)
  name: string | null
  owner: string | null
  maint: string | null
  distM: number
}

export interface Frontage extends RoadHit {
  alsoFronts: RoadHit[] // other roads along a different edge: corner or double-frontage lots
}

const MATCH_COUNTY_M = 40 // prefer the county road-maintenance inventory when it's this close
const FRONTS_M = 30 // another road this close to a different edge also fronts the lot
const SEARCH_DEG = 0.004 // ~400 m prefilter around the lot
const MIN_EDGE_M = 3

interface Hit {
  f: Feature
  edge: number
  q: Pt
  d: number
  county: boolean
}

function lines(f: Feature): Position[][] {
  const g = f.geometry as LineString | MultiLineString | null
  if (!g) return []
  return g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
}

/** Best (closest) edge-midpoint hit for every road feature near the lot. */
function hitsFor(lot: Feature<Polygon | MultiPolygon>, roads: Feature[], county: boolean) {
  const ring = lotRing(lot)
  const frame = localFrame(ring[0])
  const pts = ring.map(frame.toLocal)
  // Measure from edge midpoints: measuring from corners ties between the two edges that meet there
  const mids: { p: Pt; edge: number }[] = []
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= MIN_EDGE_M) mids.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], edge: i })
  })
  const lons = ring.map((c) => c[0])
  const lats = ring.map((c) => c[1])
  const [minX, maxX, minY, maxY] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]

  const hits: Hit[] = []
  for (const f of roads) {
    let best: Hit | null = null
    for (const line of lines(f)) {
      const lp = line.map(frame.toLocal)
      for (let i = 0; i < lp.length - 1; i++) {
        // Cheap bbox prefilter per segment (road vertices can be a kilometer apart)
        const [a, b] = [line[i], line[i + 1]]
        if (Math.max(a[0], b[0]) < minX - SEARCH_DEG || Math.min(a[0], b[0]) > maxX + SEARCH_DEG) continue
        if (Math.max(a[1], b[1]) < minY - SEARCH_DEG || Math.min(a[1], b[1]) > maxY + SEARCH_DEG) continue
        for (const m of mids) {
          const { q, d } = closestOnSegment(m.p, lp[i], lp[i + 1])
          if (!best || d < best.d) best = { f, edge: m.edge, q, d, county }
        }
      }
    }
    if (best) hits.push(best)
  }
  return { hits, frame }
}

function toRoadHit(h: Hit, frame: ReturnType<typeof localFrame>): RoadHit {
  const p = h.f.properties ?? {}
  return { point: frame.toLonLat(h.q), name: p.FULLNAME ?? p.fullname ?? null, owner: p.OWNER ?? null, maint: p.MAINTAINER ?? null, distM: h.d }
}

/**
 * The road the lot faces (preferring the county road-maintenance inventory, which knows who
 * maintains it), plus any other roads running along a different edge (corner lots).
 */
export function nearestRoad(lot: Feature<Polygon | MultiPolygon>, countyRoads: Feature[], otherRoads: Feature[]): Frontage | null {
  const c = hitsFor(lot, countyRoads, true)
  const o = hitsFor(lot, otherRoads, false)
  const frame = c.frame
  const byDist = (a: Hit, b: Hit) => a.d - b.d
  const county = [...c.hits].sort(byDist)
  const all = [...c.hits, ...o.hits].sort((a, b) => (a.county === b.county ? a.d - b.d : a.county ? -1 : 1))

  const primary = county[0] && county[0].d <= MATCH_COUNTY_M ? county[0] : [...c.hits, ...o.hits].sort(byDist)[0]
  if (!primary) return null

  // One road per edge: county inventory first (state centerlines often duplicate the same road)
  const usedEdges = new Set([primary.edge])
  const alsoFronts: RoadHit[] = []
  for (const h of all) {
    if (h.d > FRONTS_M || usedEdges.has(h.edge)) continue
    const name = h.f.properties?.FULLNAME ?? h.f.properties?.fullname
    const primaryName = primary.f.properties?.FULLNAME ?? primary.f.properties?.fullname
    if (name && name === primaryName) continue // same road wrapping around a corner
    usedEdges.add(h.edge)
    alsoFronts.push(toRoadHit(h, frame))
  }
  return { ...toRoadHit(primary, frame), alsoFronts }
}
