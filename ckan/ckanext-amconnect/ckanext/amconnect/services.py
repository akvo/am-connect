"""Service / capability model for geospatial resources.

This is the single place that turns CKAN resources into an AMConnect-oriented
description a frontend can act on:

    resource (CKAN)  ->  describe_resource()  ->  {service_type, endpoint, layer_name,
                                                   origin, capabilities, downloads, ...}
    dataset  (CKAN)  ->  describe_dataset()   ->  {..., layers: [grouped services], ...}

Design rules (see README "Resource/service modelling"):

* A CKAN resource is one *service or file*: ``format`` says which (WMS / WFS /
  WCS / GeoJSON / GeoTIFF / CSV / PDF ...), ``url`` is the service endpoint or the
  file, and the optional ``layer_name`` extra names the OGC layer / feature type /
  coverage.  Nothing else is invented: CKAN's own fields carry the rest
  (organisation, tags, licence, ``access_level`` dataset extra).
* Several resources of one dataset that point at the same layer are *one layer
  with several services*; ``describe_dataset`` groups them.
* "hosted" vs "federated" is derived from the service URL (is it our
  GeoServer?) and from ckanext-harvest's ``harvest_*`` extras, never stored.
* Capabilities come from two places: CKAN metadata says *which services exist*,
  a (cached) GetCapabilities probe of the service says *what they really
  support*: does the layer exist, is it queryable, which output formats, which
  extent.  The frontend only shows buttons for capabilities that are true.

The probes use OWSLib (already installed for ckanext-spatial) on the *internal*
GeoServer URL when the resource points at the public one, so CKAN can probe
inside the Docker network while browsers keep using the public URL.
"""

import logging
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import ckan.plugins.toolkit as tk
import requests

log = logging.getLogger(__name__)

OGC_SERVICE_TYPES = ("wms", "wfs", "wcs", "wmts")
# formats that mean "a file you can download"; anything else with a URL is a link
DOWNLOAD_FILE_FORMATS = {
    "geojson",
    "json",
    "geotiff",
    "tiff",
    "tif",
    "cog",
    "csv",
    "pdf",
    "zip",
    "shp",
    "shapefile",
    "gpkg",
    "geopackage",
    "kml",
    "kmz",
    "gml",
    "xlsx",
    "xls",
    "txt",
    "png",
    "jpeg",
    "jpg",
}
RASTER_FILE_FORMATS = {"geotiff", "tiff", "tif", "cog"}
VECTOR_FILE_FORMATS = {
    "geojson",
    "shp",
    "shapefile",
    "gpkg",
    "geopackage",
    "kml",
    "kmz",
    "gml",
    "zip",
}
OGC_QUERY_KEYS = {
    "service",
    "request",
    "version",
    "layers",
    "styles",
    "format",
    "bbox",
    "width",
    "height",
    "srs",
    "crs",
    "transparent",
    "typename",
    "typenames",
    "outputformat",
    "coverageid",
    "layer",
}

# WFS output formats we know how to offer as downloads: (label, file extension, media type)
WFS_DOWNLOADS = (
    (
        "GeoJSON",
        ("application/json", "json"),
        "geojson",
        "application/geo+json",
    ),
    (
        "GML",
        ("gml32", "application/gml+xml; version=3.2", "gml3", "GML2"),
        "gml",
        "application/gml+xml",
    ),
    ("CSV", ("csv", "text/csv"), "csv", "text/csv"),
    ("Shapefile (zip)", ("SHAPE-ZIP",), "zip", "application/zip"),
    (
        "KML",
        ("application/vnd.google-earth.kml+xml", "KML"),
        "kml",
        "application/vnd.google-earth.kml+xml",
    ),
)
WCS_DOWNLOADS = (
    (
        "GeoTIFF",
        ("image/tiff", "image/tiff;application=geotiff", "GEOTIFF", "geotiff"),
        "tif",
        "image/tiff",
    ),
    ("PNG (rendered pixels)", ("image/png",), "png", "image/png"),
)
CAPABILITY_KEYS = (
    "view",
    "identify",
    "query",
    "download_vector",
    "download_raster",
    "area_statistics",
    "feature_query",
    "export_map_image",
    "federated",
)

