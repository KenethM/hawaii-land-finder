import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import { estimateBuildable } from './buildable'
import { nearestRoad, type Frontage } from './frontage'
import LotPanel from './LotPanel'
import { setbackFor, STATUS, type Lot, type Rules, type Status } from './lot'
import type { Plan } from './sandbox/plan'
import Sandbox from './sandbox/Sandbox'
import { clearLink, readLink } from './share'

// Data files live next to the page; absolute URLs so MapLibre's worker resolves them (works under /repo-name/ on GitHub Pages)
const dataUrl = (file: string) => new URL(`${import.meta.env.BASE_URL}${file}`, location.href).href

const CENTER: [number, number] = [-155.085, 19.53] // Mountain View / Hawaiian Acres
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

type LayerKey = 'satellite' | 'lava' | 'rainfall' | 'zoning' | 'roads' | 'road_maint'
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'satellite', label: 'Satellite' },
  { key: 'lava', label: 'Lava zones' },
  { key: 'rainfall', label: 'Rainfall' },
  { key: 'zoning', label: 'Zoning' },
  { key: 'road_maint', label: 'Who maintains roads' },
  { key: 'roads', label: 'Road names' },
]

// County road inventory: maintainer -> short label + color (paired with dash patterns so color isn't the only cue)
const ROAD_MAINT_LABEL = ['match', ['get', 'MAINTAINER'],
  'County', 'County road', 'County - Grant of Easement', 'County road', 'State', 'State hwy',
  'Private', 'Private road', 'County Unimproved - Not Maintained', 'Not maintained', 'Road in limbo']
const ROAD_MAINT_COLOR = ['match', ['get', 'MAINTAINER'],
  ['County', 'County - Grant of Easement'], '#1b9e77', 'State', '#5b6abf', 'Private', '#d95f02', '#c2185b']
// Map-layer ids controlled by each toggle
const LAYER_IDS: Record<LayerKey, string[]> = {
  satellite: ['satellite'],
  lava: ['lava-fill', 'lava-label'],
  rainfall: ['rain-line', 'rain-label'],
  zoning: ['zoning-line', 'zoning-label'],
  roads: ['roads-label'],
  road_maint: ['road-maint-solid', 'road-maint-dashed', 'road-maint-label'],
}

const statusColor = ['match', ['get', 'status'], ...Object.entries(STATUS).flatMap(([k, v]) => [k, v.color]), STATUS.unknown.color]

