"""Roles and country scope read from Keycloak tokens, and who may grant what.

Country scope is a role, `aocp-<country code>`, because GeoServer reads only roles."""

COUNTRIES = {
    "bn": "Brunei Darussalam",
    "kh": "Cambodia",
    "id": "Indonesia",
    "la": "Lao PDR",
    "my": "Malaysia",
    "mm": "Myanmar",
    "ph": "Philippines",
    "sg": "Singapore",
    "th": "Thailand",
    "tl": "Timor-Leste",
    "vn": "Viet Nam",
}
AOCP_ROLES = {f"aocp-{code}": name for code, name in COUNTRIES.items()}
LABELS = {
    "super-admin": "Super Admin",
    "geoserver-access": "Restricted GeoServer layers",
    "asec": "ASEC",
    "amvest-admin": "AMVest Admin",
    "amvest-user": "AMVest user",
    **{role: f"AOCP – {name}" for role, name in AOCP_ROLES.items()},
}
ACCESS_SWITCHES = {"geoserver-access"}
PERSONAS = {"super-admin", "asec", "amvest-admin", *AOCP_ROLES}
# Platform areas and the roles that open them; None means anyone signed in
MANAGERS = {"super-admin", "asec", *AOCP_ROLES}
AREAS: dict[str, set[str] | None] = {"cms": MANAGERS, "users": MANAGERS, "webgis": None}


class NotAllowed(Exception):
    pass


def roles_of(claims: dict) -> set[str]:
    """App roles in the token; the bare `aocp` composite is left out, it names no country."""
    return set(claims.get("realm_access", {}).get("roles", [])) & LABELS.keys()


def can_manage(claims: dict, roles: set[str]) -> bool:
    """Whoever may grant all of a user's personas manages them; access switches don't count."""
    personas = roles & PERSONAS
    return bool(personas) and personas <= grantable_roles(claims)


def areas_of(claims: dict) -> set[str]:
    roles = roles_of(claims)
    return {area for area, need in AREAS.items() if need is None or roles & need}


def grantable_roles(claims: dict) -> set[str]:
    """Personas by the inviter's role; access switches only by those who can invite."""
    roles = roles_of(claims)
    allowed = roles & AOCP_ROLES.keys()  # AOCP grants their own countries
    if "super-admin" in roles:
        allowed |= {"asec", "amvest-admin", *AOCP_ROLES}
    if "asec" in roles:
        allowed |= {"asec", *AOCP_ROLES}
    if allowed:
        allowed |= roles & ACCESS_SWITCHES
    return allowed


def check_grant(claims: dict, roles: set[str]) -> None:
    """Raises NotAllowed unless this inviter may give these roles."""
    allowed = grantable_roles(claims)
    if not allowed:
        raise NotAllowed("You cannot invite users")
    not_allowed = roles - allowed
    if not_allowed:
        raise NotAllowed(f"You cannot grant: {', '.join(sorted(not_allowed))}")
