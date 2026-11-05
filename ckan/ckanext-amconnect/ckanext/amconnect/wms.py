"""Compatibility shim: the first POC put WMS detection here. Everything moved to services.py."""
from ckanext.amconnect.services import base_url as wms_base_url  # noqa: F401
from ckanext.amconnect.services import layer_for  # noqa: F401


def is_wms_resource(resource):
    from ckanext.amconnect.services import service_type_of

    return service_type_of(resource) == "wms"
