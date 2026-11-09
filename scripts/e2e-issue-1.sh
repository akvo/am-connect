#!/usr/bin/env bash
# End-to-end check of issue #1 against the running stack with demo data
# (README "Demo data": its GeoServer layers are what access is checked on).
#
#   super admin invites A (user manager, CKAN, GeoServer)  -> A accepts via the emailed link
#   A logs in to CKAN from CKAN's own login form
#   inviting A again is refused; an unaccepted invitation to D can be sent again
#   A invites B (CKAN) and C (no access)                   -> both accept
#   B logs in to CKAN, C is refused
#   only A reads GeoServer layers; B, C and anonymous are refused
#   A stays logged in to the platform after its access and refresh tokens expire
#
# Google login needs a real Google account and is checked by hand (README).
set -uo pipefail

API=http://localhost:8000
WEB=http://localhost:3000
CKAN=http://localhost:5000
MAILPIT=http://localhost:8025
GETMAP="http://localhost:8080/geoserver/amconnect/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=amconnect:thailand_geology&STYLES=&SRS=EPSG:4326&BBOX=97,5,106,21&WIDTH=64&HEIGHT=64&FORMAT=image/png"
SUPERADMIN_EMAIL=${SUPERADMIN_EMAIL:-admin@example.org}
SUPERADMIN_PASSWORD=${SUPERADMIN_PASSWORD:-admin12345}
RUN=$(date +%s)
failures=0

check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $2, got $3)"; failures=$((failures + 1)); fi
}

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

token() { # token <email> <password>
  curl -s "$API/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json '["access_token"]'
}

invite() { # invite <token> <email> <roles json> -> HTTP status
  curl -s -o /dev/null -w '%{http_code}' "$API/invitations" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "{\"email\":\"$2\",\"roles\":$3}"
}

accept() { # accept <email> <password> -> HTTP status; reads the invite link from mailpit
  local id link
  for _ in $(seq 10); do
    id=$(curl -s "$MAILPIT/api/v1/search?query=to:$1" | json '["messages"][0]["ID"]' 2>/dev/null) && break
    sleep 1
  done
  link=$(curl -s "$MAILPIT/api/v1/message/$id" | json '["Text"]' | tr -d '\r' | grep -o 'http://[^ ]*/invite/[^ ]*')
  curl -s -o /dev/null -w '%{http_code}' "$API/invitations/${link##*/}/accept" \
    -H 'content-type: application/json' \
    -d "{\"first_name\":\"Test\",\"last_name\":\"User\",\"password\":\"$2\"}"
}

ckan_login() { # ckan_login <email> <password> -> 302 on success, 200 when refused
  local headers cookie csrf
  headers=$(mktemp)
  # CKAN sends `Domain=` (empty) on its cookie, which curl's cookie jar drops; pass it by hand
  csrf=$(curl -s -D "$headers" "$CKAN/user/login" | grep -o 'name="_csrf_token" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"$//')
  cookie=$(grep -i '^set-cookie: ckan=' "$headers" | tail -1 | sed 's/^[^:]*: //;s/;.*//' | tr -d '\r')
  rm -f "$headers"
  curl -s -o /dev/null -w '%{http_code}' -X POST "$CKAN/user/login" -H "Cookie: $cookie" \
    --data-urlencode "_csrf_token=$csrf" --data-urlencode "login=$1" --data-urlencode "password=$2"
}

getmap() { # getmap [token] -> HTTP status
  if [ -n "${1:-}" ]; then
    curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $1" "$GETMAP"
  else
    curl -s -o /dev/null -w '%{http_code}' "$GETMAP"
  fi
}

kcadm() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

platform_tokens() { # platform_tokens <access seconds> <refresh seconds>; "" restores the realm's
  local id
  id=$(kcadm get clients -r amconnect -q clientId=platform --fields id | json '[0]["id"]')
  kcadm update "clients/$id" -r amconnect -s "attributes.\"access.token.lifespan\"=$1" \
    -s "attributes.\"client.session.idle.timeout\"=$2"
}

platform_login() { # platform_login <email> <password> <cookie jar>
  local csrf
  csrf=$(curl -s -c "$3" -b "$3" "$WEB/api/auth/csrf" | json '["csrfToken"]')
  curl -s -o /dev/null -c "$3" -b "$3" "$WEB/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$1" --data-urlencode "password=$2"
}

home() { # home <cookie jar> -> HTTP status of the platform home page (307 means sent to login)
  curl -s -o /dev/null -w '%{http_code}' -c "$1" -b "$1" "$WEB/"
}

A=a-$RUN@example.org B=b-$RUN@example.org C=c-$RUN@example.org
PW=pw-$RUN-secret

SA=$(token "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD")
check "super admin logs in" true "$([ -n "$SA" ] && echo true || echo false)"
check "super admin invites A (user manager, CKAN, GeoServer)" 201 \
  "$(invite "$SA" "$A" '["user-manager","ckan-access","geoserver-access"]')"
check "A accepts the emailed invitation" 204 "$(accept "$A" "$PW")"
check "inviting A again is a conflict" 409 "$(invite "$SA" "$A" '[]')"
check "super admin invites D" 201 "$(invite "$SA" "d-$RUN@example.org" '[]')"
check "an invitation not yet accepted can be sent again" 201 "$(invite "$SA" "d-$RUN@example.org" '["ckan-access"]')"
check "A logs in to CKAN from CKAN's login form" 302 "$(ckan_login "$A" "$PW")"

TA=$(token "$A" "$PW")
check "A cannot grant user-manager" 403 "$(invite "$TA" "x-$RUN@example.org" '["user-manager"]')"
check "A invites B with CKAN access" 201 "$(invite "$TA" "$B" '["ckan-access"]')"
check "A invites C without CKAN access" 201 "$(invite "$TA" "$C" '[]')"
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
