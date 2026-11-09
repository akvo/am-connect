"""app.keycloak against a fake Keycloak: only the HTTP boundary is replaced."""

import json
import time
from types import SimpleNamespace

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import keycloak

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def kc(monkeypatch):
    """Routes keycloak.py's HTTP calls to `kc.routes`; records every request."""

    fake = SimpleNamespace(routes={}, requests=[])  # routes: (method, path) -> Response

    def handle(request):
        fake.requests.append(request)
        return fake.routes.get((request.method, request.url.path), httpx2.Response(404))

    transport = httpx2.MockTransport(handle)
    real_client = httpx2.Client
    monkeypatch.setattr(
        httpx2,
        "post",
        lambda url, **kw: real_client(transport=transport).post(url, **kw),
    )
    monkeypatch.setattr(
        httpx2, "Client", lambda **kw: real_client(transport=transport, **kw)
    )
    fake.routes[("POST", "/realms/amconnect/protocol/openid-connect/token")] = (
        httpx2.Response(200, json={"access_token": "admin-token"})
    )
    return fake


ADMIN = "/admin/realms/amconnect"
TOKEN = ("POST", "/realms/amconnect/protocol/openid-connect/token")


def test_password_login_returns_keycloak_tokens(kc):
    kc.routes[TOKEN] = httpx2.Response(200, json={"access_token": "t"})
    assert keycloak.password_login("a@example.org", "pw") == {"access_token": "t"}
    sent = dict(httpx2.QueryParams(kc.requests[-1].content.decode()))
    assert sent["grant_type"] == "password"
    assert sent["username"] == "a@example.org"
    assert sent["client_id"] == "platform"


@pytest.mark.parametrize("status", [400, 401])
def test_password_login_refused_raises_invalid_credentials(kc, status):
    kc.routes[TOKEN] = httpx2.Response(status, json={"error": "invalid_grant"})
    with pytest.raises(keycloak.InvalidCredentials):
        keycloak.password_login("a@example.org", "wrong")


def test_refresh_sends_the_refresh_token(kc):
    kc.routes[TOKEN] = httpx2.Response(200, json={"access_token": "new"})
    assert keycloak.refresh("r1") == {"access_token": "new"}
    assert "refresh_token=r1" in kc.requests[-1].content.decode()


def test_logout_ends_the_keycloak_session(kc):
    keycloak.logout("r1")
    request = kc.requests[-1]
    assert request.url.path.endswith("/openid-connect/logout")
    assert "refresh_token=r1" in request.content.decode()


def test_find_user_returns_first_match_or_none(kc):
    kc.routes[("GET", f"{ADMIN}/users")] = httpx2.Response(200, json=[{"id": "u1"}])
    assert keycloak.find_user("a@example.org") == {"id": "u1"}
    assert kc.requests[-1].headers["authorization"] == "Bearer admin-token"
    kc.routes[("GET", f"{ADMIN}/users")] = httpx2.Response(200, json=[])
    assert keycloak.find_user("nobody@example.org") is None


def test_create_user_creates_then_maps_roles(kc):
    role = {"id": "r-ckan", "name": "ckan-access"}
    kc.routes[("GET", f"{ADMIN}/roles/ckan-access")] = httpx2.Response(200, json=role)
    kc.routes[("POST", f"{ADMIN}/users")] = httpx2.Response(
        201, headers={"Location": f"http://keycloak{ADMIN}/users/u-new"}
    )
    kc.routes[("POST", f"{ADMIN}/users/u-new/role-mappings/realm")] = httpx2.Response(
        204
    )

    assert keycloak.create_user("b@example.org", ["ckan-access"]) == "u-new"
    created = json.loads(kc.requests[-2].content)
    assert created["email"] == "b@example.org" and created["emailVerified"] is True
    assert json.loads(kc.requests[-1].content) == [role]


def test_create_user_with_unknown_role_creates_nobody(kc):
    with pytest.raises(httpx2.HTTPStatusError):
        keycloak.create_user("b@example.org", ["no-such-role"])
    assert not [
        r for r in kc.requests if r.method == "POST" and r.url.path.endswith("/users")
    ]


def test_complete_account_sets_name_and_password(kc):
    kc.routes[("PUT", f"{ADMIN}/users/u1")] = httpx2.Response(204)
    kc.routes[("PUT", f"{ADMIN}/users/u1/reset-password")] = httpx2.Response(204)
    keycloak.complete_account("u1", "Ann", "Lee", "s3cret-pw")
    assert json.loads(kc.requests[-2].content) == {
        "firstName": "Ann",
        "lastName": "Lee",
    }
    assert json.loads(kc.requests[-1].content)["value"] == "s3cret-pw"


def test_complete_account_reports_rejected_password(kc):
    kc.routes[("PUT", f"{ADMIN}/users/u1")] = httpx2.Response(204)
    kc.routes[("PUT", f"{ADMIN}/users/u1/reset-password")] = httpx2.Response(
        400, json={"error_description": "Password too short"}
    )
    with pytest.raises(keycloak.KeycloakRejected, match="Password too short"):
        keycloak.complete_account("u1", "Ann", "Lee", "x")


# ------------------------------------------------------------------ verify


def signed(**claims):
    claims = {
        "iss": keycloak.ISSUER,
        "azp": "platform",
        "exp": time.time() + 60,
        **claims,
    }
    return jwt.encode(claims, KEY, algorithm="RS256")


@pytest.fixture
def signing_key(monkeypatch):
    # replaces the JWKS fetch from Keycloak
    monkeypatch.setattr(
        keycloak._jwks,
        "get_signing_key_from_jwt",
        lambda token: type("Key", (), {"key": KEY.public_key()}),
    )


def test_verify_accepts_platform_token(signing_key):
    assert keycloak.verify(signed(sub="u1"))["sub"] == "u1"


@pytest.mark.parametrize(
    "claims",
    [
        {"azp": "ckan"},
        {"iss": "http://elsewhere/realms/amconnect"},
        {"exp": time.time() - 60},
    ],
)
def test_verify_rejects_other_clients_issuers_and_expired(signing_key, claims):
    with pytest.raises(jwt.InvalidTokenError):
        keycloak.verify(signed(**claims))