PROBE_TTL = 300  # seconds
PROBE_TIMEOUT = 8  # seconds per remote request
# (user, password) for GetCapabilities probes. Set only by the `seed` CLI command:
# hosted layers need geoserver-access, and the web process must not see restricted ones.
PROBE_AUTH = None
_cache = {}
_cache_lock = threading.Lock()


# ----------------------------------------------------------------- config
def geoserver_public_url():
    url = tk.config.get("ckanext.amconnect.geoserver_public_url")
    if not url:
        # backwards compatible with the first POC config key (.../amconnect/wms)
        wms = tk.config.get(
            "ckanext.amconnect.geoserver_wms_url",
            "http://localhost:8080/geoserver/amconnect/wms",
        )
        url = re.sub(r"/[^/]+/wms/?$", "", wms)
    return url.rstrip("/")


def geoserver_internal_url():
    return (
        tk.config.get("ckanext.amconnect.geoserver_internal_url")
        or geoserver_public_url()
    ).rstrip("/")


def geoserver_workspace():
    return tk.config.get("ckanext.amconnect.geoserver_workspace", "amconnect")


def hosted_service_url(service):
    """Browser-facing endpoint of one of our GeoServer services: wms|wfs|wcs."""
    return f"{geoserver_public_url()}/{geoserver_workspace()}/{service}"


def to_internal_url(url):
    """Rewrite a public GeoServer URL to the one reachable from inside the CKAN container."""
    pub, internal = geoserver_public_url(), geoserver_internal_url()
    if pub and url.startswith(pub):
        return internal + url[len(pub) :]
    return url


def to_public_url(url):
    """Reverse of to_internal_url: capabilities fetched internally advertise the internal host."""
    pub, internal = geoserver_public_url(), geoserver_internal_url()
    if url and internal and url.startswith(internal):
        return pub + url[len(internal) :]
    return url


def is_hosted_url(url):
    url = url or ""
    return bool(url) and (
        url.startswith(geoserver_public_url())
        or url.startswith(geoserver_internal_url())
    )


# --------------------------------------------------------------- resources
def service_type_of(resource):
    fmt = (resource.get("format") or "").strip().lower()
    if fmt in OGC_SERVICE_TYPES:
        return fmt
    url = (resource.get("url") or "").lower()
    for svc in OGC_SERVICE_TYPES:
        if f"service={svc}" in url:
            return svc
    if fmt in ("api", "rest", "json-api", "ogcapi", "ogc api - features"):
        return "api"
    if fmt in DOWNLOAD_FILE_FORMATS:
        return "file"
    return "link"


def is_ogc_service(resource):
    return service_type_of(resource) in OGC_SERVICE_TYPES


def base_url(url):
    """Service endpoint without OGC query parameters and without the ``#layer`` fragment."""
    parts = urlsplit(url or "")
    keep = []
    for key, values in parse_qs(parts.query, keep_blank_values=True).items():
        if key.lower() in OGC_QUERY_KEYS:
            continue
        for v in values:
            keep.append((key, v))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(keep), "")
    )


def layer_for(resource, override=None):
    """The OGC layer / feature type / coverage name of a service resource.

    Looked up in this order so that resources created by different tools all work:
      1. ``layer_name`` resource field (AMConnect convention)
      2. ``wms_layer`` (first POC field name, kept for compatibility)
      3. ``url#layer`` fragment (ckanext-geoview convention, also what our CSW test records use)
      4. ``LAYERS=`` / ``typeNames=`` / ``coverageId=`` query parameter in the URL
      5. a resource *name* that looks like ``workspace:layer`` (ISO/CSW harvested records
         put the online-resource name there)
    """
    if override:
        return override
    for key in ("layer_name", "wms_layer"):
        if resource.get(key):
            return resource[key].strip()
    parts = urlsplit(resource.get("url") or "")
    if parts.fragment:
        return parts.fragment.strip()
    for key, values in parse_qs(parts.query).items():
        if (
            key.lower() in ("layers", "typename", "typenames", "coverageid")
            and values
        ):
            return values[0]
    name = (resource.get("name") or "").strip()
    if re.match(r"^[A-Za-z_][\w.-]*:[\w.-]+$", name):
        return name
    return ""


