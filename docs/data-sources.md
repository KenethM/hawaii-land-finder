# Data sources (verified)

All endpoints below were queried live on **2026-10-16** against the MVP bounding box
(Mountain View / Hawaiian Acres: lon -155.13 to -155.03, lat 19.48 to 19.58, WGS84).
Raw probe output: [`layer-probe.json`](layer-probe.json) (regenerate with `py scripts/probe_layers.py > docs/layer-probe.json`).

Base: `https://geodata.hawaii.gov/arcgis/rest/services` (Hawaii Statewide GIS Program, free, no key).
All layers below support `JSON`, `geoJSON` and `PBF` query formats. Most do not publish an
`editingInfo.lastEditDate`, so the UI should show the probe date as "checked on" until we find
per-layer metadata dates.

## Confirmed working

| Layer | Endpoint (`…/services/` + ) | Geometry | In MVP bbox | Max records/page | Key fields |
|---|---|---|---|---|---|
| Hawaii County Parcels | `ParcelsZoning/MapServer/5` | Polygon | 9,486 | 1000 | `tmk`, `tmk_txt`, `taxacres`, `gisacres`, `landvalue`, `bldgvalue`, `pittcode`, `homeowner`, `majorowner`, `qpub_link` |
| County Zoning – Hawaii | `ParcelsZoning/MapServer/2` | Polygon | 289 | 1000 | `zone`, `district`, `ordinance` |
| State Land Use Districts | `ParcelsZoning/MapServer/20` | Polygon | 25 | 1000 | `ludcode` (A/U/R/C) |
| Special Management Areas | `ParcelsZoning/MapServer/21` | Polygon | 0 (inland) | 1000 | `smarea` |
| DHHL Lands (official) | `ParcelsZoning/MapServer/8` | Polygon | 0 | 1000 | `island`, `gis_acres` |
| Lava Flow Hazard Zones | `Hazards/MapServer/3` | Polygon | 2 (both `hzone`=3) | 2000 | `hzone`, `mzone` |
| Hawaii County DFIRM (flood) | `Hazards/MapServer/14` | Polygon | 1 | 2000 | `fld_zone`, `sfha_tf`, `static_bfe` |
| Tsunami Evacuation – All Zones | `Hazards/MapServer/11` | Polygon | 1 | 2000 | `zone_type`, `zone_desc`, `evac_zone` |
| Fire Risk Areas | `Hazards/MapServer/7` | Polygon | 5 | 2000 | `commu_name`, `risk_rating` |
| Annual Rainfall (inches) | `Climate/MapServer/13` | **Polyline (isohyets)** | 3 | 1000 | `contour` (inches/yr) |
| Hawaii 100 ft Contours | `Elevation/MapServer/1` | Polyline | 131 | 5000 | `contour` (ft) |
| Hawaii County Roads | `Transportation/MapServer/6` | Polyline | 440 | 5000 | `fullname`, `class`, `approved`, `appryear`, `district` |
| Onsite Sewage Disposal Systems – Hawaii | `Infrastructure/MapServer/26` | Point | 2,760 | 1000 | `tmk`, `osds_qty`, `class_iv` (cesspool), `no_struct`, `ttl_bdrms` |
| HCPT Cesspools (Cesspool Prioritization Tool) | `Infrastructure/MapServer/32` | Point | 2,410 | 1000 | `tmk`, `nrcs_septic_dominant`, `slope_deg`, `rainfall_in`, `elevation_m`, `dep_to_water_m`, `nrcs_floodfreq` |

### Zoning codes present in the MVP area
`A-1a`, `A-3a`, `A-5a`, `A-10a`, `A-20a`, `RA-.5a`, `RS-10`, `RS-20`, `CV-10`, `ML-20`, `FR`, `OPEN`, `(road)`.
These are the entries `data/zoning-rules.json` needs, each verified against Hawaii County Code Ch. 25.

## Notes and gotchas

- **Rainfall is lines, not polygons.** Per-parcel rainfall is interpolated between the two nearest
  isohyets (see `scripts/build_parcels.py`). Label it as approximate.
- **"Developed" status:** parcel `bldgvalue > 0` is a usable proxy. The OSDS layer (`no_struct`) is a second signal.
- **Road class:** `class` codes (e.g. `A41`) follow the Census MTFCC/CFCC scheme; `A4x` = local/neighborhood road.
  This layer does **not** say whether a road is county-maintained vs. private. Needs another source.
- **Cesspool tool (HCPT)** has per-TMK soil septic suitability, slope and depth to groundwater. This is valuable
  for the wastewater note on the lot card, but it only covers lots that already have a cesspool.
- **Paging:** parcels exceed 1000 records per request; page with `resultOffset`/`resultRecordCount`.
- **qPublic link** on each parcel goes to the county's assessor page (owner, sales history). Link out; don't scrape.

## Not available from this catalog (still to find)

| Need | Status | Next step |
|---|---|---|
| Recent sales (red "sold" status) | Not in GIS | Check Hawaii County Real Property Tax for a bulk/open-data sales export. qPublic has per-lot history but scraping it may violate terms. |
| County water service area | Not found | Records request to Hawaii County Dept. of Water Supply. |
| Electric lines | Not public | Infer "likely" from neighboring developed lots; label as estimate. |
| Slope (lidar) | Only 100 ft contours as vectors | Candidate: `SoH_Imagery/Hawaii_DTM_elevation` (ImageServer, state lidar DTM, not yet probed) or USGS 3DEP. HCPT `slope_deg` fills ~2,300 lots now. |
| Active / pending listings | Requires MLS (IDX/VOW) | Broker partnership (Phase 2). Prototype uses clearly labeled sample data. |
| Building permits | Not found | Look for Hawaii County permit open data (Phase 3). |

