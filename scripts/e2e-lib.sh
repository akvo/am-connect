# Helpers shared by the e2e-issue-*.sh scripts; source it, do not run it.
API=http://localhost:8000
WEB=http://localhost:3000
CKAN=http://localhost:5000
MAILPIT=http://localhost:8025
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

home() { # home <cookie jar> -> HTTP status of the dashboard (307 means sent to login)
  page "$1" /dashboard
}

page() { # page <cookie jar> <path> -> HTTP status of a platform page
  curl -s -o /dev/null -w '%{http_code}' -c "$1" -b "$1" "$WEB$2"
}
