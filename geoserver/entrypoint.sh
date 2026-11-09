#!/bin/bash
# GeoServer with Keycloak bearer-token auth (issue #1). Before Tomcat starts:
#
# * a `keycloak` sec-oidc filter in resource-server mode: OGC requests with
#   `Authorization: Bearer <Keycloak access token>` are checked against Keycloak's
#   signing keys and the token's realm roles become GeoServer roles
# * that filter goes first on the OGC ("default") chain; basic auth stays for admins
# * layers in the `amconnect` workspace are readable only with `geoserver-access`
#
# GeoServer reads these files only at startup and has no REST API for filters, so they
# are written here. Idempotent.
set -euo pipefail

SECURITY="$GEOSERVER_DATA_DIR/security"
KC_PUBLIC="$KEYCLOAK_PUBLIC_URL/realms/amconnect/protocol/openid-connect"
KC_INTERNAL="$KEYCLOAK_INTERNAL_URL/realms/amconnect/protocol/openid-connect"

rm -f /tmp/amconnect-ready  # healthcheck waits for it, so nobody uses the temporary first boot
if [ ! -f "$SECURITY/config.xml" ]; then
  echo "[amconnect] first start: letting GeoServer create its security config"
  /opt/startup.sh &
  pid=$!
  until curl -fs -o /dev/null -u "$GEOSERVER_ADMIN_USER:$GEOSERVER_ADMIN_PASSWORD" \
      http://localhost:8080/geoserver/rest/about/version.json; do sleep 5; done
  kill "$pid"
  wait "$pid" || true
fi

mkdir -p "$SECURITY/filter/keycloak"
cat > "$SECURITY/filter/keycloak/config.xml" <<EOF
<oauth2LoginAuthentication>
  <id>amconnect-keycloak</id>
  <name>keycloak</name>
  <className>org.geoserver.security.oauth2.login.GeoServerOAuth2LoginAuthenticationFilter</className>
  <roleSource class="org.geoserver.security.oauth2.config.OpenIdRoleSource">AccessToken</roleSource>
  <tokenRolesClaim>realm_access.roles</tokenRolesClaim>
  <enableResourceServerMode>true</enableResourceServerMode>
  <enableRedirectAuthenticationEntryPoint>false</enableRedirectAuthenticationEntryPoint>
  <validateTokenAudience>false</validateTokenAudience>
  <oidcEnabled>true</oidcEnabled>
  <oidcClientId>platform</oidcClientId>
  <oidcClientSecret>unused-no-browser-login</oidcClientSecret>
  <oidcScopes>openid email profile</oidcScopes>
  <oidcUserNameAttribute>email</oidcUserNameAttribute>
  <oidcAuthorizationUri>$KC_PUBLIC/auth</oidcAuthorizationUri>
  <oidcTokenUri>$KC_INTERNAL/token</oidcTokenUri>
  <oidcUserInfoUri>$KC_INTERNAL/userinfo</oidcUserInfoUri>
  <oidcJwkSetUri>$KC_INTERNAL/certs</oidcJwkSetUri>
  <oidcLogoutUri>$KC_PUBLIC/logout</oidcLogoutUri>
</oauth2LoginAuthentication>
EOF

grep -q '<filter>keycloak</filter>' "$SECURITY/config.xml" ||
  sed -i '/<filters name="default"/a\      <filter>keycloak</filter>' "$SECURITY/config.xml"

grep -q '^amconnect\.\*\.r=' "$SECURITY/layers.properties" ||
  sed -i '$a amconnect.*.r=geoserver-access' "$SECURITY/layers.properties"

touch /tmp/amconnect-ready
exec /opt/startup.sh
