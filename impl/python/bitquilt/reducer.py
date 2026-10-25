"""The reducer, CORE.md section 6.

    state = reduce(envelopes, blobs, receipts, now)

A pure function of its arguments. Where CORE.md leaves a choice open, the
choice is named in a comment and in FINDINGS.md.
"""

import hashlib
import unicodedata
from datetime import date

from .canonical import canonical, canonical_bytes
from .hashes import hash_json
from .identity import signer_of, signed_body, same_address
from .envelope import (problem_hash, expand, validate_envelope, EnvelopeError,
                       REQUIRES, CORE_VERIFIERS)
from .schema import validate_return
from .times import parse_time, hours

DECLINE_REASONS = ("cannot", "unclear", "refuse", "duplicate", "no_time")
PIECE_EVENTS = ("claim", "commit", "reveal", "decline", "run")
PROBLEM_EVENTS = PIECE_EVENTS + ("version", "output")
IDENTITY_EVENTS = ("name", "delegate", "revoke", "rotate")
CORE_EVENTS = PROBLEM_EVENTS + IDENTITY_EVENTS

DONE = ("accepted", "unreachable")
OFFERABLE = ("open", "in_flight", "sealed", "needs_verify", "disputed")


def event_id(event: dict) -> str:
    """The hash of the event without `sig` and `sig_to`."""
    return hash_json(signed_body(event))


def commit_hash(ret, nonce: str) -> str:
    """`h`: SHA-256 over the UTF-8 of the return's canonical JSON followed by
    the UTF-8 of the nonce."""
    return "sha256:" + hashlib.sha256(canonical_bytes(ret) + nonce.encode("utf-8")).hexdigest()


def vendor_of(by) -> str:
    """The part of `by.model` before the first slash; `human` is a vendor."""
    model = by.get("model") if isinstance(by, dict) else None
    if not isinstance(model, str):
        return ""
    return model.split("/", 1)[0]


class Piece:
    """One piece of the chain, by hash, with the sets its state is a
    function of."""

    def __init__(self, spec):
        self.spec = spec
        self.name = spec["name"]
        self.hash = spec["hash"]
        self.verifier = spec["verifier"]
        self.claims = []     # {key, root, at, lease, seq}
        self.commits = []    # {key, root, at, h, seq, revealed}
        self.reveals = []    # {key, root, at, ret, by, vendor, seq, id, digest}
        self.runs = []       # {key, root, at, digest, exit, score, seq, id}
        self.declines = []   # {key, root, problem}
        self.accepting = None  # {at, reveals: [...], runs: [...], kind}
        self.frontier = None   # score: the best reproduced score, by `better`
        self.state = None
        self.availability = 0.0
        self.dependents = 0

    def agree_fields(self):
        if self.verifier in ("check", "score"):
            return []
        agree = self.spec.get("agree")
        if agree is None:
            return list(self.spec.get("schema", {}).get("required", []))
        return list(agree)


class State:
    """What `reduce` returns: the chain, every piece by hash, the problem's
    pieces in file order with their states, the identity graph, what was
    dropped and why, and the output."""

    def __init__(self):
        self.problem = None          # this problem's envelope
        self.problem_hash = None
        self.chain = []              # envelopes, this problem first
        self.chain_hashes = []
        self.owner = None
        self.settings = {}
        self.pieces = []             # this problem's pieces, file order
        self.by_hash = {}            # every piece in the chain, by hash
        self.by_name = {}            # this problem's pieces, by name
        self.now = None
        self.dropped = []            # (reason, event)
        self.ignored = []            # extension events
        self.events = []             # folded, in order
        self.identity = Identity()
        self.complete = False
        self.output = None
        self.output_document = None

    def states(self):
        return {p.name: p.state for p in self.pieces}

    def resolve(self, key):
        return self.identity.resolve(key)


