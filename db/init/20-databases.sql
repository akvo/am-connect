-- One Postgres server, one database per service (dev credentials).
-- Runs after the postgis image's 10_postgis.sh, on first start only.
CREATE USER ckan PASSWORD 'ckan';
CREATE DATABASE ckan OWNER ckan;

CREATE USER keycloak PASSWORD 'keycloak';
CREATE DATABASE keycloak OWNER keycloak;

CREATE USER platform PASSWORD 'platform';
CREATE DATABASE platform OWNER platform;

CREATE USER gis PASSWORD 'gis';
CREATE DATABASE gis OWNER gis;
\c gis
CREATE EXTENSION postgis;
