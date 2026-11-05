"""ckanext-amconnect: AMConnect proof-of-concept extension.

What stays custom in CKAN for AMConnect (everything else comes from standard
extensions, see README "Extension responsibility boundaries"):

* five dataset-level fields: country, commodity, data_type, access_level and
  ``spatial`` (the GeoJSON extent that ckanext-spatial indexes and searches)
* a ``layer_name`` resource field (OGC layer / feature type / coverage id)
* ``services.py``: the resource -> service/capability model
* ``api.py``: /api/amconnect/... facade for the future frontend
* the GIS view (dataset "Map" tab, standalone /map/embed page, resource view)
* harvest glue (``harvesters.py``) so harvested records land in this schema
* ``ckan amconnect seed``: creates the example datasets and harvest sources

Three plugins: ``amconnect`` (all of the above but the view), ``amconnect_wms_view``
(the IResourceView; separate class because IDatasetForm and IResourceView both
define ``setup_template_variables``) and ``amconnect_ckan_harvester``.
"""
import ckan.plugins as p
import ckan.plugins.toolkit as tk

from ckanext.amconnect import api, cli, helpers, services, views

try:
    from ckanext.spatial.interfaces import ISpatialHarvester
except (
    ImportError
):  # ckanext-spatial not installed: harvest glue is simply inactive
    ISpatialHarvester = None

# Dataset-level custom fields. One list drives the schema, the form and the display.
DATASET_FIELDS = (
    {"name": "country", "label": "Country"},
    {"name": "commodity", "label": "Commodity"},
    {
        "name": "data_type",
        "label": "Data type",
        "choices": ("geospatial", "tabular", "document", "other"),
    },
    {
        "name": "access_level",
        "label": "Access level",
        "choices": (
            "public-view",
            "public-download",
            "restricted",
            "internal",
        ),
    },
    # GeoJSON geometry (Polygon/MultiPolygon/Point). ckanext-spatial's spatial_metadata
    # plugin validates it and spatial_query indexes it; we only have to declare the field.
    {
        "name": "spatial",
        "label": "Spatial extent (GeoJSON)",
        "widget": "textarea",
    },
)


class AmconnectPlugin(p.SingletonPlugin, tk.DefaultDatasetForm):
    """Metadata fields, resource field, helpers, Map tab, API and CLI."""

    p.implements(p.IConfigurer)
    p.implements(p.IDatasetForm)
    p.implements(p.ITemplateHelpers)
    p.implements(p.IBlueprint)
    p.implements(p.IClick)
    if ISpatialHarvester:
        p.implements(ISpatialHarvester, inherit=True)

    # ------------------------------------------------------------ IConfigurer
    def update_config(self, config_):
        tk.add_template_directory(config_, "templates")
        tk.add_public_directory(config_, "public")

    # ---------------------------------------------------------- IDatasetForm
    def is_fallback(self):
        return True

    def package_types(self):
        return []

    def _modify_package_schema(self, schema):
        for field in DATASET_FIELDS:
            validators = [
                tk.get_validator("ignore_missing"),
                tk.get_validator("unicode_safe"),
            ]
            if "choices" in field:
                validators.append(tk.get_validator("one_of")(field["choices"]))
            validators.append(tk.get_converter("convert_to_extras"))
            schema.update({field["name"]: validators})
        schema["resources"].update(
            {
                "layer_name": [
                    tk.get_validator("ignore_missing"),
                    tk.get_validator("unicode_safe"),
                ],
                "wms_layer": [
                    tk.get_validator("ignore_missing"),
                    tk.get_validator("unicode_safe"),
                ],  # legacy
            }
        )
        return schema

    def create_package_schema(self):
        return self._modify_package_schema(super().create_package_schema())

    def update_package_schema(self):
        return self._modify_package_schema(super().update_package_schema())

    def show_package_schema(self):
        schema = super().show_package_schema()
        for field in DATASET_FIELDS:
            schema.update(
                {
                    field["name"]: [
                        tk.get_converter("convert_from_extras"),
                        tk.get_validator("ignore_missing"),
                    ]
                }
            )
        schema["resources"].update(
            {
                "layer_name": [
                    tk.get_validator("ignore_missing"),
                    tk.get_validator("unicode_safe"),
                ],
                "wms_layer": [
                    tk.get_validator("ignore_missing"),
                    tk.get_validator("unicode_safe"),
                ],
            }
        )
        return schema

    # ------------------------------------------------------ ITemplateHelpers
    def get_helpers(self):
        return {
            "amconnect_dataset_fields": lambda: DATASET_FIELDS,
            "amconnect_wms_layers": helpers.wms_layers_for_package,
            "amconnect_wms_url": services.base_url,
            "amconnect_describe_resource": helpers.describe_resource_cached,
            "amconnect_describe_dataset": helpers.describe_dataset_cached,
            "amconnect_is_service": services.is_ogc_service,
            "amconnect_layer_for": services.layer_for,
        }

    # ------------------------------------------------------------ IBlueprint
    def get_blueprint(self):
        return [views.blueprint, api.api]

    # ---------------------------------------------------------------- IClick
    def get_commands(self):
        return [cli.amconnect]

    # ------------------------------------------------------ ISpatialHarvester
    def get_package_dict(self, context, data_dict):
        from ckanext.amconnect.harvesters import adapt_iso_package

        return adapt_iso_package(
            data_dict["package_dict"], data_dict.get("iso_values") or {}
        )


class AmconnectWmsViewPlugin(p.SingletonPlugin):
    """The AMConnect GIS resource view (``amconnect_wms_view``).

    Shows the resource's layer in the same GIS component as the dataset Map tab.
    Kept as a separate plugin class because IDatasetForm and IResourceView both
    define ``setup_template_variables`` and would clash on one class.
    """

    p.implements(p.IResourceView, inherit=True)

    def info(self):
        return {
            "name": "amconnect_wms_view",
            "title": "AMConnect GIS view",
            "icon": "map",
            "default_title": "Map preview",
            "iframed": False,
            "always_available": False,
            "schema": {
                "wms_layer": [
                    tk.get_validator("ignore_missing"),
                    tk.get_validator("unicode_safe"),
                ],
            },
        }

    def can_view(self, data_dict):
        return services.is_ogc_service(data_dict["resource"])

    def setup_template_variables(self, context, data_dict):
        resource = data_dict["resource"]
        view = data_dict.get("resource_view") or {}
        return {
            "wms_layer": services.layer_for(resource, view.get("wms_layer"))
        }

    def view_template(self, context, data_dict):
        return "amconnect/wms_view.html"

    def form_template(self, context, data_dict):
        return "amconnect/wms_form.html"


def _ckan_harvester_plugin():
    from ckanext.amconnect.harvesters import AmconnectCKANHarvester

    return AmconnectCKANHarvester


try:
    AmconnectCKANHarvesterPlugin = _ckan_harvester_plugin()
except ImportError:  # ckanext-harvest not installed
    AmconnectCKANHarvesterPlugin = None
