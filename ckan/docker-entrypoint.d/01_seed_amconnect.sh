#!/bin/bash
# ckanext-harvest keeps its own tables (harvest_source/job/object); apply its migrations.
echo "[amconnect] ckan db upgrade -p harvest"
ckan -c "$CKAN_INI" db upgrade -p harvest || echo "[amconnect] harvest db upgrade FAILED (CKAN will still start)"

# Seed the AMConnect example organisation + datasets (idempotent).
if [ "${AMCONNECT_SEED:-true}" = "true" ]; then
  echo "[amconnect] seeding example datasets"
  ckan -c "$CKAN_INI" amconnect seed || echo "[amconnect] seeding FAILED (CKAN will still start)"
fi

# Pull the federation test sources once so the demo has harvested datasets (best effort;
# re-run any time with `ckan amconnect harvest`).
if [ "${AMCONNECT_HARVEST:-false}" = "true" ]; then
  echo "[amconnect] harvesting demo sources"
  ckan -c "$CKAN_INI" amconnect harvest || echo "[amconnect] harvest FAILED (CKAN will still start)"
fi
