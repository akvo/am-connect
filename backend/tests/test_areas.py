"""Platform areas by role, and the backend role dependency (Keycloak replaced)."""

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import keycloak
from app.access import areas_of
from app.main import app, require_area, require_roles

guarded = FastAPI()
guarded.dependency_overrides = app.dependency_overrides  # the db fixture's session


@guarded.get("/cms", dependencies=[require_area("cms")])
def cms() -> None: ...


@guarded.get("/asec-only", dependencies=[require_roles("asec")])
def asec_only() -> None: ...


client = TestClient(guarded)


def claims(*roles):
    return {"sub": "u1", "realm_access": {"roles": list(roles)}}


@pytest.mark.parametrize(
    ("roles", "areas"),
    [
        (["super-admin"], {"cms", "users", "webgis"}),
        (["asec"], {"cms", "users", "webgis"}),
        (["aocp", "aocp-id"], {"cms", "users", "webgis"}),
        (["amvest-admin", "amvest-user"], {"webgis"}),
        (["aocp"], {"webgis"}),  # the bare composite names no country
    ],
)
def test_areas_follow_roles(roles, areas):
    assert areas_of(claims(*roles)) == areas


def as_user(monkeypatch, *roles):
    monkeypatch.setattr(keycloak, "verify", lambda token: claims(*roles))
    return {"authorization": "Bearer t"}


def test_area_allows_its_roles(monkeypatch, db):
    assert (
        client.get("/cms", headers=as_user(monkeypatch, "aocp-vn")).status_code == 200
    )


def test_area_refuses_other_roles_with_403(monkeypatch, db):
    assert (
        client.get("/cms", headers=as_user(monkeypatch, "amvest-admin")).status_code
        == 403
    )


def test_role_dependency_refuses_other_roles(monkeypatch, db):
    assert (
        client.get("/asec-only", headers=as_user(monkeypatch, "aocp-id")).status_code
        == 403
    )
    assert (
        client.get("/asec-only", headers=as_user(monkeypatch, "asec")).status_code
        == 200
    )


def test_missing_token_is_401():
    assert client.get("/cms").status_code == 401


def test_expired_token_is_401(monkeypatch):
    def expired(token):
        raise jwt.ExpiredSignatureError

    monkeypatch.setattr(keycloak, "verify", expired)
    assert client.get("/cms", headers={"authorization": "Bearer t"}).status_code == 401


def test_me_lists_areas(monkeypatch, db):
    r = TestClient(app).get("/me", headers=as_user(monkeypatch, "amvest-user"))
    assert r.json()["areas"] == ["webgis"]
