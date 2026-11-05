"""``ckan amconnect`` commands.

seed        create/update one CKAN dataset per layer in the drop folder + the harvest sources
harvest     run every registered harvest source synchronously (gather/fetch/import), for demos
extent      print the spatial extent GeoServer reports for a layer (what `seed` stores)

Mirrors geoserver/seed/seed.py: every ``<name>.geojson|gpkg|shp|tif`` in the drop
folder (mounted at ``ckanext.amconnect.data_dir``, default /amconnect-data) is
published by GeoServer as ``amconnect:<name>``.  ``seed`` creates or updates the
matching CKAN dataset, with metadata from the optional ``<name>.json`` sidecar:

    name                dataset slug (default: derived from <name>)
    title, notes        dataset title / description
    country, commodity, data_type, access_level   AMConnect fields
    spatial             GeoJSON geometry; default = extent derived from GeoServer's WMS GetCapabilities
    tags                list of tag names
    resource_name, resource_description           the WMS resource of this layer
    extra_resources     list of {name, description, url, format, layer_name} (external services / files)

External (federated) records without a local file: ``<data_dir>/external/<slug>.json`` with the
same keys plus ``resources`` (list of {name, description, url, format, layer_name}). The seed
creates a catalogue-only dataset pointing at the partner service (e.g. the CCOP GSi WMS).

Resource model written per hosted layer (see services.py):
    vector  ->  WMS resource (view) + WFS resource (query / download)
    raster  ->  WMS resource (view) + WCS resource (download)
Idempotent: re-running updates in place and keeps resource ids (matched by name).
"""
import glob
import json
import os
import re

import ckan.plugins.toolkit as tk
import click

from ckanext.amconnect import services

DATA_EXT = (".geojson", ".gpkg", ".shp", ".tif", ".tiff")
RASTER_EXT = (".tif", ".tiff")

ORG = {
    "name": "amconnect",
    "title": "AMConnect",
    "description": "Example organisation for the AMConnect POC",
}

# Federation test sources (see docker-compose.yml, demo/). Registered by
# `seed`, run by `harvest`.
HARVEST_SOURCES = (
    {
        "name": "mock-asean-ckan",
        "title": "Mock ASEAN member-state CKAN (CKAN-to-CKAN)",
        "url": "http://mock-ckan:5001",
        "source_type": "amconnect_ckan",
        "frequency": "MANUAL",
        "org": {
            "name": "asean-partner-catalogues",
            "title": "ASEAN partner catalogues",
            "description": "Owner of harvest sources; harvested datasets keep their remote organisation",
        },
        "config": {
            "remote_orgs": "create",
            "default_tags": [{"name": "harvested"}],
        },
        "notes": "Remote CKAN API served by the mock-ckan container (demo/mock-ckan).",
    },
    {
        "name": "mock-external-sdi-csw",
        "title": "Mock external SDI (CSW / ISO 19139 via pycsw)",
        "url": "http://pycsw:8000/csw",
        "source_type": "amconnect_csw",
        "frequency": "MANUAL",
        "org": {
            "name": "mock-sdi",
            "title": "Mock external SDI (CSW)",
            "description": "Stand-in for a CCOP / member-state SDI catalogue (pycsw container)",
        },
        "config": {},
        "notes": "CSW 2.0.2 endpoint served by the pycsw container (demo/pycsw).",
    },
)


def _sysadmin_name():
    import ckan.model as model

    admin = (
        model.Session.query(model.User)
        .filter_by(sysadmin=True, state="active")
        .first()
    )
    if not admin:
        raise click.ClickException(
            "No sysadmin user exists yet; create one first"
        )
    return admin.name


def _upsert(action_get, action_create, action_update, new_context, data):
    """new_context is a callable: CKAN needs a fresh context dict per action call."""
    try:
        existing = tk.get_action(action_get)(
            new_context(), {"id": data["name"]}
        )
    except tk.ObjectNotFound:
        existing = None
    if existing:
        data["id"] = existing["id"]
        # keep resource ids stable (matched by name) so their views survive
        by_name = {r["name"]: r["id"] for r in existing.get("resources", [])}
        for res in data.get("resources", []):
            if res["name"] in by_name:
                res["id"] = by_name[res["name"]]
        return tk.get_action(action_update)(new_context(), data), "updated"
    return tk.get_action(action_create)(new_context(), data), "created"


def _slug(text):
    return re.sub(r"[^a-z0-9-]+", "-", text.lower()).strip("-")[:100]