def origin_of_resource(resource):
    return "hosted" if is_hosted_url(resource.get("url")) else "federated"


def harvest_info(pkg):
    """ckanext-harvest adds harvest_object_id / harvest_source_id / harvest_source_title extras."""
    extras = {
        e["key"]: e["value"]
        for e in pkg.get("extras", [])
        if isinstance(e, dict)
    }
    if not extras.get("harvest_object_id"):
        return None
    info = {
        "object_id": extras["harvest_object_id"],
        "source_id": extras.get("harvest_source_id"),
        "source_title": extras.get("harvest_source_title"),
    }
    try:
        src = tk.get_action("harvest_source_show")(
            {"ignore_auth": True}, {"id": info["source_id"]}
        )
        info.update(
            {
                "source_url": src.get("url"),
                "source_type": src.get("source_type"),
                "frequency": src.get("frequency"),
            }
        )
    except Exception:  # noqa: BLE001 - harvest plugin missing or source deleted
        pass
    return info


# ------------------------------------------------------------------ probes
def _cached(key, fn):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = fn()
    with _cache_lock:
        _cache[key] = (now + PROBE_TTL, value)
    return value


def clear_probe_cache():
    with _cache_lock:
        _cache.clear()


def _get_capabilities(endpoint, service, version):
    url = to_internal_url(endpoint)
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}service={service}&version={version}&request=GetCapabilities"
    resp = requests.get(
        full,
        timeout=PROBE_TIMEOUT,
        auth=PROBE_AUTH,
        headers={
            "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; AMConnect-CKAN/0.2; +ckanext-amconnect)",
        },
    )
    resp.raise_for_status()
    cors = resp.headers.get("Access-Control-Allow-Origin")
    return resp.content, cors


def _match_layer(names, layer):
    """GeoServer workspace endpoints advertise 'name' while resources say 'ws:name'."""
    if not layer:
        return None
    short = layer.split(":")[-1]
    for n in names:
        if n == layer or n == short or n.split(":")[-1] == short:
            return n
    return None


def probe_wms(endpoint):
    def run():
        from owslib.wms import WebMapService

        try:
            xml, cors = _get_capabilities(endpoint, "WMS", "1.3.0")
            wms = WebMapService(endpoint, version="1.3.0", xml=xml)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": _short(e), "layers": {}}
        layers = {}
        for name, layer in wms.contents.items():
            legend = None
            styles = []
            for sname, style in (layer.styles or {}).items():
                legend = legend or style.get("legend")
                styles.append(
                    {
                        "name": sname,
                        "title": style.get("title") or sname,
                        "legend_url": to_public_url(style.get("legend"))
                        if style.get("legend")
                        else legend_url(endpoint, name, sname),
                    }
                )
            layers[name] = {
                "title": layer.title,
                "bbox": _bbox(layer.boundingBoxWGS84),
                "queryable": bool(layer.queryable),
                "legend_url": to_public_url(legend),
                "styles": styles,  # first = default style; WMS STYLES=<name> selects another
            }
        fmts = []
        try:
            fmts = wms.getOperationByName("GetFeatureInfo").formatOptions
        except Exception:  # noqa: BLE001
            pass
        return {
            "ok": True,
            "cors": cors,
            "layers": layers,
            "info_formats": fmts,
            "title": getattr(wms.identification, "title", None),
        }

    return _cached(("wms", endpoint), run)


