# Hawaii Land Finder — Project Handoff

> Working name. A sleek, map-first tool that helps first-time land buyers in Hawaii find an undeveloped lot, see its status at a glance, and understand what they'd be getting into (utilities, hazards, climate, what they could build, and where the area is heading).
>
> Tip: if you're using Claude Code, rename this file to `CLAUDE.md` (or reference it from one) so it's loaded as project context automatically.

---

## 1. The problem

Cheap undeveloped land on Hawaii Island (Mountain View, Hawaiian Acres, Fern Forest, Orchidland, Volcano, Ocean View, lower Puna) attracts first-time buyers who often don't learn the hard parts until after closing: no county water, no power lines, unpaved private roads, lava zone insurance issues, heavy rain, cesspool rules, slope, lava tubes. The information mostly exists publicly, but it's scattered across a dozen agency sites and GIS layers. Nobody puts it together for a regular buyer in plain language.

## 2. Who it's for

Primary: first-time land buyers looking at undeveloped/raw lots in Hawaii, starting with Hawaii Island.
Secondary (later): agents, builders, people relocating from the mainland.

The tone should be friendly and plain-spoken, not a GIS tool for professionals.

## 3. Core experience

1. User opens a clean, minimal map centered on a starting area (MVP: Mountain View / Hawaiian Acres).
2. Parcels are color-coded by status.
3. User taps a lot → a panel/pop-up shows a "lot report card."
4. User toggles overlay layers (utilities, rainfall, lava zone, flood, slope, development activity).
5. From the lot panel, user can see a rough "what could I build here" view: buildable envelope after setbacks, max footprint, and notes on water/wastewater/power.

### Status colors

| Status | Color | Notes |
|---|---|---|
| For sale / open to buy | Green | Requires listing data (see §6) |
| Pending / in process | Orange | Requires listing data |
| Recently sold | Red | Available from county sales records |
| Developed / has structures | Blue | Later phase; infer from assessed building value > 0 or building footprints |
| Not listed / unknown | Neutral gray | Default for most parcels |

Keep the palette accessible: never rely on color alone. Add a legend, pattern or icon cues, and text labels in the lot panel.

### Lot report card (pop-up contents)

- TMK (tax map key), acreage, zoning, approximate dimensions
- Status + last sale date/price (if public)
- Lava flow hazard zone (with a one-line plain-English meaning and an insurance note for zones 1–2)
- Average annual rainfall
- County water: yes / no / nearby (and a note on catchment if no)
- Power: likely available / unknown (see limitations)
- Road access type if known (county-maintained vs. private/unpaved)
- Flood zone, tsunami evacuation zone, Special Management Area (if applicable)
- Slope / elevation summary from lidar
- Rough buildable area + max footprint (see §5)
- "Things the map can't tell you" section (lava tubes, soil, unrecorded easements, survey accuracy) with a recommendation to get a survey and site visit

## 4. Map layers

| Layer | Purpose | Likely source (verify each) |
|---|---|---|
| Parcels / TMK boundaries | Base geometry for every lot | Hawaii Statewide GIS Program (geodata.hawaii.gov ArcGIS REST services) and/or Hawaii County GIS |
| Zoning | Drives build rules | Hawaii Statewide GIS / Hawaii County Planning |
| Lava flow hazard zones | Hazard + insurance | Confirmed: `https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer/3` (supports JSON and GeoJSON queries; field `hzone`) |
| Rainfall | Wet vs. dry areas | Rainfall Atlas of Hawaii (University of Hawaii) |
| Flood zones | Flood risk | FEMA National Flood Hazard Layer; also check geodata.hawaii.gov Hazards services |
| Tsunami evacuation zones | Coastal risk | Hawaii Statewide GIS / county civil defense |
| County water service | Water availability | Hawaii County Department of Water Supply (service area maps; may require a records request) |
| Electric lines | Power availability | Hawaiian Electric does not publish pole-level data publicly; see limitations |
| Elevation / slope | Topography | USGS 3D Elevation Program (3DEP) / NOAA lidar; derive slope rasters |
| Building permits | Development heat map | Hawaii County permit records (check for open data or bulk export) |
| Recent sales | "Sold" status | Hawaii County Real Property Tax records |
| Active listings | "For sale" / "pending" | MLS feed via a licensed broker partner (IDX/VOW) — see §6 |

**First task for development:** browse `https://geodata.hawaii.gov/arcgis/rest/services` and catalog every layer relevant to the table above (service URL, layer ID, key fields, query formats, update date). Save that as `docs/data-sources.md`. Don't guess endpoints; confirm each one returns data.

## 5. "What could I build?" logic (MVP version)

Keep this explicitly approximate and labeled as an estimate.

1. Get the lot polygon and its zoning.
2. Look up the zoning district's rules in Hawaii County Code Chapter 25 (Zoning): minimum setbacks (front/side/rear), max lot coverage, height limits, allowed dwellings/ADUs. Store these in a small config file per zoning code (e.g. `data/zoning-rules.json`) with a citation and "last verified" date for each entry. **Do not hardcode numbers from memory.**
3. Buffer the polygon inward by the setbacks to draw a buildable envelope on the map.
4. Compute envelope area and max footprint (lot area × coverage limit, capped by envelope).
5. Add practical notes:
   - Wastewater: Hawaii is phasing out cesspools (Act 125, 2017, conversion target 2050), so new builds generally need an approved individual wastewater system. Flag this as a cost item.
   - Water: if no county water, note rainwater catchment and typical setup considerations.
   - Slope: if lidar shows steep areas, shade them inside the envelope.
