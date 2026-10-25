"""next, CORE.md section 7.

    next(state, key, client, now) -> one piece or None

1. Candidates: every piece that is open, in_flight, sealed, needs_verify or
   disputed; whose requires is within client.can; to which the key's root is
   unrelated and has no reveal, run or live claim; not declined by the key
   in this version.
2. Order by availability ascending; then by the number of pieces that name
   it in inputs, descending; then by sha256(canonical([piece, key, hour]))
   ascending; then by position in the file.
3. When the pieces in needs_verify or disputed outnumber those open, take
   candidates from those first; among them, prefer pieces no reveal of which
   is from client.model's vendor.
4. When the pieces not yet accepted or unreachable number at most
   endgame_at, live claims count zero in availability.
5. Return the first candidate with its brief rendered, its schema, its agree
   fields, its requires, and its lease.
"""

import re

from .hashes import hash_json
from .identity import same_address
from .reducer import (OFFERABLE, DONE, live_claims, root_weights, availability,
                      vendor_of)
from .times import parse_time, hour_string

_SLOT = re.compile(r"\{([^{}]+)\}")


def tiebreak(piece_hash: str, key: str, hour: str) -> str:
    return hash_json([piece_hash, key, hour])


def _related_to_piece(piece, root, state):
    ident = state.identity
    for rv in piece.reveals:
        if ident.related(root, rv["root"], state.owner):
            return True
    for run in piece.runs:
        if ident.related(root, run["root"], state.owner):
            return True
    return False


def _declined(piece, root, state):
    for d in piece.declines:
        if d["problem"] == state.problem_hash and same_address(state.identity.resolve(d["root"]), root):
            return True
    return False


def _has_live_claim(piece, root, state, now):
    return any(same_address(state.identity.resolve(c["root"]), root) for c in live_claims(piece, now))


def next_piece(state, key, client, now):
    now = parse_time(now) or state.now
    can = set((client or {}).get("can") or [])
    vendor = vendor_of(client or {})
    root = state.identity.resolve(key)
    # "neither is the problem's owner": the owner is related to every piece
    if same_address(root, state.owner):
        return None
    pieces = state.pieces
    candidates = []
    for piece in pieces:
        if piece.state not in OFFERABLE:
            continue
        if not set(piece.spec.get("requires") or []) <= can:
            continue
        if _related_to_piece(piece, root, state):
            continue
        if _has_live_claim(piece, root, state, now):
            continue
        if _declined(piece, root, state):
            continue
        candidates.append(piece)
    if not candidates:
        return None

    endgame = sum(1 for p in pieces if p.state not in DONE) <= state.settings["endgame_at"]
    weights = root_weights(state)
    hour = hour_string(now)

    # Counted over the problem's pieces, not over the candidates (FINDINGS.md).
    n_verify = sum(1 for p in pieces if p.state in ("needs_verify", "disputed"))
    n_open = sum(1 for p in pieces if p.state == "open")
    prefer_other_vendor = False
    if n_verify > n_open:
        verifying = [p for p in candidates if p.state in ("needs_verify", "disputed")]
        if verifying:
            candidates = verifying
            prefer_other_vendor = True

    def order(piece):
        same_vendor = 1 if (prefer_other_vendor and any(rv["vendor"] == vendor for rv in piece.reveals)) else 0
        return (
            same_vendor,
            availability(piece, state, weights, endgame),
            -piece.dependents,
            tiebreak(piece.hash, key, hour),
            piece.spec["position"],
        )

    candidates.sort(key=order)
    return render(candidates[0], state)


def render(piece, state):
    """The pick: the brief with its slots for other pieces' returns filled
    with the accepting set's returns as quoted text with the signers'
    addresses, the schema, the agree fields, the requires and the lease."""
    def fill(m):
        slot = m.group(1)
        named = [p for p in state.pieces if p.name == slot or (slot.endswith("/*") and p.spec["family"] == slot[:-2])]
        if not named:
            return m.group(0)
        lines = []
        for p in named:
            if p.accepting is None:
                continue
            for rv in p.accepting["reveals"]:
                quoted = "; ".join("%s: %s" % (k, v) for k, v in rv["ret"].items())
                lines.append('%s, signed %s: "%s"' % (p.name, rv["key"], quoted))
        return "\n".join(lines) if lines else m.group(0)

    brief = _SLOT.sub(fill, piece.spec["brief"])
    lease = piece.spec.get("lease_h", state.settings["lease_h"])
    return {
        "piece": piece.name,
        "hash": piece.hash,
        "verifier": piece.verifier,
        "state": piece.state,
        "brief": brief,
        "schema": piece.spec.get("schema"),
        "agree": piece.agree_fields(),
        "requires": list(piece.spec.get("requires") or []),
        "lease_h": lease,
        "workspace": piece.spec.get("workspace"),
        "check": piece.spec.get("check"),
    }
