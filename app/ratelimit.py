"""In-memory IP-keyed sliding-window rate limiter for the unauthenticated
/svar surface (issue #13).

Deliberately dependency-free: a per-process dict of key -> deque of recent
request timestamps. Resets on restart and is per-gunicorn-worker — acceptable
because the 192-bit share token is the real defense; this only throttles blind
token guessing (keying by IP, not token, so distinct guessed tokens share one
bucket). Trusts the client IP resolved by ProxyFix (x_for=1), i.e. assumes
exactly one fronting proxy hop in prod — a no-proxy deployment would let a
client spoof X-Forwarded-For to rotate keys.
"""
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60
MAX_REQUESTS = 30
_MAX_KEYS = 10000  # safety cap: full sweep of expired keys when exceeded

_hits: dict[str, deque] = defaultdict(deque)


def _sweep(cutoff):
    for key in list(_hits.keys()):
        dq = _hits[key]
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if not dq:
            del _hits[key]


def check(key, now=None):
    """Record a hit for ``key``; return True if within the limit, False if it
    should be rejected. Prunes the key's expired timestamps each call, and
    sweeps the whole dict if it grows past the safety cap (bounds memory under
    spray traffic from many distinct IPs)."""
    now = time.monotonic() if now is None else now
    cutoff = now - WINDOW_SECONDS
    if len(_hits) > _MAX_KEYS:
        _sweep(cutoff)
    dq = _hits[key]
    while dq and dq[0] <= cutoff:
        dq.popleft()
    if len(dq) >= MAX_REQUESTS:
        if not dq:
            del _hits[key]
        return False
    dq.append(now)
    return True


def reset():
    """Clear all state (tests)."""
    _hits.clear()
