#!/usr/bin/env python3
"""Publish everything in the drop folder to GeoServer.

Runs from the `geoserver-seed` compose service (GDAL image: ogr2ogr + python3,
no extra pip deps) at stack start (demo profile).  Idempotent.

Drop folder convention (/data, i.e. ./demo/geoserver-data on the host):

  <name>.geojson | .gpkg | .shp   vector  -> ogr2ogr into PostGIS -> feature type
  <name>.tif | .tiff              raster  -> uploaded to GeoServer  -> coverage
  <name>.json                     optional sidecar: "title", "notes" (abstract)
                                  plus CKAN fields; read by `ckan amconnect seed`
  /styles/<name>.sld              optional style applied as the layer default
  /styles/<name>__<style>.sld     optional alternate styles (WMS STYLES=<name>_<style>), e.g.
                                  thailand_mineral_sites__status.sld -> style thailand_mineral_sites_status

The published layer is always  amconnect:<name>.
Set FORCE=1 to re-upload rasters whose coverage store already exists.
"""
import base64
import glob
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

GS = os.environ.get("GEOSERVER_URL", "http://geoserver:8080/geoserver").rstrip("/")
GS_USER = os.environ.get("GEOSERVER_ADMIN_USER", "admin")
GS_PASS = os.environ.get("GEOSERVER_ADMIN_PASSWORD", "geoserver")

PG_HOST = os.environ.get("POSTGIS_HOST", "postgis")
PG_PORT = os.environ.get("POSTGIS_PORT", "5432")
PG_DB = os.environ.get("POSTGIS_DB", "gis")
PG_USER = os.environ.get("POSTGIS_USER", "gis")
PG_PASS = os.environ.get("POSTGIS_PASSWORD", "gis")

WORKSPACE = "amconnect"
DATASTORE = "amconnect_postgis"
DATA_DIR = os.environ.get("DATA_DIR", "/data")
STYLE_DIR = os.environ.get("STYLE_DIR", "/styles")
FORCE = os.environ.get("FORCE", "") not in ("", "0", "false")

VECTOR_EXT = (".geojson", ".json.geojson", ".gpkg", ".shp")
RASTER_EXT = (".tif", ".tiff")

AUTH = "Basic " + base64.b64encode(f"{GS_USER}:{GS_PASS}".encode()).decode()


# ----------------------------------------------------------------- helpers
def rest(method, path, body=None, content_type="application/json", expect=(200, 201)):
    url = f"{GS}/rest{path}"
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", AUTH)
    req.add_header("Content-Type", content_type)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        if e.code in expect:
            return e.code, e.read()
        body_txt = e.read().decode(errors="replace")[:500]
        raise SystemExit(f"{method} {path} -> HTTP {e.code}: {body_txt}")


def exists(path):
    status, _ = rest("GET", path, expect=(200, 404))
    return status == 200


def wait_for(name, fn, attempts=60, delay=5):
    for i in range(attempts):
        try:
            if fn():
                print(f"[seed] {name} is ready")
                return
        except Exception as e:  # noqa: BLE001
            last = e
        else:
            last = None
        print(f"[seed] waiting for {name} ({i + 1}/{attempts}) {last or ''}")
        time.sleep(delay)
    raise SystemExit(f"[seed] {name} never became ready")


def geoserver_ready():
    status, _ = rest("GET", "/about/version.json", expect=(200,))
    return status == 200


def pg_conn():
    return f"PG:host={PG_HOST} port={PG_PORT} dbname={PG_DB} user={PG_USER} password={PG_PASS}"


def postgis_ready():
    out = subprocess.run(["ogrinfo", "-q", "-so", pg_conn(), "-sql", "SELECT postgis_version()"],
                         capture_output=True, text=True)
    return out.returncode == 0


def sidecar(name):
    path = os.path.join(DATA_DIR, name + ".json")
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return {}


def layer_name(path):
    base = os.path.basename(path)
    return base[:-len(next(e for e in VECTOR_EXT + RASTER_EXT if base.lower().endswith(e)))]


def discover():
    vectors, rasters = [], []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "*"))):
        low = path.lower()
        if low.endswith(VECTOR_EXT):
            vectors.append(path)
        elif low.endswith(RASTER_EXT):
            rasters.append(path)
    return vectors, rasters


# --------------------------------------------------------------- workspace
def ensure_workspace_and_datastore():
    if not exists(f"/workspaces/{WORKSPACE}.json"):
        rest("POST", "/workspaces", {"workspace": {"name": WORKSPACE}})
        print(f"[seed] created workspace {WORKSPACE}")

    ds_path = f"/workspaces/{WORKSPACE}/datastores/{DATASTORE}"
    ds_body = {"dataStore": {
        "name": DATASTORE, "type": "PostGIS", "enabled": True,
        "connectionParameters": {"entry": [
            {"@key": "dbtype", "$": "postgis"},
            {"@key": "host", "$": PG_HOST}, {"@key": "port", "$": PG_PORT},
            {"@key": "database", "$": PG_DB}, {"@key": "schema", "$": "public"},
            {"@key": "user", "$": PG_USER}, {"@key": "passwd", "$": PG_PASS},
            {"@key": "Expose primary keys", "$": "true"},
        ]}}}
    if exists(ds_path + ".json"):
        rest("PUT", ds_path + ".json", ds_body)
    else:
        rest("POST", f"/workspaces/{WORKSPACE}/datastores", ds_body)
        print(f"[seed] created datastore {DATASTORE}")


