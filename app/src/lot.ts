// Lot data types and plain-English helpers for the report card.

export type Status = 'for_sale' | 'pending' | 'sold' | 'developed' | 'unknown'

export interface Lot {
  tmk: string
  acres: number
  w_ft: number
  d_ft: number
  zone: string | null
  land_val: number | null
  bldg_val: number
  status: Status
  sample?: boolean
  lava: string | null
  flood: string | null
  sfha: boolean
  tsunami: boolean
  sma: boolean
  fire: string | null
  fire_area: string | null
  rain_in: number | null
  elev_ft: number | null
  road: string | null
  road_m: number
  road_owner: string | null
  road_maint: string | null
  septic_soil: string | null
  slope_deg: number | null
  gw_depth_m: number | null
  nbr_n: number
  nbr_dev: number
  qpub: string | null
}

export type ZoneFamily = 'AG' | 'RA' | 'RS' | 'RD' | null

export interface ZoneRule {
  family: ZoneFamily
  max_lot_coverage_pct: number | null
  max_height_ft: number | null
  dwellings_allowed: number | null
  ohana_adu_allowed: boolean | null
  citation: string | null
  last_verified: string | null
  verified: boolean
  notes: string | null
}

export interface SetbackClass {
  label: string
  brochure_row: string
  front_rear_ft: number
  side_ft: number
  source: string
}

export interface Source {
  title: string
  publisher: string
  revision: string
  url: string
  notes?: string
}

export interface Rules {
  setbacks_confirmed: boolean
  setbacks_last_checked: string
  sources: Record<string, Source>
  setback_classes: Record<string, SetbackClass>
  zones: Record<string, ZoneRule>
}

export interface Setback extends SetbackClass {
  confirmed: boolean
  sourceInfo: Source | undefined
}

const SQFT_PER_ACRE = 43560

// The county brochure keys setbacks to the zone family *and* the lot's size.
export function setbackFor(rules: Rules, zone: string | null, acres: number): Setback | null {
  const family = zone ? rules.zones[zone]?.family : null
  const sqft = acres * SQFT_PER_ACRE
  const rsBySize = sqft >= 20000 ? 'RS_GE_20000SF' : sqft >= 10000 ? 'RS_10000_19999SF' : 'RS_LT_10000SF'
  let key: string | null = null
  if (family === 'AG') key = acres >= 1 ? 'AG_GE_1AC' : acres >= 0.5 ? 'AG_05_TO_1AC' : rsBySize // "AG < .5a: refer to RS listings"
  else if (family === 'RA' && zone === 'RA-.5a') key = 'RA_05A'
  else if (family === 'RS') key = rsBySize
  else if (family === 'RD' && zone === 'RD-3.75') key = 'RD_3_75'
  const cls = key ? rules.setback_classes[key] : undefined
  if (!cls) return null
  return { ...cls, confirmed: rules.setbacks_confirmed, sourceInfo: rules.sources[cls.source] }
}

// County road inventory: who owns and maintains the road a lot fronts.
export function roadText(owner: string | null, maint: string | null) {
  const records = owner || maint ? `County records: owner “${owner ?? '?'}”, maintained by “${maint ?? '?'}”.` : ''
  switch (maint) {
    case 'County':
      return { label: 'County-maintained road', note: `The county maintains this road. ${records}` }
    case 'County - Grant of Easement':
      return { label: 'County-maintained (easement)', note: `Privately owned, but the county maintains it under a grant of easement. ${records}` }
    case 'County Unimproved - Not Maintained':
      return { label: 'County-owned, not maintained', note: `The county owns this road but doesn’t maintain it. ${records}` }
    case 'Private':
      return {
        label: 'Private road',
        note: `The county doesn’t maintain it. Upkeep usually falls to owners along the road, sometimes through a road association. Ask about road dues and drive it after heavy rain. ${records}`,
        warn: true,
      }
    case 'RIL':
    case 'RIL - Not on Inventory':
      return {
        label: '“Road in Limbo”',
        note: `Ownership is unresolved and it may not be maintained by anyone. Ask the county and a title company about legal access. ${records}`,
        warn: true,
      }
    case 'State':
      return { label: 'State highway', note: `Maintained by the State of Hawaiʻi. ${records}` }
    default:
      return { label: 'Unknown', note: 'This road isn’t in the county’s road-maintenance records. Drive it before you buy.' }
  }
}