def probe_wfs(endpoint):
    def run():
        from owslib.wfs import WebFeatureService

        try:
            xml, cors = _get_capabilities(endpoint, "WFS", "2.0.0")
            wfs = WebFeatureService(endpoint, version="2.0.0", xml=xml)
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "error": _short(e),
                "typenames": {},
                "output_formats": [],
            }
        fmts = []
        try:
            fmts = (
                wfs.getOperationByName("GetFeature")
                .parameters.get("outputFormat", {})
                .get("values", [])
            )
        except Exception:  # noqa: BLE001
            pass
        types = {
            n: {"title": t.title, "bbox": _bbox(t.boundingBoxWGS84)}
            for n, t in wfs.contents.items()
        }
        return {
            "ok": True,
            "cors": cors,
            "typenames": types,
            "output_formats": fmts,
        }

    return _cached(("wfs", endpoint), run)


def probe_wcs(endpoint):
    def run():
        from owslib.wcs import WebCoverageService

        try:
            xml, cors = _get_capabilities(endpoint, "WCS", "2.0.1")
            wcs = WebCoverageService(endpoint, version="2.0.1", xml=xml)
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "error": _short(e),
                "coverages": [],
                "formats": [],
            }
        # WCS 2.0.1 advertises output formats in wcs:ServiceMetadata/wcs:formatSupported;
        # OWSLib's operation.formatOptions only holds the request encoding (text/xml).
        fmts = re.findall(
            r"<wcs:formatSupported>([^<]+)</wcs:formatSupported>",
            xml.decode(errors="replace"),
        )
        if not fmts:
            try:
                fmts = list(
                    wcs.getOperationByName("GetCoverage").formatOptions or []
                )
            except Exception:  # noqa: BLE001
                pass
        return {
            "ok": True,
            "cors": cors,
            "coverages": list(wcs.contents.keys()),
            "formats": fmts,
        }

    return _cached(("wcs", endpoint), run)


def _bbox(b):
    try:
        return [round(float(v), 6) for v in b] if b else None
    except (TypeError, ValueError):
        return None


def _short(e):
    return (str(e) or e.__class__.__name__)[:200]


def _pick_formats(advertised, table):
    """Intersect the formats a server advertises with the ones we can offer."""
    adv = {a.lower() for a in advertised}
    out = []
    for label, candidates, ext, media in table:
        chosen = next((c for c in candidates if c.lower() in adv), None)
        if chosen:
            out.append((label, chosen, ext, media))
    return out