function useDark() {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

// Index of full (unclipped) parcel features by id, built once from the loaded GeoJSON source
let parcelIndex: Map<number, Feature> | null = null
async function fullParcel(map: MLMap, id: number) {
  if (!parcelIndex) {
    const data = (await (map.getSource('parcels') as GeoJSONSource).getData()) as FeatureCollection
    parcelIndex = new Map(data.features.map((f) => [f.id as number, f]))
  }
  return parcelIndex.get(id)
}

// Corner lots: by default every road the lot fronts gets a front setback (most cautious)
const frontPoints = (road: Frontage | null) => (road ? [road.point, ...road.alsoFronts.map((r) => r.point)] : [])

async function parcelIdByTmk(map: MLMap, tmk: string) {
  await fullParcel(map, -1) // builds the index
  for (const [id, f] of parcelIndex!) if (f.properties?.tmk === tmk) return id
  return null
}

// Road lines (county maintenance inventory + state road centerlines), loaded once
let roadData: { county: Feature[]; other: Feature[] } | null = null
async function loadRoads(map: MLMap) {
  if (!roadData) {
    const get = async (id: string) => ((await (map.getSource(id) as GeoJSONSource).getData()) as FeatureCollection).features
    const [county, other] = await Promise.all([get('road_maint'), get('roads')])
    roadData = { county, other }
  }
  return roadData
}

function addOverlays(map: MLMap, dark: boolean, visible: Record<LayerKey, boolean>) {
  const text = dark ? '#e8ecef' : '#1d2329'
  const halo = dark ? '#111417' : '#ffffff'
  const vis = (k: LayerKey) => (visible[k] ? 'visible' : 'none') as 'visible' | 'none'
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id

  map.addSource('satellite', {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  })
  map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: vis('satellite') } }, firstSymbol)

  for (const name of ['parcels', 'lava', 'rainfall', 'zoning', 'roads', 'road_maint']) {
    map.addSource(name, { type: 'geojson', data: dataUrl(`${name}.geojson`) })
  }
  map.addSource('envelope', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  map.addLayer({
    id: 'lava-fill', type: 'fill', source: 'lava', layout: { visibility: vis('lava') },
    paint: { 'fill-color': ['match', ['get', 'hzone'], '1', '#b2182b', '2', '#d6604d', '3', '#f4a582', '#fddbc7'], 'fill-opacity': 0.25 },
  })
  map.addLayer({
    id: 'parcels-fill', type: 'fill', source: 'parcels',
    paint: {
      'fill-color': statusColor as never,
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.55, ['match', ['get', 'status'], ['for_sale', 'pending'], 0.5, 'developed', 0.28, 0.12]],
    },
  })
  map.addLayer({
    id: 'parcels-line', type: 'line', source: 'parcels',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], text, statusColor as never],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['match', ['get', 'status'], ['for_sale', 'pending'], 2.5, 0.6]],
      'line-opacity': 0.9,
    },
  })
  // Pending lots get a dashed outline so status isn't conveyed by color alone
  map.addLayer({
    id: 'parcels-pending', type: 'line', source: 'parcels', filter: ['==', ['get', 'status'], 'pending'],
    paint: { 'line-color': text, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  })
  map.addLayer({
    id: 'parcels-icon', type: 'symbol', source: 'parcels', minzoom: 14,
    filter: ['in', ['get', 'status'], ['literal', ['for_sale', 'pending']]],
    layout: { 'text-field': ['match', ['get', 'status'], 'for_sale', 'FOR SALE', 'PENDING'], 'text-size': 10, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'envelope', type: 'line', source: 'envelope',
    paint: { 'line-color': '#7b3fe4', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] },
  })
  // County/State roads drawn solid; private and unresolved roads dashed
  const publicRoad = ['in', ['get', 'MAINTAINER'], ['literal', ['County', 'County - Grant of Easement', 'State']]]
  map.addLayer({
    id: 'road-maint-solid', type: 'line', source: 'road_maint', filter: publicRoad as never, layout: { visibility: vis('road_maint'), 'line-cap': 'round' },
    paint: { 'line-color': ROAD_MAINT_COLOR as never, 'line-width': 4, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'road-maint-dashed', type: 'line', source: 'road_maint', filter: ['!', publicRoad] as never, layout: { visibility: vis('road_maint') },
    paint: { 'line-color': ROAD_MAINT_COLOR as never, 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] },
  })
  map.addLayer({
    id: 'road-maint-label', type: 'symbol', source: 'road_maint', minzoom: 13.5, layout: {
      visibility: vis('road_maint'), 'symbol-placement': 'line', 'text-field': ROAD_MAINT_LABEL as never,
      'text-size': 11, 'text-font': ['Noto Sans Bold'], 'symbol-spacing': 350,
    },
    paint: { 'text-color': ROAD_MAINT_COLOR as never, 'text-halo-color': halo, 'text-halo-width': 2 },
  })
  map.addLayer({
    id: 'rain-line', type: 'line', source: 'rainfall', layout: { visibility: vis('rainfall') },
    paint: { 'line-color': '#2b8cbe', 'line-width': 2, 'line-opacity': 0.8 },
  })
  map.addLayer({
    id: 'rain-label', type: 'symbol', source: 'rainfall', layout: {
      visibility: vis('rainfall'), 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'contour']], ' in/yr rain'],
      'text-size': 12, 'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': '#2b8cbe', 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'zoning-line', type: 'line', source: 'zoning', layout: { visibility: vis('zoning') },
    paint: { 'line-color': '#8c6bb1', 'line-width': 1.5 },
  })
  map.addLayer({
    id: 'zoning-label', type: 'symbol', source: 'zoning', minzoom: 13, layout: {
      visibility: vis('zoning'), 'text-field': ['get', 'zone'], 'text-size': 11, 'text-font': ['Noto Sans Bold'],
    },
    paint: { 'text-color': '#8c6bb1', 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'lava-label', type: 'symbol', source: 'lava', layout: {
      visibility: vis('lava'), 'text-field': ['concat', 'Lava zone ', ['get', 'hzone']], 'text-size': 13, 'text-font': ['Noto Sans Bold'],
    },
    paint: { 'text-color': '#b2182b', 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'roads-label', type: 'symbol', source: 'roads', minzoom: 14, layout: {
      visibility: vis('roads'), 'symbol-placement': 'line', 'text-field': ['get', 'fullname'], 'text-size': 11, 'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  })
}

export default function App() {
  const dark = useDark()
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const selectedId = useRef<number | null>(null)
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({ satellite: false, lava: false, rainfall: false, zoning: false, roads: true, road_maint: false })
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const [selected, setSelected] = useState<{ lot: Lot; geom: Feature<Polygon | MultiPolygon>; road: Frontage | null } | null>(null)
  const [sandbox, setSandbox] = useState(false)
  const [sharedPlan, setSharedPlan] = useState<Plan | null>(null)
  const linkHandled = useRef(false)
  const [rules, setRules] = useState<Rules | null>(null)
  const [checkedOn, setCheckedOn] = useState('')
  const [layersOpen, setLayersOpen] = useState(false)

  useEffect(() => {
    fetch(dataUrl('zoning-rules.json')).then((r) => r.json()).then((d: Rules) => setRules(d)).catch(() => {})
    fetch(dataUrl('manifest.json')).then((r) => r.json()).then((d) => setCheckedOn(d.parcels?.fetched ?? '')).catch(() => {})
  }, [])

  // Create the map once; swap basemap style when the color scheme changes
  const appliedDark = useRef(dark)
  useEffect(() => {
    document.documentElement.dataset.dark = dark ? '1' : '0'
    appliedDark.current = dark
    const map = new maplibregl.Map({ container: mapEl.current!, style: dark ? STYLES.dark : STYLES.light, center: CENTER, zoom: 13.5, attributionControl: { compact: true } })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map // for automated browser checks
    // Compass shows rotation/tilt (right-click drag or two-finger gestures); clicking it resets to north-up, top-down
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left')
    // Select a lot by id. `plan` opens it straight into the sandbox (share links).
    const selectLot = (id: number, center?: [number, number], plan?: Plan | null) => {
      if (selectedId.current != null) map.setFeatureState({ source: 'parcels', id: selectedId.current }, { selected: false })
      selectedId.current = id
      map.setFeatureState({ source: 'parcels', id }, { selected: true })
      setSandbox(false)
      setSharedPlan(null)
      // Rendered features are clipped to the map tile that was tapped, so a lot crossing a tile edge
      // comes back partial. Look up the full original lot shape by id instead.
      Promise.all([fullParcel(map, id), loadRoads(map)]).then(([full, roads]) => {
        if (!full || selectedId.current !== id) return
        const geom: Feature<Polygon | MultiPolygon> = { type: 'Feature', properties: {}, geometry: full.geometry as Polygon | MultiPolygon }
        // The road the lot faces decides which edge is the "front" for setbacks
        setSelected({ lot: full.properties as unknown as Lot, geom, road: nearestRoad(geom, roads.county, roads.other) })
        if (plan !== undefined) {
          setSharedPlan(plan)
          setSandbox(true)
        }
      })
      // On phones the report is a bottom sheet; keep the tapped lot visible above it
      if (center && window.innerWidth <= 640) map.easeTo({ center, padding: { top: 0, bottom: window.innerHeight * 0.62, left: 0, right: 0 } })
    }

    // Share links: #lot=<TMK> opens that lot; with &plan=… it opens straight into its plan
    const openLink = async () => {
      if (linkHandled.current) return
      linkHandled.current = true
      const link = readLink()
      if (!link) return
      clearLink()
      const id = await parcelIdByTmk(map, link.tmk)
      if (id == null) return
      const g = parcelIndex!.get(id)!.geometry as Polygon | MultiPolygon
      const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
      const center: [number, number] = [ring.reduce((a, c) => a + c[0], 0) / ring.length, ring.reduce((a, c) => a + c[1], 0) / ring.length]
      map.jumpTo({ center, zoom: 16.5 })
      selectLot(id, center, link.plan ?? undefined)
    }

    map.on('style.load', () => {
      addOverlays(map, document.documentElement.dataset.dark === '1', visibleRef.current)
      selectedId.current = null
      setSelected(null)
      setSandbox(false)
      map.once('idle', openLink)
    })
    map.on('click', 'parcels-fill', (e) => {
      const f = e.features?.[0]
      if (!f || f.id == null) return
      selectLot(f.id as number, [e.lngLat.lng, e.lngLat.lat])
    })
    map.on('mouseenter', 'parcels-fill', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'parcels-fill', () => (map.getCanvas().style.cursor = ''))
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only swap the basemap when the theme actually differs from what the map was built with.
  // (React dev mode runs effects twice; an unneeded setStyle mid-load drops our overlay layers.)
  useEffect(() => {
    document.documentElement.dataset.dark = dark ? '1' : '0'
    const map = mapRef.current
    if (!map || appliedDark.current === dark) return
    appliedDark.current = dark
    map.setStyle(dark ? STYLES.dark : STYLES.light, { diff: false })
  }, [dark])

  const toggle = (k: LayerKey) => {
    const next = { ...visible, [k]: !visible[k] }
    setVisible(next)
    const map = mapRef.current
    if (!map) return
    for (const id of LAYER_IDS[k]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', next[k] ? 'visible' : 'none')
  }

  const rule = selected?.lot.zone ? rules?.zones[selected.lot.zone] : undefined
  const setback = useMemo(() => (selected && rules ? setbackFor(rules, selected.lot.zone, selected.lot.acres) : null), [selected, rules])
  const buildable = useMemo(() => (selected ? estimateBuildable(selected.geom, setback, rule, frontPoints(selected.road)) : null), [selected, setback, rule])

  useEffect(() => {
    const src = mapRef.current?.getSource('envelope') as GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: buildable?.envelope ? [buildable.envelope] : [] })
  }, [buildable])

  const close = () => {
    const map = mapRef.current
    if (map && selectedId.current != null) map.setFeatureState({ source: 'parcels', id: selectedId.current }, { selected: false })
    if (map && window.innerWidth <= 640) map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } })
    selectedId.current = null
    setSelected(null)
    setSandbox(false)
    setSharedPlan(null)
  }

  return (
    <div className={`app${selected ? ' has-panel' : ''}${sandbox && selected ? ' sandbox-open' : ''}`}>
      <div ref={mapEl} className="map" />

      <header className="topbar">
        <h1>Hawaii Land Finder</h1>
        <span className="pill">Prototype · Mountain View</span>
      </header>

      <div className="controls">
        <button className="ctrl-btn" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
          Layers
        </button>
        {layersOpen && (
          <div className="card layer-list">
            {LAYERS.map((l) => (
              <label key={l.key} className="switch">
                <input type="checkbox" checked={visible[l.key]} onChange={() => toggle(l.key)} />
                <span>{l.label}</span>
              </label>
            ))}
          </div>
        )}
        <div className="card legend" aria-label="Lot status legend">
          {(Object.keys(STATUS) as Status[]).filter((s) => s !== 'sold').map((s) => (
            <div key={s} className="legend-row">
              <span className="swatch" style={{ background: STATUS[s].color }} aria-hidden="true">{STATUS[s].icon}</span>
              {STATUS[s].label}
              {(s === 'for_sale' || s === 'pending') && <em className="muted"> (sample)</em>}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <LotPanel key={selected.lot.tmk} lot={selected.lot} rule={rule} buildable={buildable} road={selected.road} checkedOn={checkedOn} onClose={close} onPlan={() => setSandbox(true)} />
      )}

      {sandbox && selected && (
        <Sandbox
          key={`plan-${selected.lot.tmk}`}
          lot={selected.lot}
          geom={selected.geom}
          road={selected.road}
          setback={setback}
          rule={rule}
          sharedPlan={sharedPlan}
          onClose={() => {
            setSandbox(false)
            setSharedPlan(null)
          }}
        />
      )}

      <footer className="disclaimer">Research aid only, not legal, surveying or real estate advice. Parcel lines are approximate.</footer>
    </div>
  )
}
