// "What could I build?" estimate: shrink the lot by its setbacks to get a buildable envelope.
import area from '@turf/area'
import buffer from '@turf/buffer'
import { featureCollection, polygon } from '@turf/helpers'
import intersect from '@turf/intersect'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { ccw, clipHalfPlane, localFrame, lotRing, nearestEdge, type Pt } from './geo'
import type { Setback, ZoneRule } from './lot'

const M_PER_FT = 0.3048
const MIN_EDGE_M = 3 // ignore tiny edges (digitizing noise) when classifying sides

export interface Buildable {
  envelope: Feature<Polygon | MultiPolygon> | null
  envelopeM2: number
  lotM2: number
  maxFootprintM2: number | null
  setback: Setback
  usesFrontage: boolean // true when the front was taken from the actual road, not guessed from lot shape
  frontCount: number // 2+ = corner lot with front setbacks on several road sides
}

/**
 * Offset each lot edge inward by its own setback.
 * - One road: the edge facing it is the front; it and edges parallel to it (the rear) get the
 *   front/rear setback, the rest get the side setback.
 * - Several roads (corner lot): each road-facing edge gets the front setback, all others the side.
 * - No road: assume the short ends are front/rear (typical long Puna lots).
 * The result is intersected with a uniform side-setback buffer so concave lots never extend past
 * the required yards.
 */
function envelopeFor(lot: Feature<Polygon | MultiPolygon>, frontRearM: number, sideM: number, fronts: Position[]) {
  const ring = lotRing(lot)
  const frame = localFrame(ring[0])
  const pts = ccw(ring.map(frame.toLocal))

  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    return { p, u: [(q[0] - p[0]) / len, (q[1] - p[1]) / len] as Pt, len }
  })
  const frontIdx = new Set(fronts.map((f) => nearestEdge(pts, frame.toLocal(f), MIN_EDGE_M)).filter((i) => i >= 0))
  const ref = frontIdx.size ? edges[[...frontIdx][0]] : edges.reduce((a, b) => (b.len > a.len ? b : a))

  let env: Pt[] = pts
  for (const [i, e] of edges.entries()) {
    if (e.len < MIN_EDGE_M) continue
    const parallel = Math.abs(e.u[0] * ref.u[0] + e.u[1] * ref.u[1]) >= Math.SQRT1_2
    let d: number
    if (frontIdx.size > 1) d = frontIdx.has(i) ? frontRearM : sideM
    else if (frontIdx.size === 1) d = parallel ? frontRearM : sideM
    else d = parallel ? sideM : frontRearM
    env = clipHalfPlane(env, e.p, [-e.u[1], e.u[0]], d)
    if (env.length < 3) return null
  }

  const ringLL = [...env.map(frame.toLonLat), frame.toLonLat(env[0])]
  const shrunk = buffer(lot, -sideM, { units: 'meters' }) as Feature<Polygon | MultiPolygon> | undefined
  if (!shrunk) return null
  return intersect(featureCollection([polygon([ringLL]), shrunk])) as Feature<Polygon | MultiPolygon> | null
}

export function estimateBuildable(
  lot: Feature<Polygon | MultiPolygon>,
  setback: Setback | null,
  rule: ZoneRule | undefined,
  fronts: Position[] = [],
): Buildable | null {
  if (!setback) return null
  const envelope = envelopeFor(lot, setback.front_rear_ft * M_PER_FT, setback.side_ft * M_PER_FT, fronts)
  const envelopeM2 = envelope ? area(envelope) : 0
  const lotM2 = area(lot)
  const coverage = rule?.verified ? rule.max_lot_coverage_pct : null
  const maxFootprintM2 = coverage == null ? null : Math.min(lotM2 * (coverage / 100), envelopeM2)
  return { envelope: envelopeM2 > 0 ? envelope : null, envelopeM2, lotM2, maxFootprintM2, setback, usesFrontage: fronts.length > 0, frontCount: fronts.length }
}
