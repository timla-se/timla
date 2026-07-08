"""JWT verification against Clerk's public JWKS endpoint.

Framework-agnostic by design — depends only on PyJWT (transitively via
PyJWKClient). The Flask-specific glue (``before_request`` hook, ``g.user``)
lives in app.py. This is the "one module mapping bearer token → user" the
self-hosting note in issue #3 asks for: swapping to a self-hosted auth
backend later only means replacing this module.

Configuration: reads CLERK_PUBLISHABLE_KEY from the environment. The issuer
and JWKS URL are derived from the publishable key (Clerk encodes the frontend
API domain as base64 in the second half of the key).

Unlike OpenVera's version of this module, there is no machine/M2M token
support and no Clerk-organization-claim parsing — Timla's org membership is
looked up locally (see api_utils.current_org), not read from the token.
"""

import base64
import os
from dataclasses import dataclass
from typing import Optional

import jwt
from jwt import PyJWKClient


class ClerkAuthError(Exception):
    """Raised when token verification fails or auth is not configured."""


@dataclass(frozen=True)
class ClerkUser:
    sub: str  # Clerk user ID (e.g. "user_2abc...")
    email: Optional[str]
    raw_claims: dict


def _derive_issuer_from_publishable_key(pk: str) -> str:
    """Clerk publishable keys encode the frontend API domain.

    Format: ``pk_(test|live)_<base64(frontend_api_url + '$')>``.
    """
    parts = pk.split('_', 2)
    if len(parts) != 3 or parts[0] != 'pk':
        raise ClerkAuthError(f'Malformed CLERK_PUBLISHABLE_KEY: {pk[:8]}...')
    encoded = parts[2]
    # Restore base64 padding (Clerk strips trailing '=').
    encoded += '=' * (-len(encoded) % 4)
    try:
        domain = base64.b64decode(encoded).decode('utf-8').rstrip('$')
    except Exception as e:  # noqa: BLE001
        raise ClerkAuthError(f'Could not decode publishable key: {e}')
    return f'https://{domain}'


_publishable_key = os.environ.get('CLERK_PUBLISHABLE_KEY', '').strip()
_issuer = (
    _derive_issuer_from_publishable_key(_publishable_key) if _publishable_key else ''
)
_jwks_url = f'{_issuer}/.well-known/jwks.json' if _issuer else ''

# PyJWKClient caches keys in-memory and refetches on rotation/cache miss.
_jwks_client: Optional[PyJWKClient] = PyJWKClient(_jwks_url) if _jwks_url else None


def is_configured() -> bool:
    return _jwks_client is not None


def verify_clerk_token(token: str) -> ClerkUser:
    """Verify a Clerk session JWT. Raises ClerkAuthError on any failure."""
    if _jwks_client is None:
        raise ClerkAuthError('Clerk auth not configured (CLERK_PUBLISHABLE_KEY missing)')
    if not token:
        raise ClerkAuthError('No token provided')
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256'],
            issuer=_issuer,
            # Clerk session JWTs don't set an `aud` claim by default.
            options={'verify_aud': False},
        )
    except jwt.PyJWTError as e:
        raise ClerkAuthError(f'Invalid token: {e}')
    # email is best-effort: default Clerk session tokens carry no `email`
    # claim (it needs a custom token template), so this is usually None and
    # org_user.email ends up NULL. #29 must not assume it's populated.
    return ClerkUser(sub=claims['sub'], email=claims.get('email'), raw_claims=claims)