class Identity:
    """Roots, delegates and rotations, with the time each stood."""

    def __init__(self):
        self.delegations = {}   # delegate key -> {root, scope, expires, since, revoked}
        self.rotations = {}     # old root -> {to, since}
        self.has_event = set()  # keys with a kept event as `key`
        self.seq = 0

    def is_root(self, key):
        return key not in self.delegations and key not in self.rotations

    def resolve(self, key, at_seq=None):
        """The root a key stands for, following rotations and delegations
        with no check of scope or expiry (that is `authority`)."""
        seen = set()
        while True:
            if key in seen:
                return key
            seen.add(key)
            rot = self.rotations.get(key)
            if rot is not None and (at_seq is None or rot["since"] <= at_seq):
                key = rot["to"]
                continue
            d = self.delegations.get(key)
            if d is not None and (at_seq is None or d["since"] <= at_seq):
                key = d["root"]
                continue
            return key

    def authority(self, key, type_, at, seq):
        """(root, reason): the root an event from `key` of `type_` received
        at `at` counts for, or (None, why) when it counts for nobody."""
        rot = self.rotations.get(key)
        if rot is not None:
            # "the old root is a delegate of the new until revoked"
            if rot.get("revoked") is not None:
                return None, "the old root was revoked"
            return self.resolve(rot["to"]), None
        d = self.delegations.get(key)
        if d is None:
            return key, None
        if type_ not in d["scope"]:
            return None, "the delegation does not cover this event"
        if d.get("revoked") is not None:
            return None, "the delegation was revoked"
        if at is not None and d["expires"] is not None and not (d["expires"] > at):
            return None, "the delegation has expired"
        return self.resolve(d["root"]), None

    def related(self, root_a, root_b, owner):
        """Two roots are related unless neither is the other, neither is a
        delegate of the other, and neither is the owner."""
        if same_address(root_a, owner) or same_address(root_b, owner):
            return True
        return same_address(self.resolve(root_a), self.resolve(root_b))


def _ordered_receipts(receipts):
    """Merge wrappers and sort: receipted events by their earliest
    `received.at` then id; unreceipted events after, by `ts` then id."""
    merged = {}
    for r in receipts:
        if not isinstance(r, dict):
            continue
        if "event" in r:
            event, received = r["event"], r.get("received") or []
        else:
            event, received = r, []
        if not isinstance(event, dict):
            continue
        eid = event_id(event)
        # Two events can share an id and differ in `sig_to` (fixture 11), so
        # wrappers are merged only when the signed object is the same.
        k = (eid, canonical(event))
        entry = merged.setdefault(k, {"event": event, "id": eid, "received": []})
        entry["received"].extend(x for x in received if isinstance(x, dict))
    out = []
    for entry in merged.values():
        ats = [parse_time(x.get("at")) for x in entry["received"]]
        ats = [a for a in ats if a is not None]
        entry["at"] = min(ats) if ats else None
        entry["ts"] = parse_time(entry["event"].get("ts"))
        out.append(entry)
    receipted = [e for e in out if e["at"] is not None]
    bare = [e for e in out if e["at"] is None]
    receipted.sort(key=lambda e: (e["at"], e["id"]))
    bare.sort(key=lambda e: (e["ts"] or parse_time("9999-12-31T23:59:59Z"), e["id"]))
    return receipted + bare


def _assemble_chain(envelopes, blobs, state):
    by_hash = {}
    for env in envelopes:
        validate_envelope(env, blobs)
        by_hash[problem_hash(env)] = env
    named_as_prev = {env["problem"].get("prev") for env in envelopes}
    heads = [h for h in by_hash if h not in named_as_prev]
    head = heads[0] if heads else problem_hash(envelopes[0])
    chain = []
    h = head
    seen = set()
    while h is not None and h in by_hash and h not in seen:
        seen.add(h)
        env = by_hash[h]
        if chain and not same_address(env["problem"]["owner"], chain[-1]["problem"]["owner"]):
            raise EnvelopeError("prev %s is not by the same owner" % h)
        chain.append(env)
        h = env["problem"].get("prev")
    state.problem = chain[0]
    state.problem_hash = problem_hash(chain[0])
    state.chain = chain
    state.chain_hashes = [problem_hash(e) for e in chain]
    state.owner = chain[0]["problem"]["owner"]
    state.settings = chain[0]["problem"]["settings"]
    for env in chain:
        for spec in expand(env, blobs):
            if spec["hash"] not in state.by_hash:
                state.by_hash[spec["hash"]] = Piece(spec)
    for spec in expand(chain[0], blobs):
        piece = state.by_hash[spec["hash"]]
        state.pieces.append(piece)
        state.by_name[piece.name] = piece


