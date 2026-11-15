"""AMConnect API layer: a thin, frontend-oriented facade over CKAN's action API.

    GET /api/amconnect/datasets/<id>              dataset + grouped layers/services + capabilities
    GET /api/amconnect/datasets/<id>/services     just the layers/services part
    GET /api/amconnect/resources/<id>             one resource's service description
    GET /api/amconnect/search?q=&country=&commodity=&data_type=&access_level=&origin=&tags=&limit=&offset=
    GET /api/amconnect/spatial-search?bbox=minx,miny,maxx,maxy&q=...   (ckanext-spatial ext_bbox)

Why it exists: CKAN's package_show/package_search are complete but CKAN-shaped
(extras lists, resource dicts with 25 keys, harvest/spatial info spread over
extras).  The future AMConnect frontend should not need to know any of that.
Every endpoint here is a few lines: call the CKAN action, run the result through
``services.describe_dataset`` and return JSON.  CKAN stays the source of truth;
nothing is stored here.

Access control is CKAN's: the actions are called with the current user, so a
private dataset is invisible to anonymous callers exactly as in /api/3.
"""

import ckan.plugins.toolkit as tk
from flask import Blueprint, jsonify, request

from ckanext.amconnect import services

api = Blueprint("amconnect_api", __name__, url_prefix="/api/amconnect")


FACET_FIELDS = {
    "country": "country",
    "commodity": "commodity",
    "data_type": "data_type",
    "access_level": "access_level",
    "organization": "organization",
    "tags": "tags",
}


def _context():
    return {"user": tk.g.user, "auth_user_obj": tk.g.userobj}


def _error(status, message):
    return jsonify({"success": False, "error": message}), status


def _ok(result, **extra):
    payload = {"success": True, "result": result}
    payload.update(extra)
    return jsonify(payload)


def _probe_flag():
    return request.args.get("probe", "true").lower() not in (
        "0",
        "false",
        "no",
    )


@api.route("/datasets/<id>")
def dataset(id):
    try:
        pkg = tk.get_action("package_show")(_context(), {"id": id})
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return _error(404, "dataset not found")
    return _ok(services.describe_dataset(pkg, probe=_probe_flag()))


@api.route("/datasets/<id>/services")
def dataset_services(id):
    try:
        pkg = tk.get_action("package_show")(_context(), {"id": id})
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return _error(404, "dataset not found")
    d = services.describe_dataset(pkg, probe=_probe_flag())
    return _ok(
        {
            "id": d["id"],
            "name": d["name"],
            "origin": d["origin"],
            "bbox": d["bbox"],
            "layers": d["layers"],
            "resources": d["resources"],
            "capabilities": d["capabilities"],
        }
    )


@api.route("/resources/<id>")
def resource(id):
    try:
        res = tk.get_action("resource_show")(_context(), {"id": id})
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return _error(404, "resource not found")
    return _ok(services.describe_resource(res, probe=_probe_flag()))


def _search(extra_params=None):
    """Shared by /search and /spatial-search: map simple query params onto package_search."""
    args = request.args
    fq = []
    for param, field in FACET_FIELDS.items():
        value = args.get(param)
        if value:
            fq.append(f'{field}:"{value}"')
    if args.get("origin") in ("hosted", "federated"):
        # harvested datasets carry harvest_source_id; hosted ones do not
        fq.append(
            "harvest_source_id:[* TO *]"
            if args["origin"] == "federated"
            else "-harvest_source_id:[* TO *]"
        )
    fq.append(
        "-dataset_type:harvest"
    )  # harvest sources are datasets too in CKAN; hide them
    data = {
        "q": args.get("q", "*:*") or "*:*",
        "fq": " ".join(fq),
        "rows": min(int(args.get("limit", 20)), 100),
        "start": int(args.get("offset", 0)),
        "sort": args.get("sort", "score desc, metadata_modified desc"),
        "facet.field": [
            "country",
            "commodity",
            "data_type",
            "access_level",
            "organization",
            "tags",
        ],
        "facet.limit": 20,
    }
    data.update(extra_params or {})
    try:
        result = tk.get_action("package_search")(_context(), data)
    except tk.ValidationError as e:
        return _error(400, e.error_dict)
    probe = args.get("probe", "false").lower() in (
        "1",
        "true",
        "yes",
    )  # off by default for lists
    items = []
    for pkg in result["results"]:
        d = services.describe_dataset(pkg, probe=probe)
        items.append(
            {
                k: d[k]
                for k in (
                    "id",
                    "name",
                    "title",
                    "description",
                    "organization",
                    "tags",
                    "country",
                    "commodity",
                    "data_type",
                    "access_level",
                    "origin",
                    "bbox",
                    "metadata_modified",
                    "capabilities",
                    "links",
                )
            }
            | {
                "layer_count": len(d["layers"]),
                "resource_count": len(d["resources"]),
                "service_types": sorted(
                    {r["service_type"] for r in d["resources"]}
                ),
            }
        )
    return _ok(
        items,
        count=result["count"],
        facets=result.get("search_facets", {}),
        query={
            "q": data["q"],
            "fq": data["fq"],
            "limit": data["rows"],
            "offset": data["start"],
        },
    )


@api.route("/search")
def search():
    return _search()


@api.route("/spatial-search")
def spatial_search():
    bbox = request.args.get("bbox", "")
    parts = bbox.split(",")
    if len(parts) != 4:
        return _error(400, "bbox must be minx,miny,maxx,maxy (WGS84 lon/lat)")
    try:
        [float(p) for p in parts]
    except ValueError:
        return _error(400, "bbox values must be numbers")
    # ckanext-spatial's spatial_query plugin reads
    # 'ext_bbox' from the search extras
    return _search({"extras": {"ext_bbox": bbox}})


@api.route("/")
def index():
    return _ok(
        {
            "endpoints": [
                "/api/amconnect/datasets/<id>",
                "/api/amconnect/datasets/<id>/services",
                "/api/amconnect/resources/<id>",
                "/api/amconnect/search?q=",
                "/api/amconnect/spatial-search?bbox=minx,miny,maxx,maxy",
            ],
            "capability_keys": list(services.CAPABILITY_KEYS),
            "note": "?probe=false skips the live GetCapabilities checks (faster, capabilities from metadata only)",
        }
    )
