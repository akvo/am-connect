# Microsoft login accepts one Entra tenant

Keycloak's Microsoft login is set to the single tenant in `AZURE_TENANT_ID`. Without a
tenant, Keycloak would use Microsoft's `common` endpoint, so the compose default is the
value `unset`, which makes the login fail rather than open up.

A Microsoft login is linked to the AMConnect user with the same email, without asking,
the same as Google (`trustEmail` and the "invite-only first login" flow). That is any
existing user, not only one still invited: the Super Admin included. Google vouches for
its addresses. In Entra, a tenant administrator can set any email on an account in their
own tenant. So the administrators of every allowed tenant can log in as any AMConnect
user. One tenant, of an organisation already trusted with AMConnect accounts, keeps that
to people who could be asked to account for it; several would hand it to each of them.

## Considered options

- **`organizations` (any work account)**: lets every ASEAN ministry log in with no setup
  per tenant, but opens the takeover above.
- **Several named tenants**: Keycloak's Microsoft login takes one tenant. More would need
  one identity provider per tenant, with its own button or a tenant picker.
- **Ask before linking** (Keycloak's "review profile" or email verification on first
  login): closes the takeover for any tenant, but shows Keycloak pages, which the
  sign-in design avoids.

## Consequences

- Users of other tenants cannot use Microsoft login; they use a password or Google.
- The allowed tenant's administrators can take over any AMConnect account. Choose the
  tenant with that in mind; linking only users who have not finished their invitation
  would close it, but needs a custom Keycloak authenticator.
- Which tenants ASEAN users come from is an open question to the partner. If they come
  from several, revisit this with one identity provider per tenant.