# --------------------------------------------------------------- describe
def describe_resource(resource, pkg=None, probe=True):
    """AMConnect description of one CKAN resource (see module docstring)."""
    svc = service_type_of(resource)
    url = resource.get("url") or ""
    desc = {
        "id": resource.get("id"),
        "name": resource.get("name") or resource.get("id"),
        "description": resource.get("description") or "",
        "format": resource.get("format") or "",
        "url": url,
        "service_type": svc,
        "endpoint": base_url(url) if svc in OGC_SERVICE_TYPES else url,
        "layer_name": layer_for(resource)
        if svc in OGC_SERVICE_TYPES
        else None,
        "origin": origin_of_resource(resource),
        "status": "not_probed",
        "status_detail": None,
        "cors": None,
        "extent": None,
        "legend_url": None,
        "queryable": None,
        "formats": [],
        "styles": [],
        "capabilities": {k: False for k in CAPABILITY_KEYS},
        "downloads": [],
        "export_map_image": None,
    }
    caps = desc["capabilities"]
    caps["federated"] = desc["origin"] == "federated"
    endpoint, layer = desc["endpoint"], desc["layer_name"]

    if svc == "wms":
        caps["view"] = (
            True  # the browser can always try GetMap; the probe refines the rest
        )
        if probe:
            info = probe_wms(endpoint)
            desc["cors"] = info.get("cors")
            if not info["ok"]:
                desc["status"], desc["status_detail"] = (
                    "unreachable",
                    info["error"],
                )
            else:
                match = _match_layer(info["layers"].keys(), layer)
                if not match:
                    desc["status"], desc["status_detail"] = (
                        "layer_not_found",
                        f"{layer!r} not in GetCapabilities",
                    )
                else:
                    ld = info["layers"][match]
                    desc.update(
                        {
                            "status": "ok",
                            "extent": ld["bbox"],
                            "queryable": ld["queryable"],
                            "legend_url": ld["legend_url"]
                            or legend_url(endpoint, layer),
                            "styles": ld["styles"],
                            "formats": info.get("info_formats", []),
                        }
                    )
                    caps["identify"] = ld["queryable"]
                    if ld["bbox"]:
                        caps["export_map_image"] = True
                        desc["export_map_image"] = getmap_url(
                            endpoint, layer, ld["bbox"]
                        )
    elif svc == "wfs":
        caps["query"] = caps["feature_query"] = True
        if probe:
            info = probe_wfs(endpoint)
            desc["cors"] = info.get("cors")
            if not info["ok"]:
                desc["status"], desc["status_detail"] = (
                    "unreachable",
                    info["error"],
                )
                caps["query"] = caps["feature_query"] = False
            else:
                match = _match_layer(info["typenames"].keys(), layer)
                if not match:
                    desc["status"], desc["status_detail"] = (
                        "layer_not_found",
                        f"{layer!r} not in GetCapabilities",
                    )
                    caps["query"] = caps["feature_query"] = False
                else:
                    desc["status"] = "ok"
                    desc["extent"] = info["typenames"][match]["bbox"]
                    desc["formats"] = info["output_formats"]
                    for label, fmt, ext, media in _pick_formats(
                        info["output_formats"], WFS_DOWNLOADS
                    ):
                        desc["downloads"].append(
                            {
                                "label": label,
                                "format": label.split(" ")[0],
                                "extension": ext,
                                "media_type": media,
                                "service": "wfs",
                                "url": wfs_download_url(
                                    endpoint,
                                    match if ":" in match else layer,
                                    fmt,
                                ),
                            }
                        )
                    caps["download_vector"] = bool(desc["downloads"])
                    # browser-side bbox statistics need the WFS to answer cross-origin requests
                    caps["area_statistics"] = desc[
                        "origin"
                    ] == "hosted" or bool(desc["cors"])
    elif svc == "wcs":
        caps["download_raster"] = True
        if probe:
            info = probe_wcs(endpoint)
            desc["cors"] = info.get("cors")
            if not info["ok"]:
                desc["status"], desc["status_detail"] = (
                    "unreachable",
                    info["error"],
                )
                caps["download_raster"] = False
            else:
                cov_id = (layer or "").replace(":", "__")
                match = (
                    cov_id
                    if cov_id in info["coverages"]
                    else _match_layer(info["coverages"], layer)
                )
                if not match:
                    desc["status"], desc["status_detail"] = (
                        "layer_not_found",
                        f"{cov_id!r} not in GetCapabilities",
                    )
                    caps["download_raster"] = False
                else:
                    desc["status"] = "ok"
                    desc["formats"] = info["formats"]
                    for label, fmt, ext, media in _pick_formats(
                        info["formats"], WCS_DOWNLOADS
                    ):
                        desc["downloads"].append(
                            {
                                "label": label,
                                "format": label.split(" ")[0],
                                "extension": ext,
                                "media_type": media,
                                "service": "wcs",
                                "url": wcs_download_url(endpoint, match, fmt),
                            }
                        )
                    # "native": no format parameter -> GeoServer returns the coverage's own format
                    desc["downloads"].append(
                        {
                            "label": "Native format (no conversion)",
                            "format": "native",
                            "extension": None,
                            "media_type": None,
                            "service": "wcs",
                            "url": wcs_download_url(endpoint, match, None),
                        }
                    )
                    caps["download_raster"] = True
                    caps["area_statistics"] = desc[
                        "origin"
                    ] == "hosted" or bool(desc["cors"])
    elif svc == "wmts":
        caps["view"] = True
        desc["status"] = "not_probed"
    elif svc == "file":
        fmt = (resource.get("format") or "").lower()
        desc["status"] = "ok"
        desc["downloads"].append(
            {
                "label": f"Download {resource.get('format')}",
                "format": resource.get("format"),
                "extension": None,
                "media_type": resource.get("mimetype"),
                "service": "file",
                "url": url,
            }
        )
        caps["download_raster"] = fmt in RASTER_FILE_FORMATS
        caps["download_vector"] = fmt in VECTOR_FILE_FORMATS
    else:  # api / link: nothing to derive
        desc["status"] = "ok"
    return desc