def _lease_of(piece, state, claim_body=None):
    if claim_body and isinstance(claim_body.get("lease_h"), (int, float)) and claim_body["lease_h"] > 0:
        return hours(claim_body["lease_h"])
    if isinstance(piece.spec.get("lease_h"), (int, float)):
        return hours(piece.spec["lease_h"])
    return hours(state.settings["lease_h"])


def _valid_by(by):
    if not isinstance(by, dict):
        return False
    model = by.get("model")
    if not isinstance(model, str) or not (model == "human" or ("/" in model and not model.startswith("/"))):
        return False
    if not isinstance(by.get("client"), str):
        return False
    can = by.get("can")
    return isinstance(can, list) and all(c in REQUIRES for c in can)


# ---------------------------------------------------------------- agreement

def _fold_ws(s):
    return " ".join(s.split())


def canonical_field(value, prop):
    """Canonicalisation of an `agree` field: strings lower-cased, whitespace
    folded, NFC; enums as themselves; dates as dates; arrays element by
    element. Numbers are compared by `numbers_agree`."""
    if prop is None:
        return value
    if "enum" in prop:
        return value
    t = prop.get("type")
    if t == "string":
        if not isinstance(value, str):
            return value
        if prop.get("format") == "date":
            try:
                return date.fromisoformat(value)
            except ValueError:
                return value
        return unicodedata.normalize("NFC", _fold_ws(value.strip()).lower())
    if t == "array":
        if not isinstance(value, list):
            return value
        return [canonical_field(v, prop.get("items")) for v in value]
    return value


def fields_agree(a, b, prop):
    if prop is not None and prop.get("type") in ("number", "integer"):
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            return False
        tol = prop.get("tolerance", 0) or 0
        return abs(a - b) <= tol
    if prop is not None and prop.get("type") == "array":
        if not isinstance(a, list) or not isinstance(b, list) or len(a) != len(b):
            return False
        return all(fields_agree(x, y, prop.get("items")) for x, y in zip(a, b))
    return canonical_field(a, prop) == canonical_field(b, prop)


def returns_agree(piece, ret_a, ret_b):
    props = piece.spec.get("schema", {}).get("properties", {})
    for f in piece.agree_fields():
        if f not in ret_a or f not in ret_b:
            return False
        if not fields_agree(ret_a[f], ret_b[f], props.get(f)):
            return False
    return True


def _two_unrelated_differ(piece, state, upto_seq=None):
    """Two reveals from unrelated roots that differ on an agree field."""
    reveals = [r for r in piece.reveals if upto_seq is None or r["seq"] < upto_seq]
    for i, a in enumerate(reveals):
        for b in reveals[i + 1:]:
            if state.identity.related(a["root"], b["root"], state.owner):
                continue
            if not returns_agree(piece, a["ret"], b["ret"]):
                return True
    return False


def _try_complete_agree(piece, r, state):
    """On a new reveal `r`, look for an accepting set it completes."""
    disputed = _two_unrelated_differ(piece, state, upto_seq=r["seq"])
    prior = [p for p in piece.reveals if p["seq"] < r["seq"]]
    if disputed:
        # "a reveal from a root unrelated to both prior roots completes a set"
        if any(state.identity.related(r["root"], p["root"], state.owner) for p in prior):
            return
    for p in prior:
        if state.identity.related(p["root"], r["root"], state.owner):
            continue
        if p["vendor"] == r["vendor"]:
            continue
        if returns_agree(piece, p["ret"], r["ret"]):
            piece.accepting = {"at": r["at"], "seq": r["seq"], "kind": "agree", "reveals": [p, r], "runs": []}
            return