---

# Hawaii County's own GIS services (found 2026-10-17)

The County of Hawaii publishes ~226 public layers on ArcGIS Online (org id `C2LPusZs5OXNGFDn`).
Base: `https://services1.arcgis.com/C2LPusZs5OXNGFDn/arcgis/rest/services/<Service>/FeatureServer/<layer>`.
List them: `https://www.arcgis.com/sharing/rest/search?f=json&q=orgid:C2LPusZs5OXNGFDn`.
Probe any of them in the MVP bbox: `py scripts/probe_county.py <ServiceName>`.
The county website (hawaiicounty.gov, planning.hawaiicounty.gov) returns 403 to scripts; use a browser.

| Need | Service / layer | In MVP bbox | Data last edited | Key fields | Notes |
|---|---|---|---|---|---|
| **Road owner & maintainer** | `Roads_Maintainer_Owner_Public_View/0` | 204 | 2026-10-16 | `FULLNAME`, `OWNER`, `MAINTAINER` | Values: County/County, Private/Private, RIL (Roads in Limbo), "County Unimproved – Not Maintained", "County – Grant of Easement", State. Answers "county-maintained vs private". |
| Roads in Limbo | `Roads_in_Limbo/2` | 13 | 2026-04-24 | `FULLNAME`, `GenArea` | Roads with unresolved ownership. |
| Building permits (archive) | `DPW_Building_Permits/14` | 1,144 | 2026-10-10 | `TMK`, `PERMIT_NO`, `APRVD_DATE`, `COMMENTS` | Mostly historical: only 13 since 2020 in bbox. Current permits live in EPIC (no public export found). Has owner names (`ISSUED_TO`); don't display. |
| Building footprints | `cohbuildings_view/0` | 10,836 | 2026-05-22 | `TMK9`, `OUTBLDG`, `FULL_ADDR` | Better "has structures" signal than `bldgvalue`. |
| Ohana (2nd dwelling) permits | `Ohana_Permits/16` | 83 | 2026-10-17 | `TMK`, `STATUS`, `DATE_` | Has owner names; use TMK + status only. |
| Additional farm dwelling agreements | `Additional_Farm_Dwelling_Agreements` | not probed | | | Relevant to "what could I build" on Ag land. |
| Pre/Post-1976 Ag subdivisions | `PreAndPost1976AgSubs/0` | 25 | 2024-12-11 | `SUB_NO`, `Approved_D`, `IMAGE2` (subdivision map scan URL) | Pre-1976 subdivisions (e.g. Hawaiian Acres) have different infrastructure rules. |
| Capital improvement projects | `County_of_Hawaii_Capital_Improvement_Projects_Public_View/0` | 1 | 2026-09-30 | `Project_Name`, `Status`, `Estimated_Completion_Date` | Phase 3 "area momentum". Also a Line view. |
| County parcels | `cohParcels_prod_pa11_agol_VIEW/0` | 9,122 | 2026-10-13 | `Name` (TMK) only | Geometry is fresher than the state copy, but no attributes. |
| County zoning | `Zoning_COH`, `Zoning` | not probed | | | County's own version; state copy is "as of Nov 2023". |
| Cesspools (DEM) | `20261009_DEMWWD_PublicData_view/5` | 2,337 | 2026-10-09 | (no public fields) | Sewer layers in the same service have 0 features in bbox (no county sewer here). |
| Landslide, flood, wildfire, dam, sea level hazards | `Hawaii_Co_*`, `Hazards_Group`, `HawaiiCo_WF_CAR` | not probed | | | County hazard mitigation plan layers. |

## Other findings

- **Setbacks:** official county brochure "Setback Requirements for Residential & Agricultural Districts", Planning Dept., Rev. April 2019:
  `https://records.hawaiicounty.gov/weblink/1/edoc/140146/BLG_SETBACK_BROCHURE_REV2019.pdf`.
  Setbacks depend on **lot size**, not just zone (e.g. "AG ≥ 1 acre": front/rear 30 ft, side 20 ft; "AG < 1 acre – .5a": 25/15; "RA-.5a": 25/15).
  Still needed from Ch. 25 / Planning: lot coverage, height limit, dwellings allowed. Full Ch. 25 text not found online in machine-readable form.
- **Slope / elevation:** state `SoH_Imagery/Hawaii_DTM` returns NoData at Mountain View. **USGS 1 m DEM** (`HI_Hawaii_Island_Lidar_NOAA_2017_B17`, lidar flown 2018–2020) covers the MVP bbox in ~6 GeoTIFF tiles (~95–130 MB each), free via the USGS TNM API:
  `https://tnmaccess.nationalmap.gov/api/v1/products?bbox=-155.13,19.48,-155.03,19.58&datasets=Digital%20Elevation%20Model%20(DEM)%201%20meter`.
- **Power:** Hawaiian Electric publishes a Hawaii Island Locational Value Map (address search, updated nightly on weekdays) showing circuit hosting capacity, not line locations. No public data feed; link to it, don't scrape it.
- **Water:** no public DWS service-area layer found. A 2015 UH-compiled DWS reservoir point layer exists (`services1.arcgis.com/x4h61KaW16vFs7PM/.../HI_DWS_shapefiles_4_Dylan`), unofficial and not a service area. Still requires asking DWS.
- **Sales:** no county bulk sales export found. Per-lot sales are on qPublic (vendor-run, refreshed ~weekly). Deeds are at the state Bureau of Conveyances (index free with account; $1/page for documents). DBEDT's sales reports use commercial Title Guaranty data.
