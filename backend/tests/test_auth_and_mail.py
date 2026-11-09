"""Auth routes (Keycloak replaced at app.keycloak) and the invite email (SMTP replaced)."""

from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app import keycloak, mail
from app.main import app

client = TestClient(app)


def refuse(*args):
    raise keycloak.InvalidCredentials


def test_login_returns_tokens(monkeypatch):
    monkeypatch.setattr(keycloak, "password_login", lambda e, p: {"access_token": "t"})
    r = client.post("/auth/login", json={"email": "a@example.org", "password": "pw"})
    assert r.status_code == 200 and r.json() == {"access_token": "t"}


def test_login_refused_is_401(monkeypatch):
    monkeypatch.setattr(keycloak, "password_login", refuse)
    r = client.post("/auth/login", json={"email": "a@example.org", "password": "x"})
    assert r.status_code == 401


def test_refresh_expired_is_401(monkeypatch):
    monkeypatch.setattr(keycloak, "refresh", refuse)
    assert client.post("/auth/refresh", json={"refresh_token": "r"}).status_code == 401


def test_logout_ends_keycloak_session(monkeypatch):
    ended = []
    monkeypatch.setattr(keycloak, "logout", ended.append)
    assert client.post("/auth/logout", json={"refresh_token": "r"}).status_code == 204
    assert ended == ["r"]


def test_me_lists_app_roles_only(monkeypatch):
    claims = {"sub": "u1", "realm_access": {"roles": ["ckan-access", "offline_access"]}}
    monkeypatch.setattr(keycloak, "verify", lambda token: claims)
    r = client.get("/me", headers={"authorization": "Bearer t"})
    assert r.json()["roles"] == ["ckan-access"]
    assert r.json()["grantable_roles"] == ["ckan-access"]


def test_invalid_token_is_401(monkeypatch):
    def bad(token):
        raise jwt.InvalidTokenError

    monkeypatch.setattr(keycloak, "verify", bad)
    assert client.get("/me", headers={"authorization": "Bearer t"}).status_code == 401


@pytest.fixture
def smtp(monkeypatch):
    smtp = SimpleNamespace(sent=[], address=None, timeout=None)

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            smtp.address, smtp.timeout = (host, port), timeout

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def send_message(self, msg):
            smtp.sent.append(msg)

    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "mailpit")
    monkeypatch.setenv("SMTP_PORT", "1025")
    return smtp


def test_send_invite_mails_the_link(smtp):
    mail.send_invite("b@example.org", "http://x/invite/tok", "a@example.org")
    (msg,) = smtp.sent
    assert smtp.address == ("mailpit", 1025)
    assert smtp.timeout  # a stalled mail server must not hang the request
    assert msg["To"] == "b@example.org"
    assert "http://x/invite/tok" in msg.get_content()
    assert "a@example.org invited you" in msg.get_content()
