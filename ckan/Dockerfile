FROM ckan/ckan-base:2.11

USER root

# --- Standard CKAN ecosystem extensions under evaluation (pinned releases) ----
#   ckanext-spatial : spatial extent metadata + spatial search + CSW harvester
#   ckanext-harvest : harvesting framework + CKAN-to-CKAN harvester
#   ckanext-geoview : generic OGC/GeoJSON resource viewers (reference implementation)
# Editable installs into ${SRC_DIR} so the extension source can be inspected in the container.
RUN pip install --no-cache-dir --src ${SRC_DIR} \
        -e "git+https://github.com/ckan/ckanext-harvest.git@v1.6.2#egg=ckanext-harvest" \
        -e "git+https://github.com/ckan/ckanext-spatial.git@v2.3.2#egg=ckanext-spatial" \
        -e "git+https://github.com/ckan/ckanext-geoview.git@v0.3.1#egg=ckanext-geoview" && \
    pip install --no-cache-dir -r ${SRC_DIR}/ckanext-spatial/requirements.txt && \
    # ckanext-spatial's harvesters import ckanext.harvest.queue, which imports pika at module
    # level even when the redis queue is used; harvest 1.6.x made pika an optional extra.
    pip install --no-cache-dir pika

# --- The POC extension (editable so bind-mounting it during development works) ----
COPY --chown=ckan:ckan-sys ckanext-amconnect ${SRC_DIR}/ckanext-amconnect
RUN pip install --no-cache-dir -e ${SRC_DIR}/ckanext-amconnect

# Note: the stock ckan_harvester / csw_harvester plugins are deliberately NOT enabled next to
# amconnect_ckan_harvester / amconnect_csw_harvester, which subclass them: CKAN's SingletonPlugin
# would hand a subclass the base class instance and the "amconnect_*" source types would never
# register. The subclasses are the stock harvesters plus a few lines of AMConnect glue.
# Bake the plugin list into ckan.ini.  The base image's prerun.py runs `ckan db init`
# *before* it applies CKAN__PLUGINS, so the default ini (which enables `datastore`)
# would otherwise try to reach a datastore DB we do not run.  Order matters: later
# plugins' templates take precedence, so ckanext-amconnect goes last.
RUN ckan config-tool ${CKAN_INI} \
      "ckan.plugins = image_view text_view resource_proxy envvars spatial_metadata spatial_query harvest geo_view geojson_view amconnect amconnect_wms_view amconnect_ckan_harvester amconnect_csw_harvester" && \
    ckan config-tool ${CKAN_INI} "ckan.views.default_views = image_view text_view amconnect_wms_view" && \
    ckan config-tool ${CKAN_INI} "ckanext.spatial.search_backend = solr-spatial-field" && \
    ckan config-tool ${CKAN_INI} "ckan.harvest.mq.type = redis" && \
    ckan config-tool ${CKAN_INI} "ckan.harvest.mq.hostname = redis"

# Startup hooks run by start_ckan.sh after db init / sysadmin creation
COPY --chown=ckan:ckan-sys docker-entrypoint.d/ /docker-entrypoint.d/
USER ckan
