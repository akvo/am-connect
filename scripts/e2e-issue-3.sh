#!/usr/bin/env bash
# End-to-end check of issue #3 (CKAN side) against the running stack.
#
#   super admin invites P (AOCP Indonesia), Q (ASEC), R (AMVest admin) -> all accept
#   CKAN: P edits only `id`, Q edits all 11 country organisations, R is refused,
#         the super admin is a CKAN sysadmin
#   P moves from Indonesia to Viet Nam in Keycloak  -> next CKAN login edits only `vn`
#   Q gains then loses super-admin                  -> CKAN sysadmin on, then off
#   Q loses every role, as super admin and ASEC     -> refused, and CKAN rights removed
#   P's email changes in Keycloak                   -> same CKAN account, new email
#   CKAN logout ends P's Keycloak session
#   P suspended in Keycloak                         -> refused by the Platform and CKAN
#
# Microsoft and Google login need real accounts and are checked by hand (README).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
. scripts/e2e-lib.sh

P=p-$RUN@example.org Q=q-$RUN@example.org R=r-$RUN@example.org
PW=pw-$RUN-secret

ckan_sql() { docker compose exec -T db psql -U ckan ckan -tAc "$1"; }

editor_of() { # editor_of <email> -> country organisations the CKAN user edits, comma-separated
  ckan_sql "select string_agg(g.name, ',' order by g.name) from member m
    join \"group\" g on g.id = m.group_id join \"user\" u on u.id = m.table_id
    where u.email = '$1' and m.table_name = 'user' and m.state = 'active'
      and m.capacity = 'editor' and g.is_organization"
}

kc_user_id() { kcadm get users -r amconnect -q "email=$1" -q exact=true --fields id | json '[0]["id"]'; }

kcadm config credentials --server http://localhost:8080 --realm master \
  --user "${KEYCLOAK_ADMIN:-admin}" --password "${KEYCLOAK_ADMIN_PASSWORD:-admin}" >/dev/null 2>&1

SA=$(token "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD")
check "super admin invites P (AOCP Indonesia)" 201 "$(invite "$SA" "$P" '["aocp-id"]')"
check "super admin invites Q (ASEC)" 201 "$(invite "$SA" "$Q" '["asec"]')"
check "super admin invites R (AMVest admin)" 201 "$(invite "$SA" "$R" '["amvest-admin"]')"
for u in "$P" "$Q" "$R"; do check "$u accepts" 204 "$(accept "$u" "$PW")"; done

check "P logs in to CKAN" 302 "$(ckan_login "$P" "$PW")"
check "P edits only Indonesia" id "$(editor_of "$P")"
check "Q logs in to CKAN" 302 "$(ckan_login "$Q" "$PW")"
check "Q edits every country organisation" bn,id,kh,la,mm,my,ph,sg,th,tl,vn "$(editor_of "$Q")"
check "R is refused by CKAN" 200 "$(ckan_login "$R" "$PW")"
check "R gets no CKAN account" 0 "$(ckan_sql "select count(*) from \"user\" where email = '$R'")"
check "super admin logs in to CKAN" 302 "$(ckan_login "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD")"
check "super admin is a CKAN sysadmin" t \
  "$(ckan_sql "select sysadmin from \"user\" where email = '$SUPERADMIN_EMAIL'")"

PID=$(kc_user_id "$P")
kcadm remove-roles -r amconnect --uid "$PID" --rolename aocp-id
kcadm add-roles -r amconnect --uid "$PID" --rolename aocp-vn
check "P logs in to CKAN after moving to Viet Nam" 302 "$(ckan_login "$P" "$PW")"
check "P edits only Viet Nam" vn "$(editor_of "$P")"

QID=$(kc_user_id "$Q")
sysadmin_of() { ckan_sql "select sysadmin from \"user\" where email = '$1'"; }
kcadm add-roles -r amconnect --uid "$QID" --rolename super-admin
check "Q logs in to CKAN as super admin" 302 "$(ckan_login "$Q" "$PW")"
check "Q is a CKAN sysadmin" t "$(sysadmin_of "$Q")"
kcadm remove-roles -r amconnect --uid "$QID" --rolename super-admin
check "Q logs in to CKAN as ASEC only" 302 "$(ckan_login "$Q" "$PW")"
check "Q is no longer a CKAN sysadmin" f "$(sysadmin_of "$Q")"
kcadm add-roles -r amconnect --uid "$QID" --rolename super-admin
ckan_login "$Q" "$PW" >/dev/null
kcadm remove-roles -r amconnect --uid "$QID" --rolename super-admin --rolename asec
check "Q without roles is refused by CKAN" 200 "$(ckan_login "$Q" "$PW")"
check "the refusal removes Q's sysadmin flag" f "$(sysadmin_of "$Q")"
check "the refusal removes Q's memberships" "" "$(editor_of "$Q")"

P2=p2-$RUN@example.org
kcadm update "users/$PID" -r amconnect -s "email=$P2"
check "P logs in to CKAN with the new email" 302 "$(ckan_login "$P2" "$PW")"
check "P keeps one CKAN account, with the new email" "$PID|$P2" \
  "$(ckan_sql "select name || '|' || email from \"user\" where name = '$PID'")"

# CKAN's logout ends the Keycloak session its login opened (earlier logins left theirs)
sessions() { kcadm get "users/$PID/sessions" -r amconnect | json '.__len__()'; }
before=$(sessions)
headers=$(mktemp)
csrf=$(curl -s -D "$headers" "$CKAN/user/login" | grep -o 'name="_csrf_token" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"$//')
cookie=$(grep -i '^set-cookie: ckan=' "$headers" | tail -1 | sed 's/^[^:]*: //;s/;.*//' | tr -d '\r')
curl -s -o /dev/null -D "$headers" -X POST "$CKAN/user/login" -H "Cookie: $cookie" \
  --data-urlencode "_csrf_token=$csrf" --data-urlencode "login=$P2" --data-urlencode "password=$PW"
cookie=$(grep -i '^set-cookie: ckan=' "$headers" | tail -1 | sed 's/^[^:]*: //;s/;.*//' | tr -d '\r')
rm -f "$headers"
check "CKAN login opens a Keycloak session" $((before + 1)) "$(sessions)"
curl -s -o /dev/null -H "Cookie: $cookie" "$CKAN/user/_logout"
check "CKAN logout ends it" "$before" "$(sessions)"

kcadm update "users/$PID" -r amconnect -s enabled=false
check "suspended P cannot log in to the Platform" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$P2\",\"password\":\"$PW\"}")"
check "suspended P is refused by CKAN" 200 "$(ckan_login "$P2" "$PW")"

echo
[ "$failures" = 0 ] && echo "All checks passed." || { echo "$failures check(s) failed."; exit 1; }
