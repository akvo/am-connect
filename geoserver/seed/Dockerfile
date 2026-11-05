# One-shot job: loads the example GeoJSON into PostGIS and publishes it in
# GeoServer via the REST API.  GDAL image gives us ogr2ogr + python3.
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.3
COPY seed.py /seed.py
ENTRYPOINT ["python3", "/seed.py"]
