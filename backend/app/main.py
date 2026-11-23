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
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select, text

from app import keycloak, mail
from app.access import LABELS, NotAllowed, check_grant, grantable_roles, roles_of
from app.db import engine
from app.models import Invitation, User, utcnow

PLATFORM_URL = os.environ.get("PLATFORM_URL", "http://localhost:3000")
INVITE_TTL = timedelta(days=7)

app = FastAPI(title="AMConnect API")


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def record_user(claims: dict, session: Session) -> None:
    """Keeps the user record in step with Keycloak. Checked on every request because
    Google and Microsoft sign-in never pass through /auth/login."""
    email, name = claims.get("email", ""), claims.get("name")
    user = session.get(User, claims["sub"])
    if user and (user.email, user.name) == (email, name):
        return
    user = user or User(id=claims["sub"], email=email)
    user.email, user.name = email, name
    session.add(user)
    try:
        session.commit()
    except IntegrityError:  # a parallel first request created it
        session.rollback()


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())],
    session: SessionDep,
) -> dict:
    try:
        claims = keycloak.verify(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    record_user(claims, session)
    return claims


UserDep = Annotated[dict, Depends(current_user)]


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
        "grantable_roles": sorted(grantable_roles(user)),
        "role_labels": LABELS,
    }


# ------------------------------------------------------------------ invitations


class InvitationCreate(BaseModel):
    email: EmailStr
    roles: list[str]


class InvitationAccept(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    password: str


def replace_unfinished_user(email: str, session: Session) -> None:
    """A user who never signed in (invite expired, or a failed invite) is deleted so the
    invitation can start over; anyone who did sign in is a conflict."""
    existing = keycloak.find_user(email)
    if not existing:
        return
    if keycloak.can_sign_in(existing["id"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A user with this email already exists"
        )
    keycloak.delete_user(existing["id"])
    session.exec(
        delete(Invitation).where(
            col(Invitation.email) == email, col(Invitation.accepted_at).is_(None)
        )
    )
    session.commit()  # the Keycloak user is already gone


@app.post("/invitations", status_code=status.HTTP_201_CREATED)
def create_invitation(
    body: InvitationCreate, user: UserDep, session: SessionDep
) -> dict:
    try:
        check_grant(user, set(body.roles))
    except NotAllowed as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    email = body.email.lower()
    replace_unfinished_user(email, session)

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
    mail.send_invite(
        email, f"{PLATFORM_URL}/invite/{token}", user.get("email", "Someone")
    )
    return {"id": invitation.id, "email": invitation.email, "roles": invitation.roles}


def open_invitation(token: str, session: Session) -> Invitation:
    invitation = session.exec(
        select(Invitation).where(Invitation.token_hash == hash_token(token))
    ).first()
    gone = HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found or expired")
    if not invitation or invitation.accepted_at or invitation.expires_at < utcnow():
        raise gone
    # joined with Google or Microsoft instead: the link must not set a password on a live account
    if keycloak.can_sign_in(invitation.keycloak_user_id):
        invitation.accepted_at = utcnow()
        session.add(invitation)
        session.commit()
        raise gone
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
