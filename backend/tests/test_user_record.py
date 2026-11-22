"""The Platform's user record follows Keycloak (Keycloak replaced at app.keycloak)."""

import jwt
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import keycloak
from app.main import app
from app.models import User

client = TestClient(app)


def sign_in(monkeypatch, **claims):
    monkeypatch.setattr(keycloak, "verify", lambda token: {"sub": "u1", **claims})
    return client.get("/me", headers={"authorization": "Bearer t"})


def users(db):
    with Session(db) as s:
        return [(u.id, u.email, u.name) for u in s.exec(select(User))]


def test_first_sign_in_creates_the_record(monkeypatch, db):
    assert sign_in(monkeypatch, email="a@example.org", name="Ana").status_code == 200
    assert users(db) == [("u1", "a@example.org", "Ana")]


def test_repeat_sign_in_keeps_one_record(monkeypatch, db):
    def created(db):
        with Session(db) as s:
            return s.exec(select(User.created_at)).all()

    sign_in(monkeypatch, email="a@example.org", name="Ana")
    first = created(db)
    sign_in(monkeypatch, email="a@example.org", name="Ana")
    assert created(db) == first and len(first) == 1


def test_email_and_name_changes_update_the_same_record(monkeypatch, db):
    sign_in(monkeypatch, email="a@example.org", name="Ana")
    sign_in(monkeypatch, email="ana@example.org", name="Ana Lim")
    assert users(db) == [("u1", "ana@example.org", "Ana Lim")]


def test_refused_token_creates_no_record(monkeypatch, db):
    def bad(token):
        raise jwt.InvalidTokenError

    monkeypatch.setattr(keycloak, "verify", bad)
    assert client.get("/me", headers={"authorization": "Bearer t"}).status_code == 401
    assert users(db) == []
