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
| Frontend | http://localhost:3000 | |
| Backend | http://localhost:8000/docs, `/health` | |
| CKAN | http://localhost:5000 | `admin` / `admin12345` |
| GeoServer | http://localhost:8080/geoserver | `admin` / `geoserver` |
| Keycloak | http://localhost:8180 | `admin` / `admin` |
| pgAdmin | http://localhost:5050 | `dev@akvo.org` / `password` |
| Postgres | `localhost:5432` | `postgres` / `password` |

Databases (user = password = name): `ckan`, `keycloak`, `platform`, `gis`.
They are created by `db/init/20-databases.sql` on the first start of an empty volume only.

## Backend

Migrations run on container start (`alembic upgrade head`). Code reloads on save.

```bash
docker compose exec backend pytest
docker compose exec backend alembic revision --autogenerate -m "add thing"
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
