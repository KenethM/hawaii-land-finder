# Hawaii Land Finder

Map-first tool that helps first-time land buyers understand undeveloped lots in Hawaii.
Project brief: [HANDOFF.md](HANDOFF.md). Verified data sources: [docs/data-sources.md](docs/data-sources.md).

**Status:** Phase 0 prototype for Mountain View / Hawaiian Acres (9,486 parcels). Free data and free tooling only.

## Run it locally

```sh
# 1. Data (Python 3.11+); only needed to refresh data
py -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python scripts/fetch_layers.py     # downloads from geodata.hawaii.gov into data/raw/
.venv/Scripts/python scripts/build_parcels.py    # enriches parcels into data/processed/

# 2. App
cd app
npm install
npm run dev        # open the printed localhost URL
```

`data/processed/` is served directly by the app (see `app/vite.config.ts`).

## What's in the prototype

- Parcels colored by status: has buildings (assessed building value > 0) and unknown. **For sale / pending lots are sample data**, labeled as such everywhere.
- Lot report card: size, zoning, assessed values, county record link, lava zone in plain English, flood, tsunami, wildfire risk, rainfall, elevation, slope (where available), a nearby-development hint for power, nearest road, wastewater/septic notes, and "things the map can't tell you."
- Road access: who owns and maintains the road each lot fronts (county road inventory). About 84% of lots in the area are on private roads.
- "What could I build?": setbacks by zone family and lot size from the county's 2019 setback brochure (flagged "confirm with Planning"), drawn as a buildable outline. Long edges get side setbacks and short ends get front/rear.
- **Plan this lot** (sandbox): the map fades and the lot opens on its own with its road at the bottom (or north up, or any rotation). Add sized shapes (home, ohana, shed, water tank, septic area, garden, parking, custom), drag/resize/rotate them, drop numbered note pins, and keep lot notes. Buildings and tanks that cross into the setback are flagged, with distance to the nearest property line. Plans save per lot in the browser (this device only).
- Sandbox extras: aerial photo under the lot (Esri World Imagery, toggleable), **Download image** (JPEG with photo, PNG without; includes setbacks, shapes, notes, north arrow, scale), and **Share link** (the plan is packed into the URL, so it works without accounts; the receiver can "Keep a copy").
- **Copy link** on the lot card shares just the lot (`#lot=<TMK>`).
- Corner lots (~10% of lots): detected automatically; front setbacks go on every road side by default (most cautious), and the sandbox lets you pick one road instead.
- Main map: the compass button resets rotation/tilt (after right-click dragging) to north-up, top-down.
- Setbacks use the real frontage: the front is the lot edge whose midpoint is closest to a road.
- Layer toggles: satellite, lava zones, rainfall, zoning, who maintains roads, road names. Light/dark mode; bottom sheet on phones.

## Known gaps / next steps

1. **Zoning rules:** confirm the 2019 setbacks with Planning (then set `setbacks_confirmed: true` in `data/zoning-rules.json`), and add lot coverage / height / dwellings per zone from Ch. 25 with citations. FR, CV-10, ML-20 and OPEN zones have no setback data yet.
2. **Sold status:** find a county bulk sales source (Real Property Tax).
3. **County water:** records request to Hawaii County DWS.
4. **Slope:** probe the state lidar DTM ImageServer for a real slope layer.
5. **Corner and flag lots:** the front is the edge closest to a road; corner lots touching two roads may need a different front (ask Planning).
6. **Sandbox:** plans save in this browser; share links move them between devices, but automatic sync needs accounts (Phase 2). Very large plans make long links.
7. Parcel file is ~7 MB GeoJSON; switch to PMTiles before expanding beyond this area.
