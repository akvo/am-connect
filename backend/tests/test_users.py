"""The user list: who an administrator sees (Keycloak replaced at app.keycloak)."""

import pytest
from fastapi.testclient import TestClient

from app import keycloak
from app.main import app

client = TestClient(app)

USERS = [
    {"id": "me", "email": "me@example.org", "roles": {"aocp-id"}, "enabled": True},
    {
        "id": "id1",
        "email": "id1@example.org",
        "firstName": "Ina",
        "lastName": "Dewi",
        "roles": {"aocp-id", "geoserver-access"},
        "enabled": True,
    },
    {"id": "vn1", "email": "vn1@example.org", "roles": {"aocp-vn"}, "enabled": False},
    {
        "id": "as1",
        "email": "as1@example.org",
        "roles": {"asec", "aocp-id"},
        "enabled": True,
    },
    {
        "id": "am1",
        "email": "am1@example.org",
        "roles": {"amvest-admin"},
        "enabled": True,
    },
    {"id": "sa", "email": "sa@example.org", "roles": {"super-admin"}, "enabled": True},
]


def list_as(monkeypatch, *roles):
    claims = {"sub": "me", "realm_access": {"roles": list(roles)}}
    monkeypatch.setattr(keycloak, "verify", lambda token: claims)
    monkeypatch.setattr(keycloak, "users_by_role", lambda names: USERS)
    return client.get("/users", headers={"authorization": "Bearer t"})


@pytest.mark.parametrize(
    ("roles", "emails"),
    [
        # own country only, not an ASEC user who also holds it, not oneself
        (["aocp", "aocp-id"], ["id1@example.org"]),
        (["asec"], ["as1@example.org", "id1@example.org", "vn1@example.org"]),
        (
            ["super-admin"],
            [
                "am1@example.org",
                "as1@example.org",
                "id1@example.org",
                "vn1@example.org",
            ],
        ),
    ],
)
def test_lists_the_users_the_caller_may_manage(monkeypatch, db, roles, emails):
    r = list_as(monkeypatch, *roles)
    assert [u["email"] for u in r.json()] == emails


def test_lists_name_roles_and_suspension(monkeypatch, db):
    users = {u["id"]: u for u in list_as(monkeypatch, "asec").json()}
    assert users["id1"]["name"] == "Ina Dewi"
    assert users["id1"]["roles"] == ["aocp-id", "geoserver-access"]
    assert users["vn1"]["enabled"] is False and users["vn1"]["name"] is None


def test_refused_without_the_users_area(monkeypatch, db):
    assert list_as(monkeypatch, "amvest-admin").status_code == 403