def _try_complete_runs(piece, run, state):
    """On a new run, look for the pair of runs that accepts the piece."""
    reveal = next((rv for rv in piece.reveals if rv["digest"] == run["digest"]), None)
    if reveal is None or run.get("exit") != 0:
        return
    if piece.verifier == "score" and not isinstance(run.get("score"), (int, float)):
        return
    tol = (piece.spec.get("check") or {}).get("tolerance", 0) or 0
    for other in piece.runs:
        if other is run or other["digest"] != run["digest"] or other.get("exit") != 0:
            continue
        if state.identity.related(other["root"], run["root"], state.owner):
            continue
        if piece.verifier == "score":
            if not isinstance(other.get("score"), (int, float)):
                continue
            if abs(other["score"] - run["score"]) > tol:
                continue
        piece.accepting = {"at": run["at"], "seq": run["seq"], "kind": piece.verifier,
                           "reveals": [reveal], "runs": [other, run]}
        return


# ---------------------------------------------------------------- the fold

def _drop(state, reason, event):
    state.dropped.append((reason, event))


def reduce(envelopes, blobs, receipts, now):
    """state = reduce(envelopes, blobs, receipts, now)

    `envelopes`: this problem's envelope and every ancestor's along `prev`.
    `blobs`: a map from hash to bytes. `receipts`: wrappers
    `{event, received}` (a bare event is one with no receipt). `now`: an ISO
    instant or datetime."""
    state = State()
    state.now = parse_time(now)
    if state.now is None:
        raise ValueError("now is not a time")
    if not envelopes:
        raise EnvelopeError("no envelope")
    _assemble_chain(envelopes, blobs, state)
    ident = state.identity
    chain_hashes = set(state.chain_hashes)

    for seq, entry in enumerate(_ordered_receipts(receipts)):
        ev = entry["event"]
        at = entry["at"] if entry["at"] is not None else entry["ts"]
        type_ = ev.get("type")
        if type_ not in CORE_EVENTS:
            state.ignored.append(ev)
            continue
        if ev.get("quilt") != 1:
            _drop(state, "not a quilt 1 event", ev)
            continue
        key = ev.get("key")
        body = ev.get("body")
        if not isinstance(key, str) or not isinstance(body, dict):
            _drop(state, "no key or body", ev)
            continue
        if not same_address(signer_of(ev), key):
            _drop(state, "bad signature", ev)
            continue
        if type_ in IDENTITY_EVENTS:
            if not _fold_identity(state, ev, type_, key, body, at, seq):
                continue
            ident.has_event.add(key)
            state.events.append((seq, ev, None))
            continue
        root, why = ident.authority(key, type_, at, seq)
        if root is None:
            _drop(state, why, ev)
            continue
        if ev.get("problem") not in chain_hashes:
            _drop(state, "names a problem outside the chain", ev)
            continue
        if type_ in PIECE_EVENTS:
            piece = state.by_hash.get(ev.get("piece"))
            if piece is None:
                _drop(state, "names a piece outside the expansion", ev)
                continue
            ok = _fold_piece_event(state, piece, ev, type_, key, root, body, at, seq, entry["id"])
            if not ok:
                continue
        elif type_ == "version":
            if not same_address(root, state.owner):
                _drop(state, "a version not signed by the owner", ev)
                continue
            if not isinstance(body.get("slug"), str) or not isinstance(body.get("hash"), str):
                _drop(state, "a version without slug and hash", ev)
                continue
        elif type_ == "output":
            if not isinstance(body.get("hash"), str):
                _drop(state, "an output without a hash", ev)
                continue
        ident.has_event.add(key)
        state.events.append((seq, ev, root))

    _settle(state)
    return state