export const STATUS: Record<Status, { label: string; color: string; icon: string }> = {
  for_sale: { label: 'For sale', color: '#2e9e5b', icon: '●' },
  pending: { label: 'Pending', color: '#e08a1e', icon: '◐' },
  sold: { label: 'Recently sold', color: '#d1495b', icon: '✕' },
  developed: { label: 'Has buildings', color: '#3b6fd8', icon: '■' },
  unknown: { label: 'Not listed / unknown', color: '#9aa3ad', icon: '○' },
}

// USGS lava flow hazard zones (1 = highest hazard, 9 = lowest).
const LAVA: Record<string, string> = {
  '1': 'Highest hazard: summit and rift zones of an active volcano, where lava erupts often.',
  '2': 'High hazard: next to and downhill of Zone 1. Much of this zone has been covered by lava in the last 200 years.',
  '3': 'Moderate hazard: less likely than Zone 2 to be hit, mainly because of distance from active vents or the shape of the land.',
  '4': 'Lower hazard: includes all of Hualālai, which erupts less often than Kīlauea or Mauna Loa.',
  '5': 'Lower hazard: part of Kīlauea currently protected by the shape of the land.',
  '6': 'Low hazard: parts of Mauna Loa protected by the shape of the land.',
  '7': 'Low hazard: younger parts of dormant Mauna Kea.',
  '8': 'Very low hazard: the rest of Mauna Kea.',
  '9': 'Lowest hazard: Kohala volcano, which last erupted more than 60,000 years ago.',
}

export function lavaText(zone: string | null) {
  if (!zone) return { title: 'Unknown', body: 'No lava zone data for this lot.', insurance: null }
  const insurance =
    zone === '1' || zone === '2'
      ? 'Zones 1–2: homeowner insurance can be hard to get or expensive, and some lenders won’t finance. Get insurance quotes before you buy.'
      : null
  return { title: `Zone ${zone}`, body: LAVA[zone] ?? '', insurance }
}

export function rainText(inches: number | null) {
  if (inches == null) return 'Unknown'
  const feel = inches >= 150 ? 'Very wet' : inches >= 100 ? 'Wet' : inches >= 50 ? 'Moderate' : 'Dry'
  return `${feel}: about ${inches} in/yr`
}

export function floodText(zone: string | null, sfha: boolean) {
  if (!zone) return 'Not mapped'
  if (sfha) return `High-risk flood area (FEMA zone ${zone}): flood insurance usually required with a mortgage.`
  if (zone === 'X') return 'Minimal flood hazard (FEMA zone X)'
  return `FEMA zone ${zone}`
}

export function powerText(lot: Lot) {
  if (lot.nbr_n === 0) return { label: 'Unknown', detail: 'No neighboring lots to compare.' }
  const pct = Math.round((lot.nbr_dev / lot.nbr_n) * 100)
  const label = pct >= 50 ? 'Possibly nearby' : pct >= 20 ? 'Unknown' : 'Unknown, few neighbors built'
  return {
    label,
    detail: `${lot.nbr_dev} of ${lot.nbr_n} lots within 250 m have buildings (${pct}%). Power-line maps aren’t public, so this is only a hint. Ask Hawaiian Electric about service and line-extension costs.`,
  }
}

export const usd = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export const sqft = (m2: number) => Math.round(m2 * 10.7639).toLocaleString('en-US')
