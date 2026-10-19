"""Precompute per-parcel report-card attributes and write app-ready GeoJSON.

Reads data/raw/*.geojson (from fetch_layers.py), writes data/processed/:
  parcels.geojson   - every parcel with enriched, short-keyed properties
  lava, zoning, flood, rainfall, roads, road_maint (.geojson) - overlay layers
  manifest.json     - source URL + fetch date per layer (shown in the UI)

Usage: .venv/Scripts/python scripts/build_parcels.py
"""
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"

# WGS84 <-> UTM zone 5N, so distances and areas are in meters
to_m = Transformer.from_crs(4326, 32605, always_xy=True)
to_ll = Transformer.from_crs(32605, 4326, always_xy=True)


def transform(tr, geom):
    return shapely.transform(geom, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))

SQM_PER_ACRE = 4046.8564224
FT_PER_M = 3.28084
N_SAMPLE_FOR_SALE, N_SAMPLE_PENDING = 10, 4
NEIGHBOR_M = 250  # radius for "nearby lots with buildings" (weak power-availability signal)
ROAD_MATCH_M = 40  # a lot "fronts" a county-inventoried road if its centerline is this close to the lot edge


def load(name):
    data = json.loads((RAW / f"{name}.geojson").read_text(encoding="utf-8"))
    feats = [f for f in data["features"] if f.get("geometry")]
    geoms = [transform(to_m, shape(f["geometry"])) for f in feats]
    return data, [f["properties"] for f in feats], geoms


def containing(tree, geoms, props, pt):
    """Properties of the first polygon containing pt, or None."""
    for i in tree.query(pt, predicate="intersects"):
        return props[i]
    return None


def interpolate_lines(tree, geoms, values, pt, search=5000):
    """Inverse-distance blend of the two nearest lines with different values (isohyets/contours)."""
    near = sorted(
        ((geoms[i].distance(pt), values[i]) for i in tree.query(pt.buffer(search))),
        key=lambda t: t[0],
    )
    if not near:
        return None
    d1, v1 = near[0]
    other = next(((d, v) for d, v in near if v != v1), None)
    if other is None or d1 == 0:
        return v1
    d2, v2 = other
    return (v1 * d2 + v2 * d1) / (d1 + d2)


