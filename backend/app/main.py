import hashlib
import os
import secrets
from collections.abc import Iterator
from datetime import timedelta
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select, text

from app import keycloak, mail
from app.db import engine
from app.models import Invitation, utcnow

PLATFORM_URL = os.environ.get("PLATFORM_URL", "http://localhost:3000")
INVITE_TTL = timedelta(days=7)

app = FastAPI(title="AMConnect API")


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())],
) -> dict:
    try:
        return keycloak.verify(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[dict, Depends(current_user)]


APP_ROLES = {"super-admin", "user-manager", "ckan-access", "geoserver-access"}


def roles_of(claims: dict) -> set[str]:
    return set(claims.get("realm_access", {}).get("roles", [])) & APP_ROLES


def grantable_roles(inviter_roles: set[str]) -> set[str]:
    """An inviter grants only access they hold; only a super admin makes new user managers."""
    allowed = inviter_roles & {"ckan-access", "geoserver-access"}
    if "super-admin" in inviter_roles:
        allowed.add("user-manager")
    return allowed


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@app.get("/health")
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}


# ------------------------------------------------------------------ auth


class Login(BaseModel):
    email: str
    password: str


class Refresh(BaseModel):
    refresh_token: str


@app.post("/auth/login")
def login(body: Login) -> dict:
    try:
        return keycloak.password_login(body.email, body.password)
    except keycloak.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")


@app.post("/auth/refresh")
def refresh(body: Refresh) -> dict:
    try:
        return keycloak.refresh(body.refresh_token)
    except keycloak.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: Refresh) -> None:
    keycloak.logout(body.refresh_token)


@app.get("/me")
def me(user: UserDep) -> dict:
    return {
        "id": user["sub"],
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": sorted(roles_of(user)),
        "grantable_roles": sorted(grantable_roles(roles_of(user))),
    }


# ------------------------------------------------------------------ invitations


class InvitationCreate(BaseModel):
    email: EmailStr
    roles: list[str]


class InvitationAccept(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    password: str


@app.post("/invitations", status_code=status.HTTP_201_CREATED)
def create_invitation(
    body: InvitationCreate, user: UserDep, session: SessionDep
) -> dict:
    inviter_roles = roles_of(user)
    if "user-manager" not in inviter_roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot invite users")
    not_allowed = set(body.roles) - grantable_roles(inviter_roles)
    if not_allowed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"You cannot grant: {', '.join(sorted(not_allowed))}",
        )
    email = body.email.lower()
    if keycloak.find_user(email):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A user with this email already exists"
        )

    token = secrets.token_urlsafe(32)
    invitation = Invitation(
        email=email,
        roles=sorted(set(body.roles)),
        keycloak_user_id=keycloak.create_user(email, sorted(set(body.roles))),
        invited_by=user["sub"],
        token_hash=hash_token(token),
        expires_at=utcnow() + INVITE_TTL,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    # shortcut: a failed send leaves the invitation without an email; add re-send when invites get managed
    mail.send_invite(
        email, f"{PLATFORM_URL}/invite/{token}", user.get("email", "Someone")
    )
    return {"id": invitation.id, "email": invitation.email, "roles": invitation.roles}


def open_invitation(token: str, session: Session) -> Invitation:
    invitation = session.exec(
        select(Invitation).where(Invitation.token_hash == hash_token(token))
    ).first()
    if not invitation or invitation.accepted_at or invitation.expires_at < utcnow():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Invitation not found or expired"
        )
    return invitation


@app.get("/invitations/{token}")
def get_invitation(token: str, session: SessionDep) -> dict:
    invitation = open_invitation(token, session)
    return {"email": invitation.email, "roles": invitation.roles}


@app.post("/invitations/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(token: str, body: InvitationAccept, session: SessionDep) -> None:
    invitation = open_invitation(token, session)
    try:
        keycloak.complete_account(
            invitation.keycloak_user_id, body.first_name, body.last_name, body.password
        )
    except keycloak.KeycloakRejected as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    invitation.accepted_at = utcnow()
    session.add(invitation)
    session.commit()