def _fold_identity(state, ev, type_, key, body, at, seq):
    ident = state.identity
    if type_ == "name":
        if not isinstance(body.get("name"), str):
            _drop(state, "a name without a name", ev)
            return False
        root, why = ident.authority(key, type_, at, seq)
        if root is None:
            _drop(state, why, ev)
            return False
        return True
    if not ident.is_root(key):
        _drop(state, "signed by a key that is not a root", ev)
        return False
    if type_ == "delegate":
        to, scope, expires = body.get("to"), body.get("scope"), parse_time(body.get("expires"))
        if not isinstance(to, str) or same_address(to, key):
            _drop(state, "a delegate without a key to delegate to", ev)
            return False
        if not isinstance(scope, list) or not all(isinstance(s, str) for s in scope) or expires is None:
            _drop(state, "a delegate without scope or expiry", ev)
            return False
        if to in ident.has_event:
            _drop(state, "the delegate has a prior event", ev)
            return False
        if to in ident.delegations and ident.delegations[to].get("revoked") is None:
            _drop(state, "the delegate is another root's delegate", ev)
            return False
        if to in ident.rotations:
            _drop(state, "the delegate has a prior event", ev)
            return False
        ident.delegations[to] = {"root": key, "scope": scope, "expires": expires, "since": seq, "revoked": None}
        return True
    if type_ == "revoke":
        of = body.get("of")
        d = ident.delegations.get(of) if isinstance(of, str) else None
        if d is not None and same_address(d["root"], key) and d.get("revoked") is None:
            d["revoked"] = seq
            return True
        rot = ident.rotations.get(of) if isinstance(of, str) else None
        if rot is not None and same_address(rot["to"], key) and rot.get("revoked") is None:
            rot["revoked"] = seq
            return True
        _drop(state, "a revoke of a key that is not this root's delegate", ev)
        return False
    if type_ == "rotate":
        to = body.get("to")
        if not isinstance(to, str) or same_address(to, key):
            _drop(state, "a rotate without a new root", ev)
            return False
        if to in ident.has_event or to in ident.rotations:
            _drop(state, "the new root has a prior event", ev)
            return False
        if to in ident.delegations:
            _drop(state, "the new root is a delegate", ev)
            return False
        if not same_address(signer_of(ev, "sig_to"), to):
            _drop(state, "sig_to does not recover to the new root", ev)
            return False
        ident.rotations[key] = {"to": to, "since": seq, "revoked": None}
        ident.has_event.add(to)
        return True
    return False