def _discover_external(data_dir):
    """[(slug, sidecar)] for every JSON in <data_dir>/external (no data file, resources given)."""
    found = []
    for path in sorted(
        glob.glob(os.path.join(data_dir, "external", "*.json"))
    ):
        with open(path) as fh:
            meta = json.load(fh)
        if meta.get("resources"):
            found.append(
                (meta.get("name") or _slug(os.path.basename(path)[:-5]), meta)
            )
    return found


def _external_dataset_dict(slug, meta, owner_org):
    resources = [
        {
            "name": r["name"],
            "description": r.get("description", ""),
            "url": r["url"],
            "format": r.get("format", "WMS"),
            "layer_name": r.get("layer_name", ""),
        }
        for r in meta["resources"]
    ]
    spatial = meta.get("spatial")
    return {
        "name": slug,
        "title": meta.get("title") or slug,
        "owner_org": owner_org,
        "notes": meta.get("notes", ""),
        "license_id": meta.get("license_id", "notspecified"),
        "country": meta.get("country", ""),
        "commodity": meta.get("commodity", ""),
        "data_type": meta.get("data_type", "geospatial"),
        "access_level": meta.get("access_level", "public-view"),
        "spatial": json.dumps(spatial) if spatial else "",
        "tags": [{"name": t} for t in meta.get("tags", [])],
        "resources": resources,
    }


def _discover(data_dir):
    """Return [(layer_name, is_raster, sidecar_dict)] for every data file in the folder."""
    found = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "*"))):
        low = path.lower()
        ext = next((e for e in DATA_EXT if low.endswith(e)), None)
        if not ext:
            continue
        name = os.path.basename(path)[: -len(ext)]
        meta = {}
        side = os.path.join(data_dir, name + ".json")
        if os.path.exists(side):
            with open(side) as fh:
                meta = json.load(fh)
        found[name] = (ext in RASTER_EXT, meta)
    return [(name, raster, meta) for name, (raster, meta) in found.items()]


