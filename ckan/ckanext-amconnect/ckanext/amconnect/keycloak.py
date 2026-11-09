"""Keycloak login for CKAN without showing any Keycloak page (issue #1).

* CKAN's own login form: the password is checked with Keycloak's password grant.
  Keycloak users without the ``ckan-access`` realm role are refused and get no
  CKAN account. Unknown logins fall through to CKAN's own users (local sysadmin).
* ``/user/login/google``: authorization-code flow with ``kc_idp_hint=google``, so
  Keycloak only redirects and the user sees Google's page.
* Logout also ends the Keycloak session.

CKAN users are named by the Keycloak user id (a UUID fits CKAN's name rules).
"""

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import ckan.plugins as p
import ckan.plugins.toolkit as tk
import jwt
import requests
from ckan import model
from ckan.common import login_user, session
from flask import Blueprint

ROLE = "ckan-access"
CLIENT_ID = "ckan"


def _conf(key):
    return tk.config.get(f"ckanext.amconnect.keycloak.{key}")


def _oidc(base):
    return f"{base}/realms/amconnect/protocol/openid-connect"


def _token(data):
    """POST to Keycloak's token endpoint; None when Keycloak refuses."""
    r = requests.post(
        f"{_oidc(_conf('internal_url'))}/token",
        data={
            "client_id": CLIENT_ID,
            "client_secret": _conf("client_secret"),
            **data,
        },
        timeout=10,
    )
    if r.status_code in (400, 401):
        return None
    r.raise_for_status()
    return r.json()


def _claims(tokens):
    # straight from Keycloak's token endpoint over the internal network, so no
    # signature check is needed for this one-time read
    return jwt.decode(
        tokens["access_token"], options={"verify_signature": False}
    )


def _ckan_user(claims):
    """Returns the CKAN user for these Keycloak claims, creating or updating it."""
    name = claims["sub"]
    fullname = claims.get("name") or claims.get("email")
    user = model.User.get(name)
    if user is None:
        tk.get_action("user_create")(
            {"ignore_auth": True},
            {
                "name": name,
                "email": claims["email"],
                "fullname": fullname,
                "password": secrets.token_urlsafe(32),  # never used
            },
        )
        return model.User.get(name)
    if (user.email, user.fullname) != (claims["email"], fullname):
        user.email, user.fullname = claims["email"], fullname
        model.repo.commit()
    return user


def _has_access(claims):
    return ROLE in claims.get("realm_access", {}).get("roles", [])


def _deny():
    tk.h.flash_error(
        tk._("Your account has no access to the AMConnect Data Service.")
    )


def _logout_keycloak(refresh_token):
    requests.post(
        f"{_oidc(_conf('internal_url'))}/logout",
        data={
            "client_id": CLIENT_ID,
            "client_secret": _conf("client_secret"),
            "refresh_token": refresh_token,
        },
        timeout=10,
    )


# ----------------------------------------------------------------- Google flow

google = Blueprint("amconnect_keycloak", __name__)


def _redirect_uri():
    return tk.url_for("amconnect_keycloak.google_callback", _external=True)


@google.route("/user/login/google")
def google_login():
    verifier = secrets.token_urlsafe(48)
    session["kc_state"] = state = secrets.token_urlsafe(24)
    session["kc_verifier"] = verifier
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    query = urlencode(
        {
            "client_id": CLIENT_ID,
            "response_type": "code",
            "scope": "openid email profile",
            "redirect_uri": _redirect_uri(),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "kc_idp_hint": "google",
        }
    )
    return tk.redirect_to(f"{_oidc(_conf('public_url'))}/auth?{query}")


@google.route("/user/login/google/callback")
def google_callback():
    state = session.pop("kc_state", None)
    verifier = session.pop("kc_verifier", None)
    args = tk.request.args
    if not state or args.get("state") != state or "code" not in args:
        tk.h.flash_error(tk._("Google login failed. Please try again."))
        return tk.redirect_to("user.login")
    tokens = _token(
        {
            "grant_type": "authorization_code",
            "code": args["code"],
            "redirect_uri": _redirect_uri(),
            "code_verifier": verifier,
        }
    )
    if tokens is None:
        tk.h.flash_error(tk._("Google login failed. Please try again."))
        return tk.redirect_to("user.login")
    claims = _claims(tokens)
    if not _has_access(claims):
        _logout_keycloak(tokens["refresh_token"])
        _deny()
        return tk.redirect_to("user.login")
    login_user(_ckan_user(claims))
    session["kc_refresh_token"] = tokens["refresh_token"]
    return tk.redirect_to("dashboard.datasets")


# ---------------------------------------------------------------------- plugin


class AmconnectKeycloakPlugin(p.SingletonPlugin):
    p.implements(p.IAuthenticator, inherit=True)
    p.implements(p.IBlueprint)
    p.implements(p.ITemplateHelpers)

    def authenticate(self, identity):
        tokens = _token(
            {
                "grant_type": "password",
                "username": identity.get("login"),
                "password": identity.get("password"),
                "scope": "openid",
            }
        )
        if tokens is None:
            return None  # not a Keycloak user (or wrong password): CKAN's own login
        claims = _claims(tokens)
        if not _has_access(claims):
            _logout_keycloak(tokens["refresh_token"])
            _deny()
            return None
        session["kc_refresh_token"] = tokens["refresh_token"]
        return _ckan_user(claims)

    def logout(self):
        refresh_token = session.pop("kc_refresh_token", None)
        if refresh_token:
            _logout_keycloak(refresh_token)

    def get_blueprint(self):
        return google

    def get_helpers(self):
        return {
            "amconnect_google_login": lambda: _conf("google_login") == "true"
        }