def _fold_piece_event(state, piece, ev, type_, key, root, body, at, seq, eid):
    if type_ == "claim":
        if not _valid_by(body.get("by")):
            _drop(state, "a claim without a valid by", ev)
            return False
        if "lease_h" in body and (not isinstance(body["lease_h"], (int, float)) or body["lease_h"] <= 0):
            _drop(state, "a claim with a bad lease", ev)
            return False
        piece.claims.append({"key": key, "root": root, "at": at, "lease": _lease_of(piece, state, body), "seq": seq})
        return True
    if type_ == "commit":
        if not isinstance(body.get("h"), str):
            _drop(state, "a commit without h", ev)
            return False
        piece.commits.append({"key": key, "root": root, "at": at, "h": body["h"], "seq": seq,
                              "lease": _lease_of(piece, state), "revealed": None})
        return True
    if type_ == "reveal":
        ret, nonce, by = body.get("return"), body.get("nonce"), body.get("by")
        if not isinstance(nonce, str) or not _valid_by(by):
            _drop(state, "a reveal without nonce or by", ev)
            return False
        h = commit_hash(ret, nonce)
        commit = None
        for c in piece.commits:
            if same_address(c["key"], key) and c["h"] == h and c["revealed"] is None:
                commit = c
                break
        if commit is None:
            _drop(state, "no commit by this key with this hash", ev)
            return False
        if at is not None and commit["at"] is not None and at >= commit["at"] + 2 * commit["lease"]:
            _drop(state, "the commit was abandoned before the reveal", ev)
            return False
        if piece.verifier in ("check", "score"):
            if (not isinstance(ret, dict) or set(ret) != {"patch"} or not isinstance(ret["patch"], str)
                    or len(ret["patch"]) > state.settings["patch_max"]):
                _drop(state, "return: a patch within patch_max", ev)
                return False
        else:
            problems = validate_return(ret, piece.spec.get("schema", {}))
            if problems:
                _drop(state, problems[0], ev)
                return False
        commit["revealed"] = seq
        r = {"key": key, "root": root, "at": at, "ret": ret, "by": by, "vendor": vendor_of(by),
             "seq": seq, "id": eid, "digest": hash_json(ret)}
        piece.reveals.append(r)
        if piece.verifier == "agree" and piece.accepting is None:
            _try_complete_agree(piece, r, state)
        return True
    if type_ == "decline":
        if body.get("reason") not in DECLINE_REASONS:
            _drop(state, "a decline with no reason the core names", ev)
            return False
        piece.declines.append({"key": key, "root": root, "problem": ev.get("problem"), "seq": seq})
        return True
    if type_ == "run":
        if piece.verifier not in ("check", "score"):
            _drop(state, "a run on a piece that is not a check or a score", ev)
            return False
        digest = body.get("digest")
        reveal = next((rv for rv in piece.reveals if rv["digest"] == digest), None)
        if reveal is None:
            _drop(state, "the digest is no revealed return of the piece", ev)
            return False
        image = (piece.spec.get("check") or {}).get("image")
        if image is not None and body.get("image") != image:
            _drop(state, "the run is not in the declared image", ev)
            return False
        if not isinstance(body.get("exit"), int) or isinstance(body.get("exit"), bool):
            _drop(state, "a run without an integer exit", ev)
            return False
        if "score" in body and (not isinstance(body["score"], (int, float)) or isinstance(body["score"], bool)):
            _drop(state, "a run whose score is not a number", ev)
            return False
        if not isinstance(body.get("host"), str) or not _valid_by(body.get("by")):
            _drop(state, "a run without host or by", ev)
            return False
        # "a run by the root that revealed that return or a delegate of it"
        if same_address(state.identity.resolve(root), state.identity.resolve(reveal["root"])):
            _drop(state, "a run by the patch's author", ev)
            return False
        run = {"key": key, "root": root, "at": at, "digest": digest, "exit": body["exit"],
               "score": body.get("score"), "seq": seq, "id": eid}
        piece.runs.append(run)
        if piece.accepting is None:
            _try_complete_runs(piece, run, state)
        return True
    return False


# ---------------------------------------------------------------- settling

def live_claims(piece, now):
    return [c for c in piece.claims if c["at"] is not None and c["at"] <= now < c["at"] + c["lease"]]


def unabandoned_commits(piece, now):
    out = []
    for c in piece.commits:
        if c["revealed"] is not None:
            out.append(c)
        elif c["at"] is not None and now < c["at"] + 2 * c["lease"]:
            out.append(c)
    return out


def _allows_unreachable(prop):
    if prop is None:
        return False
    if "enum" in prop:
        return "unreachable" in prop["enum"]
    if prop.get("type") == "string":
        return prop.get("minLength", 0) <= len("unreachable") <= prop.get("maxLength", 0)
    return False


def _is_unreachable(piece):
    if piece.accepting is None or piece.accepting["kind"] != "agree":
        return False
    props = piece.spec.get("schema", {}).get("properties", {})
    ret = piece.accepting["reveals"][-1]["ret"]
    for f in piece.agree_fields():
        if ret.get(f) == "unreachable" and _allows_unreachable(props.get(f)):
            return True
    return False


def _own_state(piece, state):
    now = state.now
    if piece.accepting is not None:
        window = hours(state.settings["challenge_window_h"])
        if now <= piece.accepting["at"] + window:
            return "accepted_provisional"
        return "unreachable" if _is_unreachable(piece) else "accepted"
    if piece.reveals:
        return "disputed" if _two_unrelated_differ(piece, state) else "needs_verify"
    if unabandoned_commits(piece, now):
        return "sealed"
    if live_claims(piece, now):
        return "in_flight"
    return "open"


def _inputs_of(piece, state):
    """The pieces an `inputs` entry names: a piece by name, or every piece
    of a family. A name that is nothing in this problem yields None."""
    out = []
    for name in piece.spec.get("inputs") or []:
        # `cite/*` is the file key of the family; `cite/1` the name of one piece
        found = [p for p in state.pieces if p.name == name or p.spec["key"] == name]
        if not found:
            out.append(None)
        out.extend(found)
    return out