def extent_from_geoserver(layer):
    """GeoJSON Polygon of the layer's WGS84 bounding box, read from WMS GetCapabilities."""
    info = services.probe_wms(services.hosted_service_url("wms"))
    if not info.get("ok"):
        return None, info.get("error")
    name = services._match_layer(info["layers"].keys(), layer)
    bbox = name and info["layers"][name].get("bbox")
    if not bbox:
        return None, "layer not in GetCapabilities"
    w, s, e, n = bbox
    return {
        "type": "Polygon",
        "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    }, None


def _dataset_dict(layer, is_raster, meta, owner_org):
    qualified = f"{services.geoserver_workspace()}:{layer}"
    # Resource order = map layer order (first at the bottom), so external
    # (often opaque, basemap-like) WMS resources go first, the local layer on top.
    resources = []
    for extra in meta.get("extra_resources", []):
        resources.append(
            {
                "name": extra["name"],
                "description": extra.get("description", ""),
                "url": extra["url"],
                "format": extra.get("format", "WMS"),
                "layer_name": extra.get("layer_name")
                or extra.get("wms_layer", ""),
            }
        )
    # service URLs carry the layer as a "#fragment" too: that is ckanext-geoview's convention
    # (its viewer has no layer field); our own code reads layer_name and strips the fragment.
    resources.append(
        {
            "name": meta.get("resource_name", f"{layer} (WMS)"),
            "description": meta.get(
                "resource_description",
                f"Layer {qualified} rendered by the POC GeoServer (WMS).",
            ),
            "url": f"{services.hosted_service_url('wms')}#{qualified}",
            "format": "WMS",
            "layer_name": qualified,
        }
    )
    if is_raster:
        resources.append(
            {
                "name": meta.get("wcs_resource_name", f"{layer} (WCS)"),
                "description": f"Coverage {qualified} on the POC GeoServer WCS: raster download (GeoTIFF) and clipping.",
                "url": services.hosted_service_url("wcs"),
                "format": "WCS",
                "layer_name": qualified,
            }
        )
    else:
        resources.append(
            {
                "name": meta.get("wfs_resource_name", f"{layer} (WFS)"),
                "description": f"Feature type {qualified} on the POC GeoServer WFS: attribute/bbox queries and "
                f"download as GeoJSON, GML, CSV or Shapefile.",
                "url": f"{services.hosted_service_url('wfs')}#{qualified}",
                "format": "WFS",
                "layer_name": qualified,
            }
        )
    spatial = meta.get("spatial")
    if not spatial:
        spatial, err = extent_from_geoserver(qualified)
        if err:
            click.echo(f"  warning: no spatial extent for {qualified} ({err})")
    return {
        "name": meta.get("name") or _slug(layer),
        "title": meta.get("title") or layer,
        "owner_org": owner_org,
        "notes": meta.get("notes", ""),
        "license_id": meta.get("license_id", "cc-by"),
        "country": meta.get("country", ""),
        "commodity": meta.get("commodity", ""),
        "data_type": meta.get("data_type", "geospatial"),
        "access_level": meta.get("access_level", "public-view"),
        "spatial": json.dumps(spatial) if spatial else "",
        "tags": [{"name": t} for t in meta.get("tags", [])],
        "resources": resources,
    }


def _ensure_views(pkg, ctx):
    """package_update does not add default views for pre-existing resources.

    Every OGC service resource gets the AMConnect GIS view; WMS/WFS resources also get a
    ckanext-geoview ``geo_view`` (when that plugin is enabled) so both viewers can be
    compared on the resource page. geoview reads the layer from the URL fragment.
    """
    import ckan.plugins as p

    want = [
        (
            "amconnect_wms_view",
            "Map preview",
            lambda r: services.is_ogc_service(r),
        )
    ]
    if p.plugin_loaded("geo_view"):
        want.append(
            (
                "geo_view",
                "geoview (reference)",
                lambda r: services.service_type_of(r) in ("wms", "wfs"),
            )
        )
    for res in pkg["resources"]:
        views = None
        for view_type, title, applies in want:
            if not applies(res):
                continue
            if views is None:
                views = tk.get_action("resource_view_list")(
                    ctx(), {"id": res["id"]}
                )
            if any(v["view_type"] == view_type for v in views):
                continue
            tk.get_action("resource_view_create")(
                ctx(),
                {
                    "resource_id": res["id"],
                    "view_type": view_type,
                    "title": title,
                },
            )
            click.echo(f"  added {view_type} to resource '{res['name']}'")


def _seed_harvest_sources(ctx):
    try:
        tk.get_action("harvest_source_show")
    except KeyError:
        click.echo("ckanext-harvest not enabled; skipping harvest sources")
        return
    for src in HARVEST_SOURCES:
        org, state = _upsert(
            "organization_show",
            "organization_create",
            "organization_update",
            ctx,
            dict(src["org"]),
        )
        data = {
            "name": src["name"],
            "title": src["title"],
            "url": src["url"],
            "source_type": src["source_type"],
            "frequency": src["frequency"],
            "active": True,
            "owner_org": org["id"],
            "notes": src["notes"],
            "config": json.dumps(src["config"]),
        }
        try:
            existing = tk.get_action("harvest_source_show")(
                ctx(), {"id": src["name"]}
            )
        except tk.ObjectNotFound:
            existing = None
        try:
            if existing:
                data["id"] = existing["id"]
                tk.get_action("harvest_source_update")(ctx(), data)
                state = "updated"
            else:
                tk.get_action("harvest_source_create")(ctx(), data)
                state = "created"
        except tk.ValidationError as e:
            click.echo(f"harvest source {src['name']}: FAILED {e.error_dict}")
            continue
        click.echo(
            f"harvest source {src['name']} ({src['source_type']} -> {src['url']}): {state}"
        )


@click.group(short_help="AMConnect POC commands")
def amconnect():
    pass


@amconnect.command()
@click.option(
    "--data-dir", default=None, help="Drop folder (default from config)"
)
@click.option(
    "--no-harvest-sources",
    is_flag=True,
    help="Do not register the demo harvest sources",
)
def seed(data_dir, no_harvest_sources):
    """Create/update one CKAN dataset per layer in the drop folder (+ harvest sources)."""
    config = tk.config
    data_dir = data_dir or config.get(
        "ckanext.amconnect.data_dir", "/amconnect-data"
    )
    owner_org = config.get("ckanext.amconnect.owner_org", ORG["name"])

    sysadmin = _sysadmin_name()

    def ctx():
        return {"user": sysadmin, "ignore_auth": True}

    _, state = _upsert(
        "organization_show",
        "organization_create",
        "organization_update",
        ctx,
        dict(ORG),
    )
    click.echo(f"organization {ORG['name']}: {state}")

    layers = _discover(data_dir)
    if not layers:
        click.echo(f"no data files found in {data_dir}; nothing to seed")
    services.clear_probe_cache()
    for layer, is_raster, meta in layers:
        pkg, state = _upsert(
            "package_show",
            "package_create",
            "package_update",
            ctx,
            _dataset_dict(layer, is_raster, meta, owner_org),
        )
        kind = "raster" if is_raster else "vector"
        click.echo(
            f"dataset {pkg['name']}: {state} ({len(pkg['resources'])} resources, {kind} layer "
            f"{services.geoserver_workspace()}:{layer}, spatial={'yes' if pkg.get('spatial') else 'no'})"
        )
        _ensure_views(pkg, ctx)
    for slug, meta in _discover_external(data_dir):
        pkg, state = _upsert(
            "package_show",
            "package_create",
            "package_update",
            ctx,
            _external_dataset_dict(slug, meta, owner_org),
        )
        click.echo(
            f"dataset {pkg['name']}: {state} (external, {len(pkg['resources'])} resources)"
        )
        _ensure_views(pkg, ctx)
    if not no_harvest_sources:
        _seed_harvest_sources(ctx)


def _wait_for_source(url, attempts=12, delay=5):
    """At `docker compose up` the mock sources may still be loading; give them a minute."""
    import time

    import requests

    for i in range(attempts):
        try:
            if requests.get(url, timeout=5).status_code < 500:
                return True
        except requests.RequestException:
            pass
        click.echo(f"   waiting for {url} ({i + 1}/{attempts})")
        time.sleep(delay)
    return False


@amconnect.command()
@click.argument("source", required=False)
def harvest(source):
    """Run the harvest sources synchronously: gather -> fetch -> import, without queue consumers.

    Same steps as `ckan harvester run-test` (which needs the test extras pytest/factory-boy),
    so it works in the runtime image. Production would run `ckan harvester run` from cron plus
    the gather/fetch consumers; see README "Harvesting".
    """
    from ckanext.harvest import model as hmodel
    from ckanext.harvest import queue

    names = [source] if source else [s["name"] for s in HARVEST_SOURCES]
    ctx = {"user": _sysadmin_name(), "ignore_auth": True}
    for name in names:
        click.echo(f"== harvesting {name}")
        try:
            src = tk.get_action("harvest_source_show")(dict(ctx), {"id": name})
            _wait_for_source(src["url"])
            # abort any job left "Running" by an interrupted earlier run
            for j in tk.get_action("harvest_job_list")(
                dict(ctx), {"source_id": src["id"], "status": "Running"}
            ):
                tk.get_action("harvest_job_abort")(dict(ctx), {"id": j["id"]})
            job_dict = tk.get_action("harvest_job_create")(
                dict(ctx), {"source_id": src["id"], "run": False}
            )
            job = hmodel.HarvestJob.get(job_dict["id"])
            job.status = "Running"
            job.save()
            harvester = queue.get_harvester(src["source_type"])
            obj_ids = queue.gather_stage(harvester, job) or []
            click.echo(f"   gather: {len(obj_ids)} object(s)")
            for oid in obj_ids:
                obj = hmodel.HarvestObject.get(oid)
                queue.fetch_and_import_stages(harvester, obj)
                errors = (
                    "; ".join(e.message for e in obj.errors)
                    if obj.errors
                    else ""
                )
                click.echo(
                    f"   {obj.guid}: {obj.state} {obj.report_status or ''} {errors}"
                )
            try:
                tk.get_action("harvest_jobs_run")(
                    dict(ctx), {"source_id": src["id"]}
                )
            except KeyError as e:
                # ckanext-harvest 1.6.2 + CKAN 2.11: harvest_source_reindex trips over
                # default_extras_schema's ignore_not_sysadmin (KeyError ('extras', 0, 'id')).
                # The job is already saved as Finished at that point; only the harvest-source
                # dataset's own search-index entry is not refreshed. See README "Known limitations".
                click.echo(
                    f"   note: harvest_source_reindex failed ({e!r}); known ckanext-harvest/CKAN 2.11 issue, job still finished"
                )
            job = hmodel.HarvestJob.get(job_dict["id"])
            click.echo(f"   job {job.id[:8]} -> {job.status}")
        except Exception as e:  # noqa: BLE001
            import traceback

            click.echo(
                f"harvest {name} FAILED: {e!r}\n{traceback.format_exc()}"
            )


@amconnect.command()
@click.argument("layer")
def extent(layer):
    """Print the GeoJSON extent GeoServer reports for LAYER (e.g. amconnect:thailand_geology)."""
    geom, err = extent_from_geoserver(layer)
    click.echo(json.dumps(geom) if geom else f"error: {err}")
