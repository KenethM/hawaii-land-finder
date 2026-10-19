// Aerial photo tiles (Esri World Imagery) placed in the sandbox's plan coordinates.
import type { Position } from 'geojson'
import type { Pt } from '../geo'

export const AERIAL_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics'
const URL = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
const MAX_TILES = 64

export interface Tile {
  key: string
  href: string
  nw: Pt // plan feet
  se: Pt
}

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

/**
 * Tiles covering the visible area. `corners` are the view's corners in lon/lat, `metersPerPx` the
 * current screen resolution; picks the zoom whose pixels best match the screen.
 */
export function aerialTiles(corners: Position[], metersPerPx: number, toPlan: (c: Position) => Pt): Tile[] {
  const lat = corners[0][1]
  let z = Math.ceil(Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / Math.max(metersPerPx, 0.05)))
  z = Math.max(12, Math.min(19, z))
  for (; z >= 12; z--) {
    const xs = corners.map((c) => lon2x(c[0], z))
    const ys = corners.map((c) => lat2y(c[1], z))
    const [x0, x1, y0, y1] = [Math.floor(Math.min(...xs)), Math.floor(Math.max(...xs)), Math.floor(Math.min(...ys)), Math.floor(Math.max(...ys))]
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) continue
    const tiles: Tile[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push({ key: `${z}/${x}/${y}`, href: URL(z, x, y), nw: toPlan([x2lon(x, z), y2lat(y, z)]), se: toPlan([x2lon(x + 1, z), y2lat(y + 1, z)]) })
      }
    }
    return tiles
  }
  return []
}