def _settle(state):
    pieces = state.pieces
    # own states first, then the lock, which depends on the inputs' states
    own = {p.hash: _own_state(p, state) for p in pieces}
    memo = {}

    def final(piece, stack):
        if piece.hash in memo:
            return memo[piece.hash]
        if piece.hash in stack:
            return "locked"
        stack = stack | {piece.hash}
        for inp in _inputs_of(piece, state):
            if inp is None or final(inp, stack) not in DONE:
                memo[piece.hash] = "locked"
                return "locked"
        if piece.verifier not in CORE_VERIFIERS:
            memo[piece.hash] = "unknown"
            return "unknown"
        memo[piece.hash] = own[piece.hash]
        return own[piece.hash]

    for p in pieces:
        p.state = final(p, frozenset())
        if p.verifier == "score" and p.accepting is not None:
            # "The frontier is the best such score among accepting sets, by
            # the check's `better`." Only the first accepting set is kept here.
            scores = [r["score"] for r in p.accepting["runs"]]
            better = (p.spec.get("check") or {}).get("better", "higher")
            p.frontier = min(scores) if better == "lower" else max(scores)
    for p in pieces:
        p.dependents = sum(1 for q in pieces if p in _inputs_of(q, state))
    weights = root_weights(state)
    for p in pieces:
        p.availability = availability(p, state, weights, endgame=False)
    state.complete = bool(pieces) and all(p.state in DONE for p in pieces)
    if state.complete:
        state.output_document = output_document(state)
        state.output = hash_json(state.output_document)


def root_weights(state):
    """(reveals in accepting sets + 1) / (claims + 1), bounded to [0.1, 1],
    per root, over the chain."""
    claims, accepted = {}, {}
    for piece in state.by_hash.values():
        for c in piece.claims:
            r = state.identity.resolve(c["root"])
            claims[r] = claims.get(r, 0) + 1
        if piece.accepting:
            for rv in piece.accepting["reveals"]:
                r = state.identity.resolve(rv["root"])
                accepted[r] = accepted.get(r, 0) + 1
    roots = set(claims) | set(accepted)
    out = {}
    for r in roots:
        w = (accepted.get(r, 0) + 1) / (claims.get(r, 0) + 1)
        out[r] = min(1.0, max(0.1, w))
    return out


def availability(piece, state, weights, endgame):
    now = state.now
    total = 0.0
    if not endgame:
        for c in live_claims(piece, now):
            total += weights.get(state.identity.resolve(c["root"]), 1.0)
    total += len(unabandoned_commits(piece, now))
    total += len(piece.reveals)
    return total


def output_document(state):
    """The output as this implementation reads section 6's one sentence:
    an array in file order; for each piece its name and hash, its agree
    fields once, and `returns`, each return's other fields with the signer's
    address; for check and score the patch and the two runs. CORE.md does
    not fix this shape, and fixture 22's hash does not reproduce
    (FINDINGS.md)."""
    doc = []
    for piece in state.pieces:
        acc = piece.accepting
        entry = {"piece": piece.name, "hash": piece.hash}
        if acc is None:
            doc.append(entry)
            continue
        if acc["kind"] == "agree":
            agree = piece.agree_fields()
            first = acc["reveals"][0]["ret"]
            for f in agree:
                entry[f] = first.get(f)
            entry["returns"] = [
                dict({k: v for k, v in rv["ret"].items() if k not in agree}, key=rv["key"])
                for rv in acc["reveals"]
            ]
        else:
            entry["patch"] = acc["reveals"][0]["ret"].get("patch")
            entry["key"] = acc["reveals"][0]["key"]
            entry["runs"] = [
                {k: v for k, v in (("key", run["key"]), ("exit", run["exit"]), ("score", run["score"])) if v is not None}
                for run in acc["runs"]
            ]
        doc.append(entry)
    return doc
