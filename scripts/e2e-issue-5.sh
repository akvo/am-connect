#!/usr/bin/env bash
# End-to-end check of issue #5 against the running stack.
#
#   anonymous: landing and login open; protected pages go to login, keeping the page asked for
#   Log out clicked in a tab whose session ended still ends at the login page
#   AOCP Indonesia (P): every area opens, every area is in the navigation
#   AMVest Admin (R): dashboard and WebGIS open; CMS and Users show 403, not in the navigation
#   user list: the super admin sees P and R; P does not see R; R is refused
#   logout ends the session
#   the frontend logs no errors meanwhile (prerendering, Auth.js events)
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/e2e-lib.sh

START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
P=p-$RUN@example.org R=r-$RUN@example.org
PW=pw-$RUN-secret

SA=$(token "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD")
check "super admin invites P (AOCP Indonesia)" 201 "$(invite "$SA" "$P" '["aocp-id"]')"
check "super admin invites R (AMVest Admin)" 201 "$(invite "$SA" "$R" '["amvest-admin"]')"
for u in "$P" "$R"; do check "$u accepts" 204 "$(accept "$u" "$PW")"; done

ANON=$(mktemp)
check "anonymous opens the landing page" 200 "$(page "$ANON" /)"
check "anonymous opens the login page" 200 "$(page "$ANON" /login)"
check "anonymous on /cms is sent to login" "307 $WEB/login?callbackUrl=%2Fcms%3Fq%3D1" \
  "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$WEB/cms?q=1")"
curl -s -o /dev/null "$WEB/invite/no-such-token"
check "the login form keeps the page asked for" 1 \
  "$(curl -s "$WEB/login?callbackUrl=%2Fcms" | grep -c 'name="callbackUrl" value="/cms"')"
rm -f "$ANON"

nav() { # nav <cookie jar> -> area links in the header, space-separated
  curl -s -b "$1" "$WEB/dashboard" | grep -o '<nav.*</nav>' | grep -o 'href="/[a-z]*"' |
    sed 's/href="\///;s/"//' | tr '\n' ' ' | sed 's/ $//'
}

JP=$(mktemp) JR=$(mktemp)
platform_login "$P" "$PW" "$JP"
platform_login "$R" "$PW" "$JR"
for path in /dashboard /cms /webgis /users /users/invite; do
  check "P opens $path" 200 "$(page "$JP" $path)"
done
# the proxy must let the form through: a redirected server action fails at /login
logout_id=$(curl -s -b "$JP" "$WEB/dashboard" | grep -o '\$ACTION_ID_[0-9a-f]*' | head -1 | sed 's/.*_//')
check "Log out without a session goes to login" "$WEB/login;push" \
  "$(curl -s -o /dev/null -D - -X POST -H "Next-Action: $logout_id" -H 'content-type: text/plain' --data '[]' "$WEB/dashboard" |
    grep -i '^x-action-redirect:' | sed 's/^[^:]*: //' | tr -d '\r')"
check "P's navigation shows every area" "dashboard cms webgis users" "$(nav "$JP")"
for path in /dashboard /webgis; do check "R opens $path" 200 "$(page "$JR" $path)"; done
for path in /cms /users /users/invite; do check "R gets no access on $path" 403 "$(page "$JR" $path)"; done
check "the 403 page says so" 1 "$(curl -s -b "$JR" "$WEB/cms" | grep -c 'No access')"
check "R's navigation shows only dashboard and WebGIS" "dashboard webgis" "$(nav "$JR")"

users() { # users <token> -> emails in GET /users, one per line
  curl -s "$API/users" -H "authorization: Bearer $1" |
    python3 -c "import json,sys; [print(u['email']) for u in json.load(sys.stdin)]"
}
check "the super admin's user list has P and R" 2 "$(users "$SA" | grep -cxE "$P|$R")"
check "the super admin is not in their own list" 0 "$(users "$SA" | grep -cx "$SUPERADMIN_EMAIL")"
check "P's user list leaves out R" 0 "$(users "$(token "$P" "$PW")" | grep -cx "$R")"
check "R cannot list users" 403 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/users" -H "authorization: Bearer $(token "$R" "$PW")")"
JS=$(mktemp)
platform_login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD" "$JS"
check "the users page lists P" 1 "$(curl -s -b "$JS" "$WEB/users" | grep -c "$P")"
rm -f "$JS"

csrf=$(curl -s -c "$JP" -b "$JP" "$WEB/api/auth/csrf" | json '["csrfToken"]')
curl -s -o /dev/null -c "$JP" -b "$JP" "$WEB/api/auth/signout" --data-urlencode "csrfToken=$csrf"
check "after logout P is sent to login" 307 "$(page "$JP" /dashboard)"
rm -f "$JP" "$JR"
check "the frontend logged no errors" 0 \
  "$(docker compose logs frontend --since "$START" | grep -ciE 'error')"

echo
[ "$failures" = 0 ] && echo "All checks passed." || { echo "$failures check(s) failed."; exit 1; }
