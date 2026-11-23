# AMConnect

AMConnect platform and data service.

| Part | Folder | Stack |
|---|---|---|
| Platform frontend | `frontend/` | Next.js 16 (App Router, TypeScript, Tailwind), pnpm |
| Platform API | `backend/` | FastAPI, SQLModel, Alembic, uv |
| Data Service | `ckan/`, `geoserver/` | CKAN 2.11 (ckanext-spatial, -harvest, -geoview, `ckanext-amconnect`), GeoServer, PostGIS |
| Identity | `keycloak/` | Keycloak, realm `amconnect` |
| Database | `db/` | One PostGIS server, one database per service |

The CKAN and GeoServer parts come from the
[`poc-amconnect`](https://github.com/dedenbangkit/poc-amconnect) proof of concept.

## Run

Requirements: Docker with Compose v2, about 5 GB RAM free.

```bash
docker compose up -d --build
```

No `.env` needed; see `.env.example` for overrides. First start takes a few minutes.
Reset everything with `docker compose down -v`.

| Service | URL | Login |
|---|---|---|
| Frontend | http://localhost:3000 | super admin `admin@example.org` / `admin12345` |
| Backend | http://localhost:8000/docs, `/health` | |
| CKAN | http://localhost:5000 | Keycloak users, or local sysadmin `admin` / `admin12345` |
| GeoServer | http://localhost:8080/geoserver | `admin` / `geoserver` |
| Keycloak admin console (developers only) | http://localhost:8180/admin | `admin` / `admin` |
| Mailpit (outgoing mail) | http://localhost:8025 | |
| pgAdmin | http://localhost:5050 | `dev@akvo.org` / `password` |
| Postgres | `localhost:5432` | `postgres` / `password` |

Databases (user = password = name): `ckan`, `keycloak`, `platform`, `gis`.
They are created by `db/init/20-databases.sql` on the first start of an empty volume only.

## Users and access

Keycloak holds every account; users never see a Keycloak page. Platform and CKAN show
their own login forms and check passwords with Keycloak server-side. Google and Microsoft
login only redirect through Keycloak to Google or Microsoft.

| Realm role | Grants |
|---|---|
| `super-admin` | can grant `asec`, `aocp-*` and `amvest-admin` |
| `asec` | ASEAN Secretariat; can grant `asec` and `aocp-*` |
| `aocp-<country>` | AOCP country user for one Member State (`aocp-id` is Indonesia); can grant the same role |
| `aocp` | any AOCP country user; part of every `aocp-<country>`, never granted alone |
| `amvest-admin` | AMVest forum admin; grants nothing on the Platform or CKAN |
| `amvest-user` | AMVest forum participant; a default role, so every account has it |
| `geoserver-access` | can read `amconnect` GeoServer layers with `Authorization: Bearer <access token>` |

Anyone who can grant one of the roles above can invite (Platform `/users/invite`), and can also
grant `geoserver-access` if they hold it. Nobody grants
`super-admin`. The rules live in `backend/app/access.py`; the terms in
[GLOSSARY.md](GLOSSARY.md).

Platform pages: `/`, `/login` and `/invite/<token>` are public; every other page sends a
visitor to `/login` and back after login. Areas open by role, from `AREAS` in
`backend/app/access.py`, which also fills `/me`'s `areas`:

| Area | Page | Roles |
|---|---|---|
| CMS | `/cms` | `super-admin`, `asec`, `aocp-<country>` |
| User administration | `/users` | `super-admin`, `asec`, `aocp-<country>` |
| WebGIS | `/webgis` | anyone signed in |

The navigation shows only the user's areas; any other area shows a "No access" page (403).
Pages check with `requireArea()` (`frontend/src/lib/api.ts`), API endpoints with
`require_area()` or `require_roles()` (`backend/app/main.py`).

CKAN lets in `super-admin`, `asec` and `aocp-<country>` holders; everyone else is refused
and gets no CKAN account. Each Member State has a country organisation named by its code
(`id`, `vn`), created at CKAN start. At every CKAN login the user's memberships follow
their roles: `asec` is editor of every country organisation, `aocp-<country>` of its own,
and `super-admin` is a CKAN sysadmin. Only country organisations are changed; a role
change applies at the user's next CKAN login, not to open sessions or API tokens.

Country scope is a role, not a user attribute or group, because GeoServer's Keycloak
filter reads only the token's realm roles. A user may hold several `aocp-<country>` roles.
See [ADR 0001](docs/adr/0001-country-scope-as-roles.md).

There is no `user-manager` role: the LLD leaves open whether every ASEC and AOCP user
may invite, or only designated administrators, and this assumes every one. The next
`docker compose up -d` deletes the role from Keycloak; users keep their other roles.

Invitations are emailed (see Mailpit); the link lets the invitee set name and password,
or continue with Google or Microsoft. Until the invitee does, inviting the same email again replaces
the invitation. Passwords need 8 characters and must not be the email; repeated failed
logins lock the account for a while. The super admin comes from `SUPERADMIN_EMAIL` /
`SUPERADMIN_PASSWORD` in `.env`.

Keycloak config lives in `keycloak/realm-amconnect.json`. The `keycloak-config` service
([keycloak-config-cli](https://github.com/adorsys/keycloak-config-cli)) applies it to the
running Keycloak on every `docker compose up -d`: edit the file, run `up`, done. Users are
kept, and the super admin's password is set only when that user is first created.

* Values come from the environment as `$(env:NAME)`, not `${NAME}`.
* Something removed from the file is deleted only if keycloak-config-cli created it.
* Renaming a role is a delete plus create: everyone loses it. Moving existing users to a
  new role needs its own step (e.g. a backend migration calling Keycloak's Admin API).

GeoServer's Keycloak filter and layer rule are written by `geoserver/entrypoint.sh` at
every start.

Check the whole flow against the running stack (with demo data loaded, see below):

```bash
./scripts/e2e-issue-1.sh   # invitations, CKAN and GeoServer access, session refresh
./scripts/e2e-issue-3.sh   # CKAN country organisations, refusal, logout
./scripts/e2e-issue-5.sh   # Platform login redirect, areas and 403 page
```

### Google login

1. In Google Cloud console, create an OAuth client (Web application) with redirect URI
   `http://localhost:8180/realms/amconnect/broker/google/endpoint`.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and `docker compose up -d`. The "Continue with Google" buttons appear.

Google logs in only an invited email; anyone else sees an AMConnect-styled Keycloak page
asking for an invitation.

### Microsoft login

1. In the Microsoft Entra admin center, App registrations → New registration:
   - Supported account types: **this organizational directory only** (single tenant).
   - Redirect URI (Web): `http://localhost:8180/realms/amconnect/broker/microsoft/endpoint`.
2. Certificates & secrets → New client secret. Keep the default API permission
   `User.Read` (Microsoft Graph), which Keycloak uses to read the email.
3. Put the application (client) ID, the secret value and the directory (tenant) ID in
   `.env` as `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID`, then
   `docker compose up -d`. The "Continue with Microsoft" buttons appear.

Like Google, Microsoft logs in only an invited email. Only accounts of the tenant in
`AZURE_TENANT_ID` can log in. Keycloak links a Microsoft login to the AMConnect user with
the same email, and a tenant administrator can put any email on an account of their own,
so that tenant's administrators can take over any AMConnect account, the Super Admin
included. Never set it to `organizations` or `common`, which extends that to every
tenant. See [ADR 0002](docs/adr/0002-microsoft-login-single-tenant.md).

## Backend

Migrations run on container start (`alembic upgrade head`). Code reloads on save.

```bash
docker compose exec -u "$(id -u):$(id -g)" backend alembic revision --autogenerate -m "add thing"
```

Import new SQLModel table modules in `backend/alembic/env.py` so autogenerate sees them.
Add dependencies on the host with `uv add <pkg>` in `backend/`, then
`docker compose up -d --build backend`.

## Frontend

`pnpm dev` runs in the container with hot reload.

## Checks

With the stack up, from the repo root:

```bash
make check    # lint, format check, types (ruff, Pyrefly, ESLint, Prettier, tsc), Vale
make test     # backend tests with coverage
make format   # apply ruff and Prettier
```

CI (`.github/workflows/quality.yml`) runs the same targets. It also requires 80% coverage
of a PR's changed backend lines. Limits and conventions are in `CLAUDE.md`.

## Demo data

Example layers (`demo/geoserver-data`) and two mock harvest sources (`demo/mock-ckan`,
`demo/pycsw`) sit behind the `demo` compose profile. To load them, put this in `.env`:

```bash
COMPOSE_PROFILES=demo
AMCONNECT_SEED=true
AMCONNECT_HARVEST=true
```

then `docker compose up -d --build`. `geoserver-seed` publishes the layers to GeoServer,
then CKAN creates the example datasets and harvests the mock sources. Ports: mock CKAN
5001, pycsw 8001. A `harvest_source_reindex failed (KeyError ...)` note in the CKAN log is
a known ckanext-harvest / CKAN 2.11 issue; the harvest still finishes.

## License

[AGPL-3.0](LICENSE), inherited from `poc-amconnect`.
