// Planning shapes, presets and per-lot persistence for the lot sandbox.
import type { Pt } from '../geo'

export type ShapeKind = 'home' | 'ohana' | 'shed' | 'tank' | 'septic' | 'garden' | 'parking' | 'custom'

export interface RectShape {
  id: string
  type: 'rect'
  kind: ShapeKind
  label: string
  x: number // center, plan feet (x east, y north, origin = lot center)
  y: number
  w: number // along the road, ft
  h: number // depth, ft
  rot: number // degrees, relative to the road edge
}

export interface CircleShape {
  id: string
  type: 'circle'
  kind: ShapeKind
  label: string
  x: number
  y: number
  d: number // diameter, ft
}

export interface PinShape {
  id: string
  type: 'pin'
  x: number
  y: number
  note: string
}

export type Shape = RectShape | CircleShape | PinShape

export interface Plan {
  v: 1
  shapes: Shape[]
  notes: string
  front?: 'all' | number // corner lots: which road(s) get the front setback (0 = main road)
}

// Starting sizes are placeholders for sketching, not requirements; the user edits them.
export const PRESETS: { kind: ShapeKind; label: string; type: 'rect' | 'circle'; w?: number; h?: number; d?: number; structure: boolean; color: string }[] = [
  { kind: 'home', label: 'Home', type: 'rect', w: 40, h: 30, structure: true, color: '#3b6fd8' },
  { kind: 'ohana', label: 'Ohana', type: 'rect', w: 24, h: 20, structure: true, color: '#7b5cd6' },
  { kind: 'shed', label: 'Shed', type: 'rect', w: 12, h: 10, structure: true, color: '#8d6e63' },
  { kind: 'tank', label: 'Water tank', type: 'circle', d: 12, structure: true, color: '#1e88b5' },
  { kind: 'septic', label: 'Septic area', type: 'rect', w: 30, h: 20, structure: false, color: '#9e9d24' },
  { kind: 'garden', label: 'Garden', type: 'rect', w: 20, h: 20, structure: false, color: '#2e9e5b' },
  { kind: 'parking', label: 'Parking', type: 'rect', w: 20, h: 20, structure: false, color: '#78909c' },
  { kind: 'custom', label: 'Custom', type: 'rect', w: 10, h: 10, structure: true, color: '#e08a1e' },
]

export const preset = (kind: ShapeKind) => PRESETS.find((p) => p.kind === kind)!

let counter = 0
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`

const key = (tmk: string) => `aview:plan:${tmk}`

export function loadPlan(tmk: string): Plan {
  try {
    const raw = localStorage.getItem(key(tmk))
    const p = raw ? (JSON.parse(raw) as Plan) : null
    if (p?.v === 1 && Array.isArray(p.shapes)) return p
  } catch {
    // storage blocked or corrupt: start fresh
  }
  return { v: 1, shapes: [], notes: '' }
}

export function savePlan(tmk: string, plan: Plan) {
  try {
    if (!plan.shapes.length && !plan.notes.trim()) localStorage.removeItem(key(tmk))
    else localStorage.setItem(key(tmk), JSON.stringify(plan))
  } catch {
    // storage unavailable (private mode): plan just won't persist
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Outline points of a shape in plan feet. roadDeg = direction of the road edge in plan coords. */
export function outline(s: RectShape | CircleShape, roadDeg: number): Pt[] {
  if (s.type === 'circle') {
    return Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * 2 * Math.PI
      return [s.x + (s.d / 2) * Math.cos(a), s.y + (s.d / 2) * Math.sin(a)] as Pt
    })
  }
  const a = rad(roadDeg + s.rot)
  const [c, sn] = [Math.cos(a), Math.sin(a)]
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => {
    const dx = (i * s.w) / 2
    const dy = (j * s.h) / 2
    return [s.x + dx * c - dy * sn, s.y + dx * sn + dy * c] as Pt
  })
}
