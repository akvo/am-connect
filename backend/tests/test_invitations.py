from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import keycloak, mail
from app.main import app, current_user, get_session
from app.models import Invitation, utcnow

SUPER_ADMIN = {
    "sub": "u-super",
    "email": "admin@example.org",
    "realm_access": {"roles": ["super-admin", "geoserver-access"]},
}
ASEC = {
    "sub": "u-a",
    "email": "a@example.org",
    "realm_access": {"roles": ["asec", "geoserver-access"]},
}
AOCP_ID = {
    "sub": "u-i",
    "realm_access": {"roles": ["aocp", "aocp-id", "geoserver-access"]},
}
PLAIN = {
    "sub": "u-c",
    "realm_access": {"roles": ["geoserver-access", "amvest-user"]},
}


@pytest.fixture
def env(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)

    def session():
        with Session(engine) as s:
            yield s

    sent, created, passwords = [], {}, {}
    monkeypatch.setattr(keycloak, "find_user", lambda email: None)
    monkeypatch.setattr(keycloak, "can_sign_in", lambda uid: False)
    monkeypatch.setattr(
        keycloak,
        "create_user",
        lambda email, roles: created.setdefault(email, f"kc-{email}"),
    )
    monkeypatch.setattr(
        keycloak,
        "complete_account",
        lambda uid, first, last, pw: passwords.update({uid: pw}),
    )
    monkeypatch.setattr(
        mail, "send_invite", lambda to, link, inviter: sent.append((to, link))
    )
    app.dependency_overrides[get_session] = session

    class Env:
        client = TestClient(app)
        db = engine

        @staticmethod
        def as_user(claims):
            app.dependency_overrides[current_user] = lambda: claims

    Env.sent, Env.created, Env.passwords = sent, created, passwords
    yield Env
    app.dependency_overrides.clear()


def invite(env, email, roles):
    return env.client.post("/invitations", json={"email": email, "roles": roles})


def token_of(env):
    return env.sent[-1][1].rsplit("/", 1)[1]


def test_issue_flow_asec_invites_one_with_and_one_without_geoserver(env):
    env.as_user(SUPER_ADMIN)
    assert invite(env, "a@example.org", ["asec", "geoserver-access"]).status_code == 201

    env.as_user(ASEC)
    assert invite(env, "b@example.org", ["geoserver-access"]).status_code == 201
    assert invite(env, "c@example.org", []).status_code == 201
    assert set(env.created) == {"a@example.org", "b@example.org", "c@example.org"}


def test_inviter_cannot_grant_access_they_do_not_hold(env):
    env.as_user({"sub": "u-a", "realm_access": {"roles": ["asec"]}})
    r = invite(env, "b@example.org", ["geoserver-access"])
    assert r.status_code == 403
    assert "geoserver-access" in r.json()["detail"]


def test_only_super_admin_grants_amvest_admin(env):
    env.as_user(ASEC)
    assert invite(env, "b@example.org", ["amvest-admin"]).status_code == 403
    env.as_user(SUPER_ADMIN)
    assert invite(env, "b@example.org", ["amvest-admin"]).status_code == 201


def test_super_admin_role_is_never_grantable(env):
    env.as_user(SUPER_ADMIN)
    assert invite(env, "b@example.org", ["super-admin"]).status_code == 403


def test_inviting_needs_a_role_that_manages_users(env):
    env.as_user(PLAIN)
    assert invite(env, "b@example.org", ["geoserver-access"]).status_code == 403
    env.as_user({"sub": "u-x", "realm_access": {"roles": ["aocp"]}})
    assert invite(env, "b@example.org", []).status_code == 403
    assert env.created == {}


def test_aocp_grants_aocp_in_own_country_only(env):
    env.as_user(AOCP_ID)
    assert (
        invite(env, "b@example.org", ["aocp-id", "geoserver-access"]).status_code == 201
    )
    for role in ("aocp-th", "aocp", "asec", "super-admin", "amvest-admin"):
        assert invite(env, "c@example.org", [role]).status_code == 403
    assert set(env.created) == {"b@example.org"}


def test_asec_grants_asec_and_aocp_in_any_country(env):
    env.as_user(ASEC)
    assert invite(env, "a@example.org", ["asec"]).status_code == 201
    assert invite(env, "b@example.org", ["aocp-th", "aocp-vn"]).status_code == 201
    assert invite(env, "c@example.org", ["aocp-xx"]).status_code == 403


def test_existing_user_is_not_invited_again(env, monkeypatch):
    monkeypatch.setattr(keycloak, "find_user", lambda email: {"id": "x"})
    monkeypatch.setattr(keycloak, "can_sign_in", lambda uid: True)
    env.as_user(SUPER_ADMIN)
    assert invite(env, "a@example.org", []).status_code == 409


def test_unfinished_invitation_is_replaced(env, monkeypatch):
    env.as_user(SUPER_ADMIN)
    invite(env, "a@example.org", [])
    old_token = token_of(env)

    deleted = []
    monkeypatch.setattr(keycloak, "find_user", lambda email: {"id": "kc-old"})
    monkeypatch.setattr(keycloak, "can_sign_in", lambda uid: False)
    monkeypatch.setattr(keycloak, "delete_user", deleted.append)
    assert invite(env, "a@example.org", ["aocp-th"]).status_code == 201

    assert deleted == ["kc-old"]
    assert env.client.get(f"/invitations/{old_token}").status_code == 404
    assert env.client.get(f"/invitations/{token_of(env)}").json()["roles"] == [
        "aocp-th"
    ]


def test_accept_sets_password_once(env):
    env.as_user(SUPER_ADMIN)
    invite(env, "a@example.org", ["aocp-th"])
    token = token_of(env)

    assert env.client.get(f"/invitations/{token}").json() == {
        "email": "a@example.org",
        "roles": ["aocp-th"],
    }
    r = env.client.post(
        f"/invitations/{token}/accept",
        json={"first_name": "Ann", "last_name": "A", "password": "s3cret-pw"},
    )
    assert r.status_code == 204
    assert env.passwords == {"kc-a@example.org": "s3cret-pw"}

    again = env.client.post(
        f"/invitations/{token}/accept",
        json={"first_name": "Ann", "last_name": "A", "password": "other"},
    )
    assert again.status_code == 404
    assert env.passwords == {"kc-a@example.org": "s3cret-pw"}


def test_link_is_dead_once_the_user_joined_with_google(env, monkeypatch):
    env.as_user(SUPER_ADMIN)
    invite(env, "a@example.org", [])
    token = token_of(env)
    monkeypatch.setattr(keycloak, "can_sign_in", lambda uid: True)
    r = env.client.post(
        f"/invitations/{token}/accept",
        json={"first_name": "Eve", "last_name": "E", "password": "takeover-pw"},
    )
    assert r.status_code == 404
    assert env.passwords == {}
    with Session(env.db) as s:
        assert s.exec(select(Invitation)).one().accepted_at is not None


def test_expired_invitation_cannot_be_used(env):
    env.as_user(SUPER_ADMIN)
    invite(env, "a@example.org", [])
    token = token_of(env)
    with Session(env.db) as s:
        inv = s.exec(select(Invitation)).one()
        inv.expires_at = utcnow() - timedelta(seconds=1)
        s.add(inv)
        s.commit()
    assert env.client.get(f"/invitations/{token}").status_code == 404


def test_unknown_token_is_not_found(env):
    assert env.client.get("/invitations/nope").status_code == 404
