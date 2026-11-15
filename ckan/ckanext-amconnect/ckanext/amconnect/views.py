"""GIS view routes.

    /dataset/<id>/map          the GIS view inside the CKAN dataset page (tabs: Overview/Map/Resources/Analysis)
    /dataset/<id>/map/embed    the same component on a bare page, for <iframe> embedding
                               (query: ?tab=map|analysis|resources|overview, ?bbox=w,s,e,n, ?layers=id1,id2,
                                ?datasets=name1,name2 to add more datasets to the same map)
    /amconnect/map             multi-dataset standalone map: ?datasets=name1,name2[&tab=...]

Both pages render nothing but a container: the component (public/amconnect-gis.js)
fetches /api/amconnect/datasets/<id> in the browser and builds the map, layer
panel, downloads and analysis tools from that JSON.  That is deliberate: it is
exactly what a standalone AMConnect frontend would do.
"""

import ckan.plugins.toolkit as tk
from flask import Blueprint, request

blueprint = Blueprint("amconnect", __name__)


def _pkg(id):
    context = {"user": tk.g.user, "auth_user_obj": tk.g.userobj}
    return tk.get_action("package_show")(context, {"id": id})


@blueprint.route("/dataset/<id>/map")
def dataset_map(id):
    try:
        pkg_dict = _pkg(id)
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return tk.abort(404, tk._("Dataset not found"))
    return tk.render(
        "amconnect/dataset_map.html",
        {
            "pkg_dict": pkg_dict,
            "pkg": pkg_dict,
            "dataset_type": pkg_dict["type"],
            "gis_options": _options(pkg_dict),
        },
    )


@blueprint.route("/dataset/<id>/map/embed")
def dataset_map_embed(id):
    try:
        pkg_dict = _pkg(id)
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return tk.abort(404, tk._("Dataset not found"))
    return tk.render(
        "amconnect/embed.html",
        {"pkg": pkg_dict, "gis_options": _options(pkg_dict, embed=True)},
    )


@blueprint.route("/amconnect/map")
def multi_map():
    names = [n for n in (request.args.get("datasets") or "").split(",") if n]
    if not names:
        return tk.abort(400, "datasets=<name>[,<name>...] is required")
    try:
        pkg_dict = _pkg(names[0])
    except (tk.ObjectNotFound, tk.NotAuthorized):
        return tk.abort(404, tk._("Dataset not found"))
    options = _options(pkg_dict, embed=True)
    options["datasets"] = names
    options["embedUrl"] = tk.url_for(
        "amconnect.multi_map", datasets=",".join(names), _external=True
    )
    return tk.render(
        "amconnect/embed.html", {"pkg": pkg_dict, "gis_options": options}
    )


def _options(pkg_dict, embed=False):
    return {
        "api": tk.url_for("amconnect_api.dataset", id=pkg_dict["name"]),
        "datasetUrl": tk.url_for("dataset.read", id=pkg_dict["name"]),
        "embedUrl": tk.url_for(
            "amconnect.dataset_map_embed", id=pkg_dict["name"], _external=True
        ),
        "tab": request.args.get("tab", "map"),
        "bbox": request.args.get("bbox"),
        "layers": request.args.get("layers"),
        "datasets": [
            n
            for n in (
                [pkg_dict["name"]]
                + (request.args.get("datasets") or "").split(",")
            )
            if n
        ]
        if request.args.get("datasets")
        else None,
        "embed": embed,
    }
