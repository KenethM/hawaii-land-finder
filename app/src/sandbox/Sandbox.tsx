// Lot sandbox: the selected lot on its own, road at the bottom, for sketching a plan.
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateBuildable } from '../buildable'
import type { Frontage } from '../frontage'
import { ccw, distanceToRing, FT_PER_M, localFrame, lotRing, nearestEdge, pointInPolygon, type Pt } from '../geo'
import { roadText, type Lot, type Setback, type ZoneRule } from '../lot'
import { lotLink, shareUrl } from '../share'
import { AERIAL_ATTRIBUTION, aerialTiles } from './aerial'
import { exportPlanPng } from './exportPng'
import { loadPlan, newId, outline, preset, PRESETS, savePlan, type Plan, type Shape, type ShapeKind } from './plan'
import './sandbox.css'

interface Props {
  lot: Lot
  geom: Feature<Polygon | MultiPolygon>
  road: Frontage | null
  setback: Setback | null
  rule: ZoneRule | undefined
  sharedPlan?: Plan | null // opened from a share link: view it without overwriting the saved plan
  onClose: () => void
}

type Tool = 'select' | 'pin'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
// Schematic road strip drawn outside each front edge (ft)
const ROAD_GAP_FT = 6
const ROAD_WIDTH_FT = 22
const ROAD_EXT_FT = 80
type RoadHitLike = { name: string | null; owner: string | null; maint: string | null }

const ROAD_COLOR: Record<string, string> = {
  County: '#1b9e77',
  'County - Grant of Easement': '#1b9e77',
  State: '#5b6abf',
  Private: '#d95f02',
  RIL: '#c2185b',
  'RIL - Not on Inventory': '#c2185b',
  'County Unimproved - Not Maintained': '#c2185b',
}