# ------------------------------------------------------------------ vector
def publish_vector(path):
    name = layer_name(path)
    meta = sidecar(name)
    print(f"[seed] vector {os.path.basename(path)} -> PostGIS table {name}")
    subprocess.check_call([
        "ogr2ogr", "-f", "PostgreSQL", pg_conn(), path,
        "-nln", name, "-overwrite", "-t_srs", "EPSG:4326",
        "-lco", "GEOMETRY_NAME=geom", "-lco", "FID=gid", "-nlt", "PROMOTE_TO_MULTI",
    ])
    ds_path = f"/workspaces/{WORKSPACE}/datastores/{DATASTORE}"
    ft_path = f"{ds_path}/featuretypes/{name}"
    ft_body = {"featureType": {
        "name": name, "nativeName": name,
        "title": meta.get("title", name), "abstract": meta.get("notes", ""),
        "srs": "EPSG:4326", "enabled": True}}
    if exists(ft_path + ".json"):
        rest("PUT", ft_path + ".json", ft_body)
        print(f"[seed]   feature type {name} updated")
    else:
        rest("POST", f"{ds_path}/featuretypes", ft_body)
        print(f"[seed]   feature type {name} published")
    apply_style(name)


# ------------------------------------------------------------------ raster
def publish_raster(path):
    name = layer_name(path)
    meta = sidecar(name)
    cs_path = f"/workspaces/{WORKSPACE}/coveragestores/{name}"
    if exists(cs_path + ".json") and not FORCE:
        print(f"[seed] raster {os.path.basename(path)}: coverage store exists, skipping upload (FORCE=1 to redo)")
    else:
        print(f"[seed] raster {os.path.basename(path)} -> uploading to coverage store {name}")
        with open(path, "rb") as fh:
            data = fh.read()
        # PUT .../file.geotiff uploads the file into the GeoServer data dir and
        # creates store + coverage + layer in one go.
        rest("PUT", f"{cs_path}/file.geotiff?configure=first&coverageName={name}",
             data, content_type="image/tiff")
        print(f"[seed]   coverage {name} published ({len(data)} bytes)")
    cov_path = f"{cs_path}/coverages/{name}.json"
    if exists(cov_path):
        rest("PUT", cov_path, {"coverage": {
            "title": meta.get("title", name), "abstract": meta.get("notes", ""), "enabled": True}})
    apply_style(name)


# ------------------------------------------------------------------- style
def upload_style(style_name, sld_file):
    with open(sld_file, "rb") as fh:
        sld = fh.read()
    style_path = f"/workspaces/{WORKSPACE}/styles/{style_name}"
    if exists(style_path + ".json"):
        rest("PUT", style_path + ".sld", sld, content_type="application/vnd.ogc.sld+xml")
    else:
        rest("POST", f"/workspaces/{WORKSPACE}/styles?name={style_name}", sld,
             content_type="application/vnd.ogc.sld+xml")


def apply_style(name):
    """<name>.sld -> default style; <name>__<variant>.sld -> alternate styles (WMS STYLES=)."""
    layer = {}
    sld_file = os.path.join(STYLE_DIR, name + ".sld")
    if os.path.exists(sld_file):
        upload_style(name, sld_file)
        layer["defaultStyle"] = {"name": f"{WORKSPACE}:{name}"}
        print(f"[seed]   style {name}.sld applied")
    alternates = []
    for path in sorted(glob.glob(os.path.join(STYLE_DIR, name + "__*.sld"))):
        variant = os.path.basename(path)[len(name) + 2:-4]
        style_name = f"{name}_{variant}"
        upload_style(style_name, path)
        alternates.append({"name": f"{WORKSPACE}:{style_name}"})
        print(f"[seed]   alternate style {style_name} applied")
    if alternates:
        layer["styles"] = {"style": alternates}
    if layer:
        rest("PUT", f"/layers/{WORKSPACE}:{name}.json", {"layer": layer})


# -------------------------------------------------------------- smoke test
def smoke_test(name):
    url = (f"{GS}/{WORKSPACE}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
           f"&LAYERS={WORKSPACE}:{name}&STYLES=&SRS=EPSG:4326&BBOX=97,5,106,21"
           f"&WIDTH=128&HEIGHT=128&FORMAT=image/png")
    with urllib.request.urlopen(url, timeout=120) as resp:
        ctype = resp.headers.get("Content-Type", "")
        size = len(resp.read())
    if not ctype.startswith("image/png"):
        raise SystemExit(f"[seed] GetMap smoke test failed for {name}: {ctype}")
    print(f"[seed] GetMap OK for {WORKSPACE}:{name} ({size} bytes)")


if __name__ == "__main__":
    vectors, rasters = discover()
    if not vectors and not rasters:
        print(f"[seed] nothing to publish in {DATA_DIR}")
        sys.exit(0)
    wait_for("GeoServer", geoserver_ready)
    ensure_workspace_and_datastore()
    if vectors:
        wait_for("PostGIS", postgis_ready)
        for path in vectors:
            publish_vector(path)
    for path in rasters:
        publish_raster(path)
    for path in vectors + rasters:
        smoke_test(layer_name(path))
    print(f"[seed] done. WMS endpoint: {GS}/{WORKSPACE}/wms")
