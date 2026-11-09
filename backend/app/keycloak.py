"""Server-side calls to Keycloak. Users never see a Keycloak page (issue #1), so
password login goes through the password grant here, not a browser redirect."""

import os

import httpx2
import jwt

INTERNAL_URL = os.environ["KEYCLOAK_INTERNAL_URL"]  # as reached from this container
ISSUER = os.environ["KEYCLOAK_ISSUER"]  # as written in tokens (the browser URL)
OIDC = f"{INTERNAL_URL}/realms/amconnect/protocol/openid-connect"
ADMIN = f"{INTERNAL_URL}/admin/realms/amconnect"
PLATFORM = {
    "client_id": "platform",
    "client_secret": os.environ["PLATFORM_CLIENT_SECRET"],
}
PLATFORM_ADMIN = {
    "client_id": "platform-admin",
    "client_secret": os.environ["PLATFORM_ADMIN_CLIENT_SECRET"],
}

_jwks = jwt.PyJWKClient(f"{OIDC}/certs")


class InvalidCredentials(Exception):
    pass


class KeycloakRejected(Exception):
    """Keycloak refused an admin request, e.g. a password that fails the realm policy."""


def _token(data: dict, client: dict) -> dict:
    r = httpx2.post(f"{OIDC}/token", data={**client, **data})
    if r.status_code in (400, 401):
        raise InvalidCredentials
    r.raise_for_status()
    return r.json()


def password_login(email: str, password: str) -> dict:
    return _token(
        {
            "grant_type": "password",
            "username": email,
            "password": password,
            "scope": "openid",
        },
        PLATFORM,
    )


def refresh(refresh_token: str) -> dict:
    return _token(
        {"grant_type": "refresh_token", "refresh_token": refresh_token}, PLATFORM
    )


def logout(refresh_token: str) -> None:
    """Ends the Keycloak session, which also signs out of Google-based SSO."""
    httpx2.post(f"{OIDC}/logout", data={**PLATFORM, "refresh_token": refresh_token})


def verify(access_token: str) -> dict:
    key = _jwks.get_signing_key_from_jwt(access_token).key
    # Keycloak access tokens carry no audience for our API; azp names the client they were issued to
    claims = jwt.decode(
        access_token,
        key,
        algorithms=["RS256"],
        issuer=ISSUER,
        options={"verify_aud": False},
    )
    if claims.get("azp") != "platform":
        raise jwt.InvalidTokenError("token was not issued to the platform client")
    return claims


def _admin() -> httpx2.Client:
    token = _token({"grant_type": "client_credentials"}, PLATFORM_ADMIN)["access_token"]
    return httpx2.Client(base_url=ADMIN, headers={"Authorization": f"Bearer {token}"})


def find_user(email: str) -> dict | None:
    with _admin() as kc:
        r = kc.get("/users", params={"email": email, "exact": "true"})
        r.raise_for_status()
        return next(iter(r.json()), None)


def create_user(email: str, roles: list[str]) -> str:
    """Creates an enabled user with a verified email and no password, so Google login can
    link to it right away. Returns the Keycloak user id."""
    with _admin() as kc:
        reps = []  # looked up first, so a bad role name fails before the user exists
        for name in roles:
            role = kc.get(f"/roles/{name}")
            role.raise_for_status()
            reps.append(role.json())
        r = kc.post(
            "/users",
            json={
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
            },
        )
        r.raise_for_status()
        user_id = r.headers["Location"].rsplit("/", 1)[1]
        kc.post(f"/users/{user_id}/role-mappings/realm", json=reps).raise_for_status()
        return user_id


def complete_account(
    user_id: str, first_name: str, last_name: str, password: str
) -> None:
    """Sets the name (Keycloak's user profile requires it before login) and the password."""
    with _admin() as kc:
        kc.put(
            f"/users/{user_id}", json={"firstName": first_name, "lastName": last_name}
        ).raise_for_status()
        r = kc.put(
            f"/users/{user_id}/reset-password",
            json={"type": "password", "value": password, "temporary": False},
        )
        if r.status_code == 400:
            raise KeycloakRejected(
                r.json().get("error_description", "Password rejected")
            )
        r.raise_for_status()
