"""Probe candidate ArcGIS layers: fetch metadata and run a live test query in the MVP bbox.

Usage: py scripts/probe_layers.py > docs/layer-probe.json
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://geodata.hawaii.gov/arcgis/rest/services"
# Mountain View / Hawaiian Acres MVP bounding box (lon/lat, WGS84)
BBOX = (-155.13, 19.48, -155.03, 19.58)

LAYERS = [
    ("ParcelsZoning", 5, "Hawaii County Parcels"),
    ("ParcelsZoning", 2, "County Zoning - Hawaii"),
    ("ParcelsZoning", 21, "Special Management Areas"),
    ("ParcelsZoning", 20, "State Land Use Districts"),
    ("ParcelsZoning", 8, "DHHL Lands"),
    ("Hazards", 3, "Lava Flow Hazard Zones"),
    ("Hazards", 14, "Hawaii County DFIRM (flood)"),
    ("Hazards", 11, "Tsunami Evacuation - All Zones"),
    ("Hazards", 7, "Fire Risk Areas"),
    ("Climate", 13, "Annual Rainfall (inches)"),
    ("Elevation", 1, "Hawaii 100 Foot Contours"),
    ("Transportation", 6, "Hawaii County Roads"),
    ("Infrastructure", 26, "Onsite Sewage Disposal Systems - Hawaii"),
    ("Infrastructure", 32, "HCPT Cesspools"),
]


def get(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=60) as r:
        return json.load(r)


def probe(service, layer_id, label):
    url = f"{BASE}/{service}/MapServer/{layer_id}"
    meta = get(url, {"f": "json"})
    edit = (meta.get("editingInfo") or {}).get("lastEditDate")
    out = {
        "label": label,
        "url": url,
        "name": meta.get("name"),
        "geometryType": meta.get("geometryType"),
        "maxRecordCount": meta.get("maxRecordCount"),
        "queryFormats": meta.get("supportedQueryFormats"),
        "lastEditDate": datetime.fromtimestamp(edit / 1000, timezone.utc).date().isoformat() if edit else None,
        "fields": [(f["name"], f["type"].replace("esriFieldType", ""), f.get("alias")) for f in meta.get("fields") or []],
    }
    q = {
        "f": "json",
        "where": "1=1",
        "geometry": ",".join(map(str, BBOX)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }
    try:
        out["countInBbox"] = get(url + "/query", {**q, "returnCountOnly": "true"}).get("count")
        sample = get(url + "/query", {**q, "outFields": "*", "returnGeometry": "false", "resultRecordCount": 1})
        feats = sample.get("features") or []
        out["sample"] = feats[0]["attributes"] if feats else None
    except Exception as e:  # noqa: BLE001 - record and continue
        out["error"] = str(e)
    return out


if __name__ == "__main__":
    results = []
    for s, i, label in LAYERS:
        try:
            results.append(probe(s, i, label))
        except Exception as e:  # noqa: BLE001
            results.append({"label": label, "url": f"{BASE}/{s}/MapServer/{i}", "error": str(e)})
        print(f"done: {label}", file=sys.stderr)
    json.dump(results, sys.stdout, indent=1, default=str)