6. Disclaimer: estimates only; confirm with Hawaii County Planning / DPW and a licensed surveyor or architect.

## 6. Known hard parts and honest limitations

- **Listing status (green/orange):** active and pending listings come from the MLS. Displaying them publicly generally requires an IDX/VOW agreement through a licensed broker, or a paid listing data provider. Plan to partner with a local brokerage. Until then, the MVP can show only Sold (county records) and Unknown.
- **Electric service:** pole/line data isn't public. Options: infer from nearby parcels with structures, user reports, or a "likely / unknown" label. Never imply certainty.
- **Water service:** many Puna subdivisions have no county water at all. County service area maps may need a records request.
- **Lava tubes / sinkholes:** not visible in public data. Always surface as a "can't see from the map" warning.
- **Parcel accuracy:** GIS parcel lines are approximate, not survey-grade. Say so in the UI.
- **Data freshness:** show the source and last-updated date for each layer in the UI.
- **Liability:** this is a research aid, not legal, surveying, or real estate advice. Put this in the footer and the lot panel.

## 7. Suggested tech stack

Keep it simple and free to start:

- **Map:** MapLibre GL JS (open source, no API key required for the library) with a free/low-cost basemap (e.g. OpenFreeMap, MapTiler free tier, or Esri satellite imagery where terms allow).
- **Frontend:** Vite + React (or plain HTML/JS for the very first prototype).
- **Data prep:** Python (geopandas, shapely, rasterio) scripts in `/scripts` that pull from ArcGIS REST endpoints, clip to the MVP area, and output GeoJSON or vector tiles (PMTiles via tippecanoe for larger datasets).
- **Spatial joins:** precompute per-parcel attributes (lava zone, rainfall, flood zone, slope stats, water yes/no) offline and store them on each parcel feature so the pop-up is instant.
- **Hosting:** static hosting (Vercel, Netlify, Cloudflare Pages) works for the MVP since all data can be prebuilt files.
- **Later:** a backend (PostGIS) once there's listing data, user accounts, or saved lots.

### Suggested folder layout

```
/
├── HANDOFF.md              (this file)
├── docs/
│   └── data-sources.md     (verified layer catalog)
├── scripts/                (data download + processing)
├── data/
│   ├── raw/                (gitignored)
│   ├── processed/          (GeoJSON / PMTiles for the app)
│   └── zoning-rules.json   (setbacks/coverage per zone, with citations)
└── app/                    (frontend)
```

## 8. Design direction

- Simple and sleek: a light, uncluttered basemap; satellite toggle for seeing trees and brush.
- Bottom sheet on mobile, side panel on desktop for the lot report card.
- Layer toggles as a small, tidy control, not a giant GIS sidebar.
- Plain-English labels ("Heavy rain: ~150 in/yr" not "MAP_RF_ANN").
- Support light and dark mode.
- Mobile-first: many buyers will look at lots from their phone while driving around.

## 9. Roadmap

**Phase 0 — Clickable prototype (Mountain View area)**
Parcels from GIS, lava zone, rainfall, sold status from county records, lot pop-up, mock "for sale" data clearly labeled as sample.

**Phase 1 — Real data MVP**
All layers in §4 that are publicly available, precomputed per parcel. Buildable envelope estimate. Data sources + dates shown in the UI.

**Phase 2 — Listings**
Broker partnership for MLS feed → real green/orange statuses. Saved lots and side-by-side comparison.

**Phase 3 — Development outlook**
Building permit heat map over time; planned infrastructure (road projects, water line extensions, schools) from county/state plans. "Area momentum" indicator.

**Phase 4 — Expand**
Rest of Hawaii Island, then other counties (Maui, Kauai, Oahu each have different zoning codes and data portals).

## 10. Open questions

- Which brokerage could be a listing data partner?
- Free tool, freemium, or paid lot reports?
- How to handle Hawaiian Home Lands, kuleana parcels, and land court vs. regular system parcels in the UI?
- Should users be able to submit local knowledge (e.g. "power line runs to this road", "road is 4WD only")? If so, how is it moderated?

## 11. Existing tools to learn from (not direct competitors in Hawaii-specific depth)

- **Land id**: parcel maps, 3D terrain, contours, measurement tools; aimed at agents and land professionals.
- **Regrid**: national parcel data with maps and an API (possible paid data source).
- **LandGlide**: inexpensive mobile parcel/owner lookup; no zoning or buildability analysis.
- **Buildability**: zoning/setback/buildability analysis; check its Hawaii coverage.
- **Hawaii Life blog**: agent-made Puna lava zone neighborhood map; shows buyer demand for plain-language Hawaii-specific guidance.
- **Hawaii County / Hawaii Statewide GIS viewers**: authoritative data, but built for professionals, not buyers.

The gap this project fills: Hawaii-specific factors (lava zone, catchment, off-grid power, rainfall, cesspool rules) combined with buyer-friendly design and a buildability estimate in one place.
