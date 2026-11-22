#!/usr/bin/env bash
# End-to-end check of issue #1 against the running stack with demo data
# (README "Demo data": its GeoServer layers are what access is checked on).
#
#   super admin invites A (ASEC, GeoServer)                 -> A accepts via the emailed link
#   A logs in to CKAN from CKAN's own login form
#   inviting A again is refused; an unaccepted invitation to D can be sent again
#   A invites B (AOCP Thailand) and C (no role)            -> both accept
#   B logs in to CKAN, C is refused
#   only A reads GeoServer layers; B, C and anonymous are refused
#   A stays logged in to the platform after its access and refresh tokens expire
#
# Google login needs a real Google account and is checked by hand (README).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/e2e-lib.sh
GETMAP="http://localhost:8080/geoserver/amconnect/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=amconnect:thailand_geology&STYLES=&SRS=EPSG:4326&BBOX=97,5,106,21&WIDTH=64&HEIGHT=64&FORMAT=image/png"

A=a-$RUN@example.org B=b-$RUN@example.org C=c-$RUN@example.org
PW=pw-$RUN-secret

SA=$(token "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD")
check "super admin logs in" true "$([ -n "$SA" ] && echo true || echo false)"
check "super admin invites A (ASEC, GeoServer)" 201 \
  "$(invite "$SA" "$A" '["asec","geoserver-access"]')"
check "A accepts the emailed invitation" 204 "$(accept "$A" "$PW")"
check "inviting A again is a conflict" 409 "$(invite "$SA" "$A" '[]')"
check "super admin invites D" 201 "$(invite "$SA" "d-$RUN@example.org" '[]')"
check "an invitation not yet accepted can be sent again" 201 "$(invite "$SA" "d-$RUN@example.org" '["aocp-th"]')"
check "A logs in to CKAN from CKAN's login form" 302 "$(ckan_login "$A" "$PW")"

TA=$(token "$A" "$PW")
check "A cannot grant amvest-admin" 403 "$(invite "$TA" "x-$RUN@example.org" '["amvest-admin"]')"
check "A invites B as AOCP Thailand" 201 "$(invite "$TA" "$B" '["aocp-th"]')"
check "A invites C without a role" 201 "$(invite "$TA" "$C" '[]')"
check "a password under 8 characters is refused" 400 "$(accept "$B" short)"
check "B accepts" 204 "$(accept "$B" "$PW")"
check "C accepts" 204 "$(accept "$C" "$PW")"
check "B logs in to CKAN" 302 "$(ckan_login "$B" "$PW")"
check "C is refused by CKAN" 200 "$(ckan_login "$C" "$PW")"

check "A reads a GeoServer layer" 200 "$(getmap "$TA")"
check "B cannot read GeoServer layers" 404 "$(getmap "$(token "$B" "$PW")")"
check "C cannot read GeoServer layers" 404 "$(getmap "$(token "$C" "$PW")")"
check "anonymous cannot read GeoServer layers" 404 "$(getmap)"

# tokens: access 10s, refresh 20s. Each page view after 10s must refresh and save the new
# tokens, or the next view finds the first refresh token expired and logs out.
kcadm config credentials --server http://localhost:8080 --realm master \
  --user "${KEYCLOAK_ADMIN:-admin}" --password "${KEYCLOAK_ADMIN_PASSWORD:-admin}" >/dev/null 2>&1
trap 'platform_tokens "" ""' EXIT
platform_tokens 10 20
JAR=$(mktemp)
platform_login "$A" "$PW" "$JAR"
check "A opens the platform" 200 "$(home "$JAR")"
sleep 12
check "A stays logged in after the access token expires" 200 "$(home "$JAR")"
sleep 12
check "A stays logged in after the first refresh token expires" 200 "$(home "$JAR")"
rm -f "$JAR"

echo
[ "$failures" = 0 ] && echo "All checks passed." || { echo "$failures check(s) failed."; exit 1; }
