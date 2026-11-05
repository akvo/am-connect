"""Template helpers. All the logic lives in services.py; these only add per-request caching."""
from flask import g

from ckanext.amconnect import services


def _request_cache():
    try:
        cache = getattr(g, "_amconnect_cache", None)
        if cache is None:
            cache = g._amconnect_cache = {}
        return cache
    except RuntimeError:  # outside a request (CLI)
        return {}


def describe_resource_cached(resource):
    cache = _request_cache()
    key = ("res", resource.get("id"))
    if key not in cache:
        cache[key] = services.describe_resource(resource)
    return cache[key]


def describe_dataset_cached(pkg):
    cache = _request_cache()
    key = ("pkg", pkg.get("id"))
    if key not in cache:
        cache[key] = services.describe_dataset(pkg)
    return cache[key]


def wms_layers_for_package(pkg_dict):
    """[{name, url, layer, resource_id}] for every WMS resource (used by the Map tab test)."""
    layers = []
    for res in pkg_dict.get("resources", []):
        if services.service_type_of(res) != "wms":
            continue
        layers.append(
            {
                "resource_id": res["id"],
                "name": res.get("name") or res["id"],
                "url": services.base_url(res.get("url")),
                "layer": services.layer_for(res),
            }
        )
    return layers