def dimensions_ft(poly):
    """Approximate width x depth from the minimum rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    xs = list(rect.exterior.coords)
    sides = sorted(((xs[i][0] - xs[i + 1][0]) ** 2 + (xs[i][1] - xs[i + 1][1]) ** 2) ** 0.5 for i in range(2))
    return round(sides[0] * FT_PER_M), round(sides[1] * FT_PER_M)


def round_coords(geom_ll, nd=6):
    def rnd(c):
        if isinstance(c, (int, float)):
            return round(c, nd)
        return [rnd(x) for x in c]

    g = mapping(geom_ll)
    return {"type": g["type"], "coordinates": rnd(g["coordinates"])}


def write_layer(name, props, geoms, keep, simplify_m=2.0):
    feats = [
        {
            "type": "Feature",
            "properties": {k: p.get(k) for k in keep},
            "geometry": round_coords(transform(to_ll, g.simplify(simplify_m))),
        }
        for p, g in zip(props, geoms)
    ]
    (OUT / f"{name}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")


def stable_rank(tmk):
    """Deterministic pseudo-random order so sample listings don't change between builds."""
    return hashlib.sha1(str(tmk).encode()).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}

    layers = {}
    for name in ["parcels", "zoning", "lava", "flood", "tsunami", "fire", "sma", "rainfall", "contours", "roads", "cesspool_tool", "road_maint"]:
        data, props, geoms = load(name)
        layers[name] = (props, geoms, STRtree(geoms) if geoms else None)
        manifest[name] = {"source": data["source"], "fetched": data["fetched"], "count": len(props)}

    z_props, z_geoms, z_tree = layers["zoning"]
    rain_props, rain_geoms, rain_tree = layers["rainfall"]
    elev_props, elev_geoms, elev_tree = layers["contours"]
    road_props, road_geoms, road_tree = layers["roads"]
    rm_props, rm_geoms, rm_tree = layers["road_maint"]
    hcpt = {int(p["tmk"]): p for p in layers["cesspool_tool"][0] if p.get("tmk")}

    def poly_attr(name, pt):
        props, geoms, tree = layers[name]
        return containing(tree, geoms, props, pt) if tree else None

    p_props, p_geoms, _ = layers["parcels"]
    out = []
    for p, g in zip(p_props, p_geoms):
        pt = g.representative_point()

        # Zoning: district covering the most of the lot (lots can straddle a boundary)
        zone, best = None, 0.0
        for i in z_tree.query(g, predicate="intersects"):
            a = z_geoms[i].intersection(g).area
            if a > best:
                zone, best = z_props[i].get("zone"), a

        lava = poly_attr("lava", pt) or {}
        flood = poly_attr("flood", pt) or {}
        # The tsunami layer includes "Tsunami Safe Zone" polygons (where to evacuate TO)
        tsunami = poly_attr("tsunami", pt)
        if tsunami and tsunami.get("zone_type") == "Tsunami Safe Zone":
            tsunami = None
        fire = poly_attr("fire", pt) or {}
        if fire.get("risk_rating") == "N/A":
            fire = {}
        sma = poly_attr("sma", pt)
        rain = interpolate_lines(rain_tree, rain_geoms, [r["contour"] for r in rain_props], pt, search=20000)
        elev = interpolate_lines(elev_tree, elev_geoms, [e["contour"] for e in elev_props], pt)

        road_i = road_tree.nearest(pt)
        road_dist = g.distance(road_geoms[road_i])
        road_name = road_props[road_i].get("fullname")

        # Who owns/maintains the road the lot fronts (county inventory). Prefer it when it's close.
        rm = None
        rm_near = [(rm_geoms[i].distance(g), i) for i in rm_tree.query(g.buffer(ROAD_MATCH_M))]
        if rm_near:
            d, i = min(rm_near)
            rm = rm_props[i]
            road_name, road_dist = rm.get("FULLNAME") or road_name, min(road_dist, d)

        h = hcpt.get(int(p["tmk"])) if p.get("tmk") else None
        width, depth = dimensions_ft(g)
        bldg = p.get("bldgvalue") or 0

        out.append({
            "props": {
                "tmk": p.get("tmk_txt") or str(p.get("tmk")),
                "acres": round(p.get("taxacres") or g.area / SQM_PER_ACRE, 2),
                "w_ft": width,
                "d_ft": depth,
                "zone": zone,
                "land_val": p.get("landvalue"),
                "bldg_val": bldg,
                "status": "developed" if bldg > 0 else "unknown",
                "lava": lava.get("hzone"),
                "flood": flood.get("fld_zone"),
                "sfha": flood.get("sfha_tf") == "T",
                "tsunami": tsunami is not None,
                "sma": sma is not None,
                "fire": fire.get("risk_rating"),
                "fire_area": fire.get("commu_name"),
                "rain_in": round(rain) if rain is not None else None,
                "elev_ft": round(elev, -1) if elev is not None else None,
                "road": road_name,
                "road_m": round(road_dist),
                "road_owner": rm.get("OWNER") if rm else None,
                "road_maint": rm.get("MAINTAINER") if rm else None,
                "septic_soil": h.get("nrcs_septic_dominant") if h else None,
                "slope_deg": round(h["slope_deg"], 1) if h and h.get("slope_deg") is not None else None,
                "gw_depth_m": round(h["dep_to_water_m"]) if h and h.get("dep_to_water_m") is not None else None,
                "qpub": p.get("qpub_link"),
            },
            "geom": g,
        })

    # Share of nearby lots with buildings: a hint (not proof) that power and road access exist
    centroids = [o["geom"].centroid for o in out]
    c_tree = STRtree(centroids)
    for i, o in enumerate(out):
        near = [j for j in c_tree.query(centroids[i].buffer(NEIGHBOR_M)) if j != i]
        o["props"]["nbr_n"] = len(near)
        o["props"]["nbr_dev"] = sum(out[j]["props"]["status"] == "developed" for j in near)

    # Sample listings for the prototype: clearly flagged, never presented as real
    vacant = sorted((o for o in out if o["props"]["status"] == "unknown"), key=lambda o: stable_rank(o["props"]["tmk"]))
    for o in vacant[:N_SAMPLE_FOR_SALE]:
        o["props"].update(status="for_sale", sample=True)
    for o in vacant[N_SAMPLE_FOR_SALE:N_SAMPLE_FOR_SALE + N_SAMPLE_PENDING]:
        o["props"].update(status="pending", sample=True)

    feats = [
        {"type": "Feature", "id": i, "properties": o["props"], "geometry": round_coords(transform(to_ll, o["geom"].simplify(0.5)))}
        for i, o in enumerate(out)
    ]
    (OUT / "parcels.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")

    write_layer("lava", *layers["lava"][:2], keep=["hzone"], simplify_m=10)
    write_layer("zoning", *layers["zoning"][:2], keep=["zone"], simplify_m=2)
    write_layer("flood", *layers["flood"][:2], keep=["fld_zone", "sfha_tf"], simplify_m=5)
    write_layer("rainfall", *layers["rainfall"][:2], keep=["contour"], simplify_m=10)
    write_layer("roads", *layers["roads"][:2], keep=["fullname", "class"], simplify_m=1)
    write_layer("road_maint", rm_props, rm_geoms, keep=["FULLNAME", "OWNER", "MAINTAINER"], simplify_m=1)
    shutil.copy(ROOT / "data" / "zoning-rules.json", OUT / "zoning-rules.json")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    from collections import Counter
    print("parcels:", len(feats))
    print("status:", Counter(f["properties"]["status"] for f in feats))
    print("zones:", Counter(f["properties"]["zone"] for f in feats).most_common())
    print("lava:", Counter(f["properties"]["lava"] for f in feats))
    print("flood:", Counter(f["properties"]["flood"] for f in feats))
    print("fire:", Counter(f["properties"]["fire"] for f in feats))
    print("tsunami:", sum(f["properties"]["tsunami"] for f in feats), "sma:", sum(f["properties"]["sma"] for f in feats))
    rains = [f["properties"]["rain_in"] for f in feats if f["properties"]["rain_in"]]
    print("rain range:", min(rains), max(rains), "| rain isohyets:", sorted(r["contour"] for r in rain_props))
    print("with cesspool-tool data:", sum(1 for f in feats if f["properties"]["septic_soil"]))
    print("road maintainer:", Counter(f["properties"]["road_maint"] for f in feats).most_common())


if __name__ == "__main__":
    main()
