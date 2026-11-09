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
[poc-amconnect](https://github.com/dedenbangkit/poc-amconnect) proof of concept.

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
their own login forms and check passwords with Keycloak server-side. Google login only
redirects through Keycloak to Google.

| Realm role | Grants |
|---|---|
| `super-admin` | can grant `user-manager` |
| `user-manager` | can invite users (Platform `/invite`), granting only access they hold |
| `ckan-access` | can log in to CKAN; without it CKAN refuses the login and creates no account |
| `geoserver-access` | can read `amconnect` GeoServer layers with `Authorization: Bearer <access token>` |

Invitations are emailed (see Mailpit); the link lets the invitee set name and password,
or continue with Google. The super admin comes from `SUPERADMIN_EMAIL` /
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
./scripts/e2e-issue-1.sh
```

### Google login

1. In Google Cloud console, create an OAuth client (Web application) with redirect URI
   `http://localhost:8180/realms/amconnect/broker/google/endpoint`.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and `docker compose up -d`. The "Continue with Google" buttons appear.

Google logs in only an invited email; anyone else sees an AMConnect-styled Keycloak page
asking for an invitation.

## Backend

Migrations run on container start (`alembic upgrade head`). Code reloads on save.

```bash
docker compose exec backend pytest
docker compose exec -u "$(id -u):$(id -g)" backend alembic revision --autogenerate -m "add thing"
docker compose exec backend ruff check .
```

Import new SQLModel table modules in `backend/alembic/env.py` so autogenerate sees them.
Add dependencies on the host with `uv add <pkg>` in `backend/`, then
`docker compose up -d --build backend`.

## Frontend

`pnpm dev` runs in the container with hot reload.

```bash
docker compose exec frontend pnpm lint
```

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

[AGPL-3.0](LICENSE), inherited from poc-amconnect.