export default function Sandbox({ lot, geom, road, setback, rule, sharedPlan, onClose }: Props) {
  // ---- Plan state (saved per lot on this device; a shared plan isn't saved until kept) ----
  const [plan, setPlan] = useState<Plan>(() => sharedPlan ?? loadPlan(lot.tmk))
  const [shared, setShared] = useState(!!sharedPlan)
  useEffect(() => {
    if (!shared) savePlan(lot.tmk, plan)
  }, [lot.tmk, plan, shared])

  // ---- Which road(s) get the front setback. Corner lots default to all of them (most cautious). ----
  const roadsFronting = useMemo(() => (road ? [road, ...road.alsoFronts] : []), [road])
  const frontChoice = plan.front ?? 'all'
  const fronts = useMemo(
    () => (frontChoice === 'all' || !roadsFronting[frontChoice] ? roadsFronting : [roadsFronting[frontChoice]]),
    [frontChoice, roadsFronting],
  )
  const bottomRoad = fronts[0] ?? null
  const buildable = useMemo(() => estimateBuildable(geom, setback, rule, fronts.map((f) => f.point)), [geom, setback, rule, fronts])

  // ---- Geometry in "plan" coordinates: feet, x east, y north, origin at the lot center ----
  const geo = useMemo(() => {
    const ring = lotRing(geom)
    const frame = localFrame(ring[0])
    const m = ccw(ring.map(frame.toLocal))
    const cx = m.reduce((s, p) => s + p[0], 0) / m.length
    const cy = m.reduce((s, p) => s + p[1], 0) / m.length
    const toPlan = (c: number[]): Pt => {
      const [x, y] = frame.toLocal(c)
      return [(x - cx) * FT_PER_M, (y - cy) * FT_PER_M]
    }
    const lotPts = m.map(([x, y]) => [(x - cx) * FT_PER_M, (y - cy) * FT_PER_M] as Pt)
    const env = buildable?.envelope?.geometry
    const envRings = !env ? [] : (env.type === 'Polygon' ? [env.coordinates[0]] : env.coordinates.map((p) => p[0])).map((r) => r.slice(0, -1).map(toPlan))

    const roadPt = bottomRoad ? toPlan(bottomRoad.point) : null
    const frontEdges = fronts.map((f) => nearestEdge(lotPts, toPlan(f.point), 10)).filter((i) => i >= 0)
    let front = roadPt ? nearestEdge(lotPts, roadPt, 10) : -1
    if (front < 0) {
      // No road found: treat the southern-most edge as the front
      front = lotPts.reduce((best, p, i) => {
        const q = lotPts[(i + 1) % lotPts.length]
        const b = lotPts[(best + 1) % lotPts.length]
        return p[1] + q[1] < lotPts[best][1] + b[1] ? i : best
      }, 0)
    }
    const a = lotPts[front]
    const b = lotPts[(front + 1) % lotPts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    const roadDeg = deg(Math.atan2(u[1], u[0])) // direction of the front edge
    const outward: Pt = [u[1], -u[0]] // right of a CCW edge = outside the lot
    // View rotation that puts the outward normal of the front edge pointing down the screen
    const roadBottom = norm(90 - deg(Math.atan2(-outward[1], outward[0])))

    // The county's road centerlines are often 10-20 ft off the real road, which looks wrong at
    // this scale. Instead draw a schematic road strip just outside each front edge.
    const edgeList = fronts.length ? fronts.map((r, k) => ({ edge: frontEdges[k] ?? front, road: r as Frontage | RoadHitLike })) : [{ edge: front, road: null }]
    const roadStrips = edgeList
      .filter((e) => e.edge >= 0)
      .map(({ edge, road: r }) => {
        const a = lotPts[edge]
        const b = lotPts[(edge + 1) % lotPts.length]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1])
        const ue: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
        const n: Pt = [ue[1], -ue[0]]
        const at = (p: Pt, along: number, out: number): Pt => [p[0] + ue[0] * along + n[0] * out, p[1] + ue[1] * along + n[1] * out]
        const [g0, g1] = [ROAD_GAP_FT, ROAD_GAP_FT + ROAD_WIDTH_FT]
        return {
          key: edge,
          poly: [at(a, -ROAD_EXT_FT, g0), at(b, ROAD_EXT_FT, g0), at(b, ROAD_EXT_FT, g1), at(a, -ROAD_EXT_FT, g1)],
          center: [at(a, -ROAD_EXT_FT, (g0 + g1) / 2), at(b, ROAD_EXT_FT, (g0 + g1) / 2)] as Pt[],
          labelAt: at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0, (g0 + g1) / 2),
          road: r,
        }
      })
    const toLonLat = (p: Pt) => frame.toLonLat([p[0] / FT_PER_M + cx, p[1] / FT_PER_M + cy])
    return { lotPts, envRings, roadPt, front, frontEdges, outward, roadDeg, roadBottom, roadStrips, toPlan, toLonLat }
  }, [geom, buildable, bottomRoad, fronts])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [showGrid, setShowGrid] = useState(true)
  const [photo, setPhoto] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])
  const [notesOpen, setNotesOpen] = useState(false)
  const selected = plan.shapes.find((s) => s.id === selectedId) ?? null
  const update = useCallback((id: string, patch: Partial<Shape>) => {
    setPlan((p) => ({ ...p, shapes: p.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)) }))
  }, [])
  const remove = useCallback((id: string) => {
    setPlan((p) => ({ ...p, shapes: p.shapes.filter((s) => s.id !== id) }))
    setSelectedId(null)
  }, [])

  // ---- View: rotation, zoom, pan ----
  const [rot, setRot] = useState(geo.roadBottom)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Pt>([0, 0])
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toView = useCallback(
    (p: Pt): Pt => {
      const r = rad(rot)
      const [x, y] = [p[0], -p[1]]
      return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
    },
    [rot],
  )
  const fromView = useCallback(
    (v: Pt): Pt => {
      const r = rad(-rot)
      const [x, y] = [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)]
      return [x, -y]
    },
    [rot],
  )

  // Fit the lot (and the bit of road in front of it) to the screen
  const box = useMemo(() => {
    const pts = geo.lotPts.map(toView)
    if (geo.roadPt) pts.push(toView(geo.roadPt))
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys) + 25]
    const cw = (maxX - minX) * 1.25 + 20
    const ch = (maxY - minY) * 1.25 + 20
    const s = Math.min(size.w / cw, size.h / ch) * zoom
    const w = size.w / s
    const h = size.h / s
    return { x: (minX + maxX) / 2 + pan[0] - w / 2, y: (minY + maxY) / 2 + pan[1] - h / 2, w, h, unit: 1 / s }
  }, [geo, toView, size, zoom, pan])
  const u = box.unit // feet per screen pixel

  // Aerial photo tiles for the visible area (in plan coordinates, so they rotate with the lot)
  const tiles = useMemo(() => {
    if (!photo) return []
    const corners = ([[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]] as Pt[]).map((v) => geo.toLonLat(fromView(v)))
    return aerialTiles(corners, u / FT_PER_M, geo.toPlan)
  }, [photo, box, u, geo, fromView])

  const fitView = () => {
    setZoom(1)
    setPan([0, 0])
  }
  const orient = (r: number) => {
    setRot(norm(r))
    setPan([0, 0])
  }

  // ---- Shape checks: inside the lot, inside the buildable area, distance to property line ----
  const checks = useMemo(() => {
    const out: Record<string, { status: 'ok' | 'warn' | 'out'; text: string; edgeFt: number }> = {}
    for (const s of plan.shapes) {
      if (s.type === 'pin') continue
      const pts = outline(s, geo.roadDeg)
      const inLot = pts.every((p) => pointInPolygon(p, geo.lotPts))
      const edgeFt = Math.min(...pts.map((p) => distanceToRing(p, geo.lotPts)))
      const inEnv = geo.envRings.some((r) => pts.every((p) => pointInPolygon(p, r)))
      const structure = preset(s.kind).structure
      out[s.id] = !inLot
        ? { status: 'out', text: 'Outside the lot', edgeFt }
        : structure && !inEnv
          ? { status: 'warn', text: geo.envRings.length ? 'Inside the setback area' : 'No setback data for this zone', edgeFt }
          : { status: 'ok', text: structure ? 'Within the buildable area' : 'Not a building, so setbacks may not apply', edgeFt }
    }
    return out
  }, [plan.shapes, geo])

  const footprint = plan.shapes.reduce((sum, s) => {
    if (s.type === 'pin' || !preset(s.kind).structure) return sum
    return sum + (s.type === 'rect' ? s.w * s.h : (Math.PI * s.d * s.d) / 4)
  }, 0)
  const lotSqft = buildable ? buildable.lotM2 * 10.7639 : lot.acres * 43560

  // ---- Adding shapes ----
  const addShape = (kind: ShapeKind) => {
    const p = preset(kind)
    const env = geo.envRings[0]
    const base: Pt = env ? [env.reduce((s, q) => s + q[0], 0) / env.length, env.reduce((s, q) => s + q[1], 0) / env.length] : [0, 0]
    // Nudge each new shape a little so they don't stack exactly
    const n = plan.shapes.length % 6
    const pos: Pt = [base[0] + n * 18, base[1] - n * 18]
    const shape: Shape =
      p.type === 'circle'
        ? { id: newId(), type: 'circle', kind, label: p.label, x: pos[0], y: pos[1], d: p.d! }
        : { id: newId(), type: 'rect', kind, label: p.label, x: pos[0], y: pos[1], w: p.w!, h: p.h!, rot: 0 }
    setPlan((pl) => ({ ...pl, shapes: [...pl.shapes, shape] }))
    setSelectedId(shape.id)
    setTool('select')
  }

  // ---- Pointer interaction: drag shapes, pan the canvas, drop pins ----
  const drag = useRef<{ mode: 'pan' | 'move'; id?: string; client: Pt; startPan: Pt; startPos: Pt; startPlan: Pt } | null>(null)
  const clientToPlan = (cx: number, cy: number): Pt => {
    const svg = svgRef.current!
    const ctm = svg.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse())
    return fromView([p.x, p.y])
  }
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (tool === 'pin') {
      const [x, y] = clientToPlan(e.clientX, e.clientY)
      const pin: Shape = { id: newId(), type: 'pin', x, y, note: '' }
      setPlan((pl) => ({ ...pl, shapes: [...pl.shapes, pin] }))
      setSelectedId(pin.id)
      setTool('select')
      return
    }
    setSelectedId(null)
    drag.current = { mode: 'pan', client: [e.clientX, e.clientY], startPan: pan, startPos: [0, 0], startPlan: [0, 0] }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onShapeDown = (e: React.PointerEvent, s: Shape) => {
    e.stopPropagation()
    setSelectedId(s.id)
    drag.current = { mode: 'move', id: s.id, client: [e.clientX, e.clientY], startPan: pan, startPos: [s.x, s.y], startPlan: clientToPlan(e.clientX, e.clientY) }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') {
      setPan([d.startPan[0] - (e.clientX - d.client[0]) * u, d.startPan[1] - (e.clientY - d.client[1]) * u])
    } else if (d.id) {
      const p = clientToPlan(e.clientX, e.clientY)
      update(d.id, { x: d.startPos[0] + p[0] - d.startPlan[0], y: d.startPos[1] + p[1] - d.startPlan[1] })
    }
  }
  const onUp = () => (drag.current = null)

  // Mouse-wheel zoom (needs a non-passive listener to stop the page from scrolling)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.min(20, Math.max(0.3, z * Math.pow(1.0015, -e.deltaY))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keyboard: Esc deselects / closes, Delete removes the selected shape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea')
      if (e.key === 'Escape') {
        if (typing) (e.target as HTMLElement).blur()
        else if (selectedId) setSelectedId(null)
        else onClose()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        remove(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, onClose, remove])

  // ---- Download an image of the plan / share a link to it ----
  const describe = (s: Shape) => {
    if (s.type === 'pin') return ''
    const dims = s.type === 'rect' ? `${fmt(s.w)} × ${fmt(s.h)} ft` : `${fmt(s.d)} ft across`
    const c = checks[s.id]
    return `${s.label}: ${dims}${c && c.status !== 'ok' ? ` (⚠ ${c.text.toLowerCase()})` : ''}`
  }
  const download = async () => {
    if (!svgRef.current) return
    setBusy(true)
    try {
      const pinsList = plan.shapes.filter((s) => s.type === 'pin')
      await exportPlanPng({
        svg: svgRef.current,
        rotDeg: rot,
        ftPerPx: u,
        title: `Lot plan · TMK ${lot.tmk}`,
        subtitle: `${lot.acres} acres${lot.zone ? ` · zoned ${lot.zone}` : ''}${road?.name ? ` · on ${road.name}` : ''} · ${new Date().toLocaleDateString()}`,
        sections: [
          {
            heading: 'Setbacks',
            lines: buildable
              ? [
                  `${buildable.setback.front_rear_ft} ft front & rear, ${buildable.setback.side_ft} ft sides${buildable.setback.confirmed ? '' : ' (from the 2019 county brochure; confirm with Planning)'}`,
                  `Buildable area about ${fmt(buildable.envelopeM2 * 10.7639)} sq ft (purple outline)`,
                ]
              : ['No setback data for this zone'],
          },
          { heading: 'Planned', lines: plan.shapes.filter((s) => s.type !== 'pin').map(describe) },
          { heading: 'Notes on the map', lines: pinsList.map((p, i) => `${i + 1}. ${p.type === 'pin' ? p.note || '(empty)' : ''}`) },
          { heading: 'Lot notes', lines: plan.notes.trim() ? [plan.notes.trim()] : [] },
        ],
        footer: [
          'Sketch for planning only, not a site plan or survey. Parcel lines are approximate. Confirm setbacks with Hawaiʻi County Planning.',
          ...(photo ? [AERIAL_ATTRIBUTION] : []),
        ],
        filename: `lot-${lot.tmk}-plan.${photo ? 'jpg' : 'png'}`,
        jpeg: photo,
      })
      setToast('Image downloaded')
    } catch {
      setToast('Couldn’t create the image. Try turning off the aerial photo.')
    } finally {
      setBusy(false)
    }
  }
  const share = async () => {
    const how = await shareUrl(lotLink(lot.tmk, plan), `Lot plan · TMK ${lot.tmk}`)
    setToast(how === 'copied' ? 'Link copied. Anyone with it can see this plan.' : how === 'shared' ? 'Shared' : 'Couldn’t copy the link')
  }
  const keepShared = () => {
    setShared(false) // the save effect now stores it
    setToast('Saved on this device')
  }
  const useMine = () => {
    setPlan(loadPlan(lot.tmk))
    setShared(false)
    setSelectedId(null)
  }

  // ---- Rendering helpers ----
  const path = (pts: Pt[], close = true) => pts.map((p, i) => `${i ? 'L' : 'M'}${toView(p).join(' ')}`).join(' ') + (close ? ' Z' : '')
  const fs = (px: number) => px * u
  const scaleFt = [5, 10, 20, 50, 100, 200, 500].find((f) => f / u >= 70) ?? 500
  const roadInfo = road ? roadText(road.owner, road.maint) : null
  const pins = plan.shapes.filter((s) => s.type === 'pin')

  const grid = useMemo(() => {
    if (!showGrid) return null
    // 10 ft lines once they're at least 10 px apart; otherwise only the 50 ft lines
    const step = 10 / u >= 10 ? 10 : 50
    if (step / u < 8) return null
    const lines: React.ReactNode[] = []
    const x0 = Math.floor(box.x / step) * step
    const y0 = Math.floor(box.y / step) * step
    for (let x = x0; x < box.x + box.w; x += step) lines.push(<line key={`x${x}`} x1={x} y1={box.y} x2={x} y2={box.y + box.h} className={x % 50 === 0 ? 'grid major' : 'grid'} />)
    for (let y = y0; y < box.y + box.h; y += step) lines.push(<line key={`y${y}`} x1={box.x} y1={y} x2={box.x + box.w} y2={y} className={y % 50 === 0 ? 'grid major' : 'grid'} />)
    return lines
  }, [showGrid, u, box])

  return (
    <div className="sandbox" role="dialog" aria-label={`Plan for lot TMK ${lot.tmk}`}>
      <header className="sb-head">
        <button className="ctrl-btn" onClick={onClose}>
          ← Map
        </button>
        <div className="sb-title">
          <strong>Plan this lot</strong>
          <span className="muted">
            TMK {lot.tmk} · {lot.acres} acres{lot.zone ? ` · ${lot.zone}` : ''}
          </span>
        </div>
      </header>

      <div className="sb-body">
        <svg
          ref={svgRef}
          className={`sb-canvas${tool === 'pin' ? ' placing' : ''}${photo ? ' photo' : ''}`}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {photo && (
            <g transform={`rotate(${rot}) scale(1,-1)`} className="sb-aerial">
              {tiles.map((t) => (
                // Tiles are north-up rectangles in plan space; the inner flip keeps the photo upright
                <image
                  key={t.key}
                  href={t.href}
                  crossOrigin="anonymous"
                  x={t.nw[0]}
                  y={-t.nw[1]}
                  width={t.se[0] - t.nw[0] + u * 0.6}
                  height={t.nw[1] - t.se[1] + u * 0.6}
                  transform="scale(1,-1)"
                  preserveAspectRatio="none"
                />
              ))}
            </g>
          )}
          {grid}

          {geo.roadStrips.map((r) => (
            <g key={r.key}>
              <path d={path(r.poly)} className="sb-road" />
              <path d={path(r.center, false)} className="sb-road-center" style={{ stroke: ROAD_COLOR[r.road?.maint ?? ''] ?? '#8a9099' }} vectorEffect="non-scaling-stroke" />
            </g>
          ))}

          <path d={path(geo.lotPts)} className="sb-lot" vectorEffect="non-scaling-stroke" />
          {(geo.frontEdges.length ? geo.frontEdges : [geo.front]).map((i) => (
            <path key={i} d={`M${toView(geo.lotPts[i]).join(' ')} L${toView(geo.lotPts[(i + 1) % geo.lotPts.length]).join(' ')}`} className="sb-front" vectorEffect="non-scaling-stroke" />
          ))}
          {geo.envRings.map((r, i) => (
            <path key={i} d={path(r)} className="sb-env" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Edge lengths */}
          {geo.lotPts.map((a, i) => {
            const b = geo.lotPts[(i + 1) % geo.lotPts.length]
            const len = Math.hypot(b[0] - a[0], b[1] - a[1])
            if (len < 12 || len / u < 50) return null
            const mid = toView([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
            const out = toView([(b[1] - a[1]) / len, -(b[0] - a[0]) / len])
            const off = i === geo.front ? -fs(14) : fs(14) // front edge label sits inside, clear of the road
            return (
              <text key={i} x={mid[0] + out[0] * off} y={mid[1] + out[1] * off} className="sb-dim" style={{ fontSize: fs(12) }}>
                {fmt(len)} ft
              </text>
            )
          })}

          {geo.roadStrips.map((r) => {
            // Road name sits inside its strip, centered on the lot's front edge
            const p = toView(r.labelAt)
            return (
              <text key={r.key} x={p[0]} y={p[1] + fs(4)} className="sb-road-label" style={{ fontSize: fs(11) }}>
                {r.road ? `${r.road.name ?? 'Road'} · ${roadText(r.road.owner, r.road.maint).label}` : 'Road (location approximate)'}
              </text>
            )
          })}

          {/* Planning shapes */}
          {plan.shapes.map((s) => {
            if (s.type === 'pin') return null
            const p = preset(s.kind)
            const c = checks[s.id]
            const sel = s.id === selectedId
            const center = toView([s.x, s.y])
            const dims = s.type === 'rect' ? `${fmt(s.w)}×${fmt(s.h)} ft` : `Ø ${fmt(s.d)} ft`
            return (
              <g key={s.id} className={`sb-shape ${c?.status ?? ''}${sel ? ' sel' : ''}`} onPointerDown={(e) => onShapeDown(e, s)}>
                <path d={path(outline(s, geo.roadDeg))} style={{ fill: p.color, stroke: p.color }} vectorEffect="non-scaling-stroke" />
                <text x={center[0]} y={center[1]} className="sb-shape-label" style={{ fontSize: fs(11) }}>
                  {c?.status !== 'ok' ? '⚠ ' : ''}
                  {s.label}
                </text>
                <text x={center[0]} y={center[1] + fs(13)} className="sb-shape-dims" style={{ fontSize: fs(10) }}>
                  {dims}
                </text>
              </g>
            )
          })}
          {pins.map((s, i) => {
            const [x, y] = toView([s.x, s.y])
            return (
              <g key={s.id} className={`sb-pin${s.id === selectedId ? ' sel' : ''}`} onPointerDown={(e) => onShapeDown(e, s)}>
                <circle cx={x} cy={y} r={fs(11)} vectorEffect="non-scaling-stroke" />
                <text x={x} y={y + fs(4)} style={{ fontSize: fs(11) }}>
                  {i + 1}
                </text>
              </g>
            )
          })}
        </svg>

        {/* On-canvas overlays */}
        <div className="sb-compass" title="North" aria-label={`North is ${Math.round(norm(-rot))}° from up`}>
          <span style={{ transform: `rotate(${rot}deg)` }}>
            <svg viewBox="-12 -16 24 32" width="24" height="32" aria-hidden="true">
              <path d="M0 -14 L7 6 L0 2 L-7 6 Z" />
            </svg>
            <b>N</b>
          </span>
        </div>
        <div className="sb-scale" aria-hidden="true">
          <span style={{ width: scaleFt / u }} />
          {scaleFt} ft
        </div>
        <div className="sb-viewctl">
          <button onClick={() => setZoom((z) => Math.min(20, z * 1.4))} aria-label="Zoom in">+</button>
          <button onClick={() => setZoom((z) => Math.max(0.3, z / 1.4))} aria-label="Zoom out">−</button>
          <button onClick={fitView} aria-label="Fit lot to screen">⤢</button>
        </div>

        {photo && <div className="sb-attrib">{AERIAL_ATTRIBUTION}</div>}
        {shared && (
          <div className="sb-banner card" role="status">
            <strong>You’re viewing a shared plan.</strong> Changes aren’t saved until you keep it.
            <span className="sb-banner-actions">
              <button className="sb-tool" onClick={keepShared}>
                Keep a copy
              </button>
              <button className="sb-tool" onClick={useMine}>
                Use my own plan
              </button>
            </span>
          </div>
        )}
        {toast && (
          <div className="sb-toast" role="status">
            {toast}
          </div>
        )}

        {/* Tools */}
        <div className="sb-tools card" role="toolbar" aria-label="Planning tools">
          <div className="sb-group">
            <span className="sb-group-label">Add</span>
            {PRESETS.map((p) => (
              <button key={p.kind} className="sb-tool" onClick={() => addShape(p.kind)}>
                <i style={{ background: p.color, borderRadius: p.type === 'circle' ? '50%' : 3 }} aria-hidden="true" />
                {p.label}
              </button>
            ))}
            <button className={`sb-tool${tool === 'pin' ? ' active' : ''}`} aria-pressed={tool === 'pin'} onClick={() => setTool(tool === 'pin' ? 'select' : 'pin')}>
              <i className="pin-icon" aria-hidden="true">📍</i>
              {tool === 'pin' ? 'Tap the lot…' : 'Note pin'}
            </button>
          </div>
          <div className="sb-group">
            <span className="sb-group-label">View</span>
            <button className={`sb-tool${Math.abs(norm(rot - geo.roadBottom)) < 0.5 ? ' active' : ''}`} onClick={() => orient(geo.roadBottom)}>
              Road at bottom
            </button>
            <button className={`sb-tool${Math.abs(norm(rot)) < 0.5 ? ' active' : ''}`} onClick={() => orient(0)}>
              North up
            </button>
            <button className="sb-tool" onClick={() => setRot((r) => norm(r - 15))} aria-label="Rotate left 15 degrees">⟲ 15°</button>
            <button className="sb-tool" onClick={() => setRot((r) => norm(r + 15))} aria-label="Rotate right 15 degrees">⟳ 15°</button>
            <button className={`sb-tool${photo ? ' active' : ''}`} aria-pressed={photo} onClick={() => setPhoto((p) => !p)}>
              Aerial photo
            </button>
            <button className={`sb-tool${showGrid ? ' active' : ''}`} aria-pressed={showGrid} onClick={() => setShowGrid((g) => !g)}>
              10 ft grid
            </button>
          </div>
          <div className="sb-group">
            <span className="sb-group-label">Share</span>
            <button className="sb-tool" onClick={download} disabled={busy}>
              {busy ? 'Creating image…' : '⬇ Download image'}
            </button>
            <button className="sb-tool" onClick={share}>
              🔗 Share link
            </button>
          </div>
        </div>

        {/* Side panel: selection inspector, summary, notes */}
        <aside className="sb-side card">
          {selected && selected.type !== 'pin' && (
            <section className="sb-inspect">
              <div className="sb-inspect-head">
                <input aria-label="Shape name" value={selected.label} onChange={(e) => update(selected.id, { label: e.target.value })} />
                <button className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Done editing">✓</button>
              </div>
              {selected.type === 'rect' ? (
                <div className="sb-fields">
                  <label>
                    Width (along road)
                    <NumberField value={selected.w} min={1} onChange={(w) => update(selected.id, { w })} suffix="ft" />
                  </label>
                  <label>
                    Depth
                    <NumberField value={selected.h} min={1} onChange={(h) => update(selected.id, { h })} suffix="ft" />
                  </label>
                  <label className="wide">
                    Turn {Math.round(selected.rot)}° from road
                    <input type="range" min={-90} max={90} step={5} value={selected.rot} onChange={(e) => update(selected.id, { rot: +e.target.value })} />
                  </label>
                </div>
              ) : (
                <div className="sb-fields">
                  <label>
                    Diameter
                    <NumberField value={selected.d} min={1} onChange={(d) => update(selected.id, { d })} suffix="ft" />
                  </label>
                </div>
              )}
              {checks[selected.id] && (
                <p className={`sb-check ${checks[selected.id].status}`}>
                  {checks[selected.id].status === 'ok' ? '✓' : '⚠'} {checks[selected.id].text}
                  {checks[selected.id].status !== 'out' && <span className="block muted">{fmt(checks[selected.id].edgeFt)} ft to the nearest property line</span>}
                </p>
              )}
              <div className="sb-actions">
                <button
                  className="sb-tool"
                  onClick={() => {
                    const copy = { ...selected, id: newId(), x: selected.x + 8, y: selected.y - 8 }
                    setPlan((p) => ({ ...p, shapes: [...p.shapes, copy] }))
                    setSelectedId(copy.id)
                  }}
                >
                  Duplicate
                </button>
                <button className="sb-tool danger" onClick={() => remove(selected.id)}>
                  Delete
                </button>
              </div>
            </section>
          )}

          {selected && selected.type === 'pin' && (
            <section className="sb-inspect">
              <div className="sb-inspect-head">
                <strong>Note {pins.findIndex((p) => p.id === selected.id) + 1}</strong>
                <button className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Done editing">✓</button>
              </div>
              <textarea autoFocus rows={3} placeholder="e.g. Big ʻōhiʻa tree here, keep it" value={selected.note} onChange={(e) => update(selected.id, { note: e.target.value })} />
              <div className="sb-actions">
                <button className="sb-tool danger" onClick={() => remove(selected.id)}>
                  Delete note
                </button>
              </div>
            </section>
          )}

          {!selected && (
            <section>
              <h3>This lot</h3>
              <dl className="sb-summary">
                <dt>Road</dt>
                <dd>{road ? `${road.name ?? 'Unnamed'} · ${roadInfo?.label}` : 'No road found nearby'}</dd>
                {roadsFronting.length > 1 && (
                  <>
                    <dt>Corner lot</dt>
                    <dd>
                      <span className="block">Front setback on:</span>
                      <span className="sb-choice" role="radiogroup" aria-label="Which road is the front">
                        {roadsFronting.map((r, i) => (
                          <button
                            key={i}
                            role="radio"
                            aria-checked={frontChoice === i}
                            className={`sb-tool${frontChoice === i ? ' active' : ''}`}
                            onClick={() => setPlan((p) => ({ ...p, front: i }))}
                          >
                            {r.name ?? `Road ${i + 1}`}
                          </button>
                        ))}
                        <button
                          role="radio"
                          aria-checked={frontChoice === 'all'}
                          className={`sb-tool${frontChoice === 'all' ? ' active' : ''}`}
                          onClick={() => setPlan((p) => ({ ...p, front: 'all' }))}
                        >
                          Both (most cautious)
                        </button>
                      </span>
                      <span className="block muted">Ask Planning which side counts as the front on this corner lot.</span>
                    </dd>
                  </>
                )}
                {buildable && (
                  <>
                    <dt>Setbacks</dt>
                    <dd>
                      {buildable.setback.front_rear_ft} ft front & rear · {buildable.setback.side_ft} ft sides
                      {!buildable.setback.confirmed && <span className="block muted">From the county’s 2019 brochure. Confirm with Planning.</span>}
                    </dd>
                    <dt>Buildable</dt>
                    <dd>About {fmt(buildable.envelopeM2 * 10.7639)} sq ft (purple outline)</dd>
                  </>
                )}
                <dt>Planned</dt>
                <dd>
                  {footprint ? `${fmt(footprint)} sq ft of buildings (${((footprint / lotSqft) * 100).toFixed(1)}% of the lot)` : 'Nothing yet. Add a shape.'}
                </dd>
              </dl>
              <p className="note">The front (thick line) is the edge facing the road. Drag shapes to move them; tap one to edit it.</p>
            </section>
          )}

          <section>
            <button className="sb-notes-toggle" aria-expanded={notesOpen || !!plan.notes} onClick={() => setNotesOpen((o) => !o)}>
              Lot notes {pins.length ? `· ${pins.length} pin${pins.length > 1 ? 's' : ''}` : ''}
            </button>
            {(notesOpen || plan.notes) && (
              <textarea rows={4} placeholder="Questions for the seller, things to check on a site visit…" value={plan.notes} onChange={(e) => setPlan((p) => ({ ...p, notes: e.target.value }))} />
            )}
            {pins.length > 0 && (
              <ol className="sb-pin-list">
                {pins.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setSelectedId(p.id)}>{p.note || <em className="muted">(empty note)</em>}</button>
                  </li>
                ))}
              </ol>
            )}
            <p className="note">Saved on this device only. Shapes are sketches, not a site plan.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

// Number input that lets you clear the field while typing without snapping back
function NumberField({ value, min, onChange, suffix }: { value: number; min: number; onChange: (n: number) => void; suffix: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <span className="numfield">
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n) && n >= min) onChange(n)
        }}
      />
      {suffix}
    </span>
  )
}
