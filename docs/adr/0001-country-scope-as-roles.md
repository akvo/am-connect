# Country scope is a Keycloak role per Member State

An AOCP country user's country is the realm role `aocp-<country code>` (`aocp-id` is
Indonesia), each a composite that includes `aocp`. It is not a user attribute or a group.
GeoServer's Keycloak filter turns only the token's realm roles into GeoServer roles, so a
per-country layer rule needs the country as a role. CKAN and the Platform read the same
roles from the token. A user may hold several countries. A bare `aocp` grants nothing.

## Considered options

- **User attribute `country` with a token mapper**: one value per user and checked by
  Keycloak's user profile, but GeoServer cannot see it. Per-country roles would then have
  to be kept in sync next to it.
- **Groups `AOCP Indonesia` carrying the role `aocp-id`**: groups are easier to browse in
  the admin console, but they still need the per-country roles, so they only add a layer.

## Consequences

- Adding a Member State means adding a role to `keycloak/realm-amconnect.json` and an
  entry to `COUNTRIES` in `backend/app/access.py`.
- Moving to an attribute or groups later means migrating every AOCP user's roles and
  rewriting the GeoServer and CKAN rules that name them.
