"""Download MVP-area layers from Hawaii Statewide GIS as GeoJSON into data/raw/.

Usage: .venv/Scripts/python scripts/fetch_layers.py [layer names...]
Endpoints are documented in docs/data-sources.md. Free, public, no API key.
"""
import json
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

BASE = "https://geodata.hawaii.gov/arcgis/rest/services"
COUNTY = "https://services1.arcgis.com/C2LPusZs5OXNGFDn/arcgis/rest/services"  # Hawaii County ArcGIS Online
BBOX = (-155.13, 19.48, -155.03, 19.58)  # Mountain View / Hawaiian Acres
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

# name -> (state service path or full FeatureServer URL, layer id, out fields, page size)
LAYERS = {
    "parcels": ("ParcelsZoning", 5, "tmk,tmk_txt,taxacres,gisacres,landvalue,bldgvalue,pittcode,homeowner,majorowner,qpub_link", 1000),
    "zoning": ("ParcelsZoning", 2, "zone,district,ordinance", 1000),
    "sma": ("ParcelsZoning", 21, "smarea", 1000),
    "lava": ("Hazards", 3, "hzone,mzone", 2000),
    "flood": ("Hazards", 14, "fld_zone,sfha_tf,static_bfe", 2000),
    "tsunami": ("Hazards", 11, "zone_type,zone_desc,evac_zone", 2000),
    "fire": ("Hazards", 7, "commu_name,risk_rating", 2000),
    "rainfall": ("Climate", 13, "contour", 1000),
    "contours": ("Elevation", 1, "contour", 5000),
    "roads": ("Transportation", 6, "fullname,class,approved,appryear", 5000),
    "cesspool_tool": ("Infrastructure", 32, "tmk,nrcs_septic_dominant,slope_deg,rainfall_in,elevation_m,dep_to_water_m,nrcs_floodfreq", 1000),
    "road_maint": (f"{COUNTY}/Roads_Maintainer_Owner_Public_View/FeatureServer", 0, "FULLNAME,OWNER,MAINTAINER", 1000),
}


def query(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(full, timeout=120) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001 - simple retry for flaky public servers
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def fetch(name, service, layer_id, fields, page):
    root = service if service.startswith("https://") else f"{BASE}/{service}/MapServer"
    url = f"{root}/{layer_id}/query"
    base = {
        "f": "geojson",
        "where": "1=1",
        "geometry": ",".join(map(str, BBOX)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": fields,
    }
    # Fetch all matching IDs first, then features in ID chunks. Offset paging on this
    # server stops early (silently returns short pages), so don't rely on it.
    ids_params = {k: v for k, v in base.items() if k not in ("f", "outFields")}
    ids = sorted(query(url, {**ids_params, "f": "json", "returnIdsOnly": "true"}).get("objectIds") or [])
    features = []
    for i in range(0, len(ids), page):
        chunk = ids[i:i + page]
        data = query(url, {"f": "geojson", "objectIds": ",".join(map(str, chunk)), "outSR": 4326, "outFields": fields})
        features.extend(data.get("features") or [])
    if len(features) != len(ids):
        print(f"WARNING {name}: expected {len(ids)} features, got {len(features)}")
    out = {
        "type": "FeatureCollection",
        "features": features,
        "source": url.removesuffix("/query"),
        "fetched": date.today().isoformat(),
    }
    (RAW / f"{name}.geojson").write_text(json.dumps(out), encoding="utf-8")
    print(f"{name}: {len(features)} features")


if __name__ == "__main__":
    import sys

    RAW.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or list(LAYERS)  # optionally fetch only the named layers
    for name in wanted:
        fetch(name, *LAYERS[name])