def describe_dataset(pkg, probe=True):
    """AMConnect-oriented view of a dataset: flat metadata + grouped layers/services."""
    resources = [
        describe_resource(r, pkg, probe=probe)
        for r in pkg.get("resources", [])
    ]
    layers = group_layers(resources)
    harvest = harvest_info(pkg)
    svc_origins = {
        r["origin"]
        for r in resources
        if r["service_type"] in OGC_SERVICE_TYPES
    }
    # dataset origin: harvested records are federated by definition; otherwise a dataset is
    # "hosted" when at least one of its services runs on our GeoServer (an extra external
    # basemap layer does not make the dataset federated), else federated.
    if harvest:
        origin = "federated"
    elif "hosted" in svc_origins or not svc_origins:
        origin = "hosted"
    else:
        origin = "federated"
    spatial = _parse_spatial(pkg)
    site = tk.config.get("ckan.site_url", "").rstrip("/")
    org = pkg.get("organization") or {}
    return {
        "id": pkg["id"],
        "name": pkg["name"],
        "title": pkg.get("title"),
        "description": pkg.get("notes") or "",
        "organization": {"name": org.get("name"), "title": org.get("title")}
        if org
        else None,
        "tags": [t["name"] for t in pkg.get("tags", [])],
        "country": pkg.get("country"),
        "commodity": pkg.get("commodity"),
        "data_type": pkg.get("data_type"),
        "access_level": pkg.get("access_level"),
        "license": {
            "id": pkg.get("license_id"),
            "title": pkg.get("license_title"),
        },
        "metadata_modified": pkg.get("metadata_modified"),
        "origin": origin,
        "mixed_origin": len(svc_origins) > 1,
        "harvest": harvest,
        "spatial": spatial,
        "bbox": spatial_bbox(spatial) or _union_extent(layers),
        "layers": layers,
        "resources": resources,
        "capabilities": _merge_caps(
            [l["capabilities"] for l in layers]
            + [r["capabilities"] for r in resources]
        ),
        "links": {
            "ckan": f"{site}/dataset/{pkg['name']}",
            "ckan_api": f"{site}/api/3/action/package_show?id={pkg['name']}",
            "amconnect_api": f"{site}/api/amconnect/datasets/{pkg['name']}",
            "services_api": f"{site}/api/amconnect/datasets/{pkg['name']}/services",
            "map": f"{site}/dataset/{pkg['name']}/map",
            "embed": f"{site}/dataset/{pkg['name']}/map/embed",
        },
    }


