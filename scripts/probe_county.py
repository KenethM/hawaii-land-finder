"""Probe Hawaii County's public ArcGIS Online feature services in the MVP bbox.

Usage: py scripts/probe_county.py <ServiceName> [<ServiceName> ...]
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "https://services1.arcgis.com/C2LPusZs5OXNGFDn/arcgis/rest/services"
BBOX = (-155.13, 19.48, -155.03, 19.58)
SKIP = ("objectid", "globalid", "shape", "created_", "last_edited", "editor", "creator")


def get(url, params):
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=60) as r:
        return json.load(r)


for svc in sys.argv[1:]:
    root = f"{BASE}/{svc}/FeatureServer"
    try:
        info = get(root, {"f": "json"})
    except Exception as e:  # noqa: BLE001
        print(f"## {svc}: ERROR {e}")
        continue
    for lyr in info.get("layers", []) + info.get("tables", []):
        url = f"{root}/{lyr['id']}"
        meta = get(url, {"f": "json"})
        edit = (meta.get("editingInfo") or {}).get("dataLastEditDate") or (meta.get("editingInfo") or {}).get("lastEditDate")
        q = {"f": "json", "where": "1=1", "geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope",
             "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"}
        if meta.get("type") == "Table":
            q = {"f": "json", "where": "1=1"}
        try:
            n = get(url + "/query", {**q, "returnCountOnly": "true"}).get("count")
            s = get(url + "/query", {**q, "outFields": "*", "returnGeometry": "false", "resultRecordCount": 1}).get("features") or []
        except Exception as e:  # noqa: BLE001
            n, s = f"ERR {e}", []
        from datetime import datetime, timezone
        edited = datetime.fromtimestamp(edit / 1000, timezone.utc).date() if edit else None
        print(f"## {svc}/{lyr['id']} '{meta.get('name')}' | {meta.get('geometryType', meta.get('type'))} | in bbox: {n} | data edited: {edited}")
        print("   fields:", [f["name"] for f in meta.get("fields") or [] if not f["name"].lower().startswith(SKIP)])
        if s:
            print("   sample:", {k: v for k, v in s[0]["attributes"].items() if v not in (None, "", " ") and not k.lower().startswith(SKIP)})
