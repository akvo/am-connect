from datetime import UTC, datetime

from sqlmodel import JSON, Column, Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


class Invitation(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    roles: list[str] = Field(sa_column=Column(JSON, nullable=False))
    keycloak_user_id: str
    invited_by: str  # Keycloak user id of the inviter
    token_hash: str = Field(unique=True)
    expires_at: datetime
    accepted_at: datetime | None = None
    created_at: datetime = Field(default_factory=utcnow)