def group_layers(resources):
    """Group OGC service resources that name the same layer on the same host."""
    groups, order = {}, []
    for r in resources:
        if r["service_type"] not in OGC_SERVICE_TYPES or not r["layer_name"]:
            continue
        host = urlsplit(r["endpoint"]).netloc
        key = (host, r["layer_name"].split(":")[-1], r["origin"])
        if key not in groups:
            groups[key] = {
                "layer_name": r["layer_name"],
                "title": None,
                "origin": r["origin"],
                "data_kind": "unknown",
                "services": {},
                "resource_ids": [],
                "extent": None,
                "legend_url": None,
                "styles": [],
                "status": "not_probed",
                "capabilities": {k: False for k in CAPABILITY_KEYS},
                "downloads": [],
            }
            order.append(key)
        g = groups[key]
        g["services"][r["service_type"]] = {
            "resource_id": r["id"],
            "name": r["name"],
            "endpoint": r["endpoint"],
            "url": r["url"],
            "status": r["status"],
            "status_detail": r["status_detail"],
            "formats": r["formats"],
            "cors": r["cors"],
        }
        g["resource_ids"].append(r["id"])
        if r["service_type"] == "wms":
            g["title"] = (
                re.sub(
                    r"\s*\((local GeoServer )?WMS[^)]*\)\s*$", "", r["name"]
                )
                or r["name"]
            )
            g["status"] = r["status"]
            g["legend_url"] = r["legend_url"]
            g["styles"] = r["styles"]
            g["export_map_image"] = r["export_map_image"]
            g["queryable"] = r["queryable"]
        g["title"] = g["title"] or r["name"]
        g["extent"] = g["extent"] or r["extent"]
        g["downloads"].extend(r["downloads"])
        g["capabilities"] = _merge_caps([g["capabilities"], r["capabilities"]])
    for g in groups.values():
        if "wcs" in g["services"]:
            g["data_kind"] = "raster"
        elif "wfs" in g["services"]:
            g["data_kind"] = "vector"
        g["capabilities"]["federated"] = g["origin"] == "federated"
        g["view_only"] = g["capabilities"]["view"] and not (
            g["capabilities"]["download_vector"]
            or g["capabilities"]["download_raster"]
        )
    return [groups[k] for k in order]


def _merge_caps(cap_dicts):
    merged = {k: False for k in CAPABILITY_KEYS}
    for c in cap_dicts:
        for k in CAPABILITY_KEYS:
            merged[k] = merged[k] or bool(c.get(k))
    return merged


def _parse_spatial(pkg):
    import json

    value = pkg.get("spatial")
    if not value:
        for e in pkg.get("extras", []):
            if e.get("key") == "spatial":
                value = e.get("value")
    if not value:
        return None
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return None


def spatial_bbox(geom):
    if not geom:
        return None
    try:
        from shapely.geometry import shape

        return [round(v, 6) for v in shape(geom).bounds]
    except Exception:  # noqa: BLE001
        return None


def _union_extent(layers):
    boxes = [l["extent"] for l in layers if l.get("extent")]
    if not boxes:
        return None
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


# ------------------------------------------------------------ URL builders
def _join(endpoint, params):
    sep = "&" if "?" in endpoint else "?"
    return endpoint + sep + urlencode(params)


def legend_url(wms_endpoint, layer, style=None):
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetLegendGraphic",
        "FORMAT": "image/png",
        "LAYER": layer,
        "LEGEND_OPTIONS": "fontAntiAliasing:true",
    }
    if style:
        params["STYLE"] = style
    return _join(wms_endpoint, params)


def getmap_url(wms_endpoint, layer, bbox, width=1024):
    w, s, e, n = bbox
    height = max(1, int(width * (n - s) / max(e - w, 1e-9)))
    return _join(
        wms_endpoint,
        {
            "SERVICE": "WMS",
            "VERSION": "1.1.1",
            "REQUEST": "GetMap",
            "LAYERS": layer,
            "STYLES": "",
            "SRS": "EPSG:4326",
            "BBOX": f"{w},{s},{e},{n}",
            "WIDTH": width,
            "HEIGHT": min(height, 4096),
            "FORMAT": "image/png",
            "TRANSPARENT": "true",
        },
    )


def wfs_download_url(wfs_endpoint, typename, output_format, bbox=None):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": typename,
        "outputFormat": output_format,
    }
    if bbox:
        params["bbox"] = ",".join(str(v) for v in bbox) + ",EPSG:4326"
    return _join(wfs_endpoint, params)


def wcs_download_url(wcs_endpoint, coverage_id, output_format=None, bbox=None):
    url = _join(
        wcs_endpoint,
        {
            "service": "WCS",
            "version": "2.0.1",
            "request": "GetCoverage",
            "coverageId": coverage_id,
        },
    )
    if output_format:
        url += "&format=" + requests.utils.quote(output_format, safe="")
    if bbox:
        w, s, e, n = bbox
        url += f"&subset=Long({w},{e})&subset=Lat({s},{n})"
    return url
