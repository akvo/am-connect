"""Glue between the standard harvesters and the AMConnect dataset schema.

Finding: harvesters do NOT use our IDatasetForm schema. ``HarvesterBase._create_or_update_package``
builds the package with CKAN's *default* create schema (plus ``__junk = ignore``), so root-level
custom fields would be silently dropped, while entries in ``extras`` pass straight through.
Our ``show_package_schema`` then lifts those extras to root keys (``convert_from_extras``), so
for harvested datasets the rule is simply: keep AMConnect values in ``extras``.

Both standard harvesters give us a hook to normalise incoming records without patching them:

* ckanext-harvest's CKAN harvester: subclass and override ``modify_package_dict``
  (registered as the ``amconnect_ckan_harvester`` plugin, source type ``amconnect_ckan``).
* ckanext-spatial's CSW/WAF/doc harvesters: implement ``ISpatialHarvester.get_package_dict``
  (done by the main plugin, delegating to ``adapt_iso_package``).

Both hooks are ~20 lines: this is the "lightweight custom harvester" the evaluation asked
about, and where a GeoServer harvester would start (see README).
"""
import logging
import re
from urllib.parse import urlsplit

from ckanext.harvest.harvesters.ckanharvester import CKANHarvester
from ckanext.spatial.harvesters.csw import CSWHarvester

log = logging.getLogger(__name__)

AMCONNECT_FIELDS = (
    "spatial",
    "country",
    "commodity",
    "data_type",
    "access_level",
)
ACCESS_LEVELS = ("public-view", "public-download", "restricted", "internal")


def ensure_extras(package_dict, defaults=None):
    """Make sure AMConnect fields live in ``extras`` (in place). Root values win over extras."""
    extras = [
        e for e in (package_dict.get("extras") or []) if isinstance(e, dict)
    ]
    by_key = {e["key"]: e for e in extras}
    for key in AMCONNECT_FIELDS:
        value = package_dict.pop(key, None)
        if value not in (None, ""):
            by_key.setdefault(key, {"key": key, "value": value})
            by_key[key]["value"] = value
    for key, value in (defaults or {}).items():
        if key not in by_key:
            by_key[key] = {"key": key, "value": value}
            extras.append(by_key[key])
    for key in AMCONNECT_FIELDS:
        if key in by_key and by_key[key] not in extras:
            extras.append(by_key[key])
    package_dict["extras"] = extras
    return package_dict


def normalise_resources(package_dict):
    for res in package_dict.get("resources", []):
        fmt = (res.get("format") or "").strip()
        if fmt.lower() in ("wms", "wfs", "wcs", "wmts"):
            res["format"] = fmt.upper()
        if not res.get("layer_name") and res.get(
            "wms_layer"
        ):  # first POC field name
            res["layer_name"] = res["wms_layer"]
        frag = urlsplit(
            res.get("url") or ""
        ).fragment  # geoview / CSW convention
        if frag and not res.get("layer_name"):
            res["layer_name"] = frag
        elif (
            res.get("name")
            and ":" in res["name"]
            and not res.get("layer_name")
        ):
            res["layer_name"] = res["name"]  # ISO online-resource name
    return package_dict


class AmconnectCKANHarvester(CKANHarvester):
    """CKAN-to-CKAN harvester that understands the AMConnect dataset fields."""

    def info(self):
        return {
            "name": "amconnect_ckan",
            "title": "CKAN (AMConnect fields)",
            "description": "Harvests a remote CKAN; keeps spatial/country/commodity/"
            "data_type/access_level as extras and normalises service resources",
            "form_config_interface": "Text",
        }

    def modify_package_dict(self, package_dict, harvest_object):
        ensure_extras(package_dict, defaults={"data_type": "geospatial"})
        return normalise_resources(package_dict)


def adapt_iso_package(package_dict, iso_values):
    """ISpatialHarvester.get_package_dict body: ISO 19139 -> AMConnect dataset."""
    defaults = {"data_type": "geospatial", "access_level": "public-view"}
    # access level: ISO otherConstraints / useLimitation free text; keep it if it is one of ours
    for key in (
        "access-constraints",
        "use-constraints",
        "other-constraints",
        "limitations-on-public-access",
    ):
        for value in iso_values.get(key, []) or []:
            if str(value).strip().lower() in ACCESS_LEVELS:
                defaults["access_level"] = str(value).strip().lower()
    ensure_extras(package_dict, defaults=defaults)
    return normalise_resources(package_dict)


class AmconnectCSWHarvester(CSWHarvester):
    """CSW harvester with one fix: strip the XML declaration from fetched records.

    ckanext-spatial 2.3.2 serialises the fetched ISO record to *unicode* including its
    ``<?xml ... encoding="UTF-8"?>`` declaration (pycsw 3 returns the bare gmd:MD_Metadata
    document), and its fetch_stage regex ``<xml(.*)>`` does not match ``<?xml``; lxml then
    refuses the string at import ("Unicode strings with encoding declaration are not
    supported").  Six lines here instead of a patch to the upstream package.
    """

    def info(self):
        return {
            "name": "amconnect_csw",
            "title": "CSW Server (AMConnect)",
            "description": "OGC CSW 2.0.2 / ISO 19139 catalogue (ckanext-spatial csw harvester "
            "+ XML declaration fix + AMConnect field mapping)",
        }

    def fetch_stage(self, harvest_object):
        ok = super().fetch_stage(harvest_object)
        if ok and harvest_object.content:
            harvest_object.content = re.sub(
                r"^\s*<\?xml[^>]*\?>", "", harvest_object.content
            ).strip()
            harvest_object.save()
        return ok
