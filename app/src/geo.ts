// Small planar-geometry helpers. Lots are tiny (a few hundred meters), so a local
// equirectangular projection around the lot is accurate to well under a foot.
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'

export type Pt = [number, number]

const M_PER_DEG_LAT = 110574
export const FT_PER_M = 3.28084

export interface LocalFrame {
  toLocal: (c: Position) => Pt // lon/lat -> meters (x east, y north)
  toLonLat: (p: Pt) => Position
}

export function localFrame(origin: Position): LocalFrame {
  const [lon0, lat0] = origin
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320
  return {
    toLocal: (c) => [(c[0] - lon0) * kx, (c[1] - lat0) * M_PER_DEG_LAT],
    toLonLat: (p) => [p[0] / kx + lon0, p[1] / M_PER_DEG_LAT + lat0],
  }
}

/** Outer ring of the lot (largest part for multi-part lots), without the closing vertex. */
export function lotRing(lot: Feature<Polygon | MultiPolygon>): Position[] {
  const g = lot.geometry
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
  const sized = rings.map((r) => ({ r, a: Math.abs(signedArea(r as Pt[])) }))
  return sized.sort((a, b) => b.a - a.a)[0].r.slice(0, -1)
}

export function signedArea(pts: Pt[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    s += p[0] * q[1] - q[0] * p[1]
  }
  return s / 2
}

/** Counter-clockwise copy, so the interior is always to the left of each edge. */
export const ccw = (pts: Pt[]): Pt[] => (signedArea(pts) < 0 ? [...pts].reverse() : pts)

/** Clip a polygon to the half-plane { P : n·(P − a) ≥ d } (Sutherland–Hodgman). */
export function clipHalfPlane(poly: Pt[], a: Pt, n: Pt, d: number): Pt[] {
  const side = (p: Pt) => n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) - d
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const fp = side(p)
    const fq = side(q)
    if (fp >= 0) out.push(p)
    if (fp * fq < 0) {
      const t = fp / (fp - fq)
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return out
}

export function closestOnSegment(p: Pt, a: Pt, b: Pt): { q: Pt; d: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  const q: Pt = [a[0] + t * dx, a[1] + t * dy]
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }
}

/** Index of the polygon edge (i -> i+1) closest to point p, ignoring edges shorter than minLen. */
export function nearestEdge(pts: Pt[], p: Pt, minLen = 0): number {
  let best = -1
  let bestD = Infinity
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) return
    const { d } = closestOnSegment(p, a, b)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

export function pointInPolygon(p: Pt, poly: Pt[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function distanceToRing(p: Pt, ring: Pt[]) {
  let d = Infinity
  ring.forEach((a, i) => (d = Math.min(d, closestOnSegment(p, a, ring[(i + 1) % ring.length]).d)))
  return d
}
