"""The reducer, CORE.md section 6.

    state = reduce(envelopes, blobs, receipts, now)

A pure function of its arguments. Where CORE.md leaves a choice open, the
choice is named in a comment and in FINDINGS.md. Where this code and a
sentence of the document differ by a character, the comment beside the line
quotes the sentence, says how the code differs, and leaves the behaviour as
it is for the maintainers to decide.
"""

import hashlib
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta

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


def vendor_of(declared) -> str:
    """The part of `model` before the first slash; `human` is a vendor
    (section 6). `declared` is whatever carries the model: a claim's, a
    reveal's or a run's `by`, or the client handed to `next`."""
    model = declared.get("model") if isinstance(declared, dict) else None
    if not isinstance(model, str):
        return ""
    return model.split("/", 1)[0]


# ------------------------------------------------------- what a piece holds
# One class per event of section 4's table that the reducer keeps on a
# piece, and one for the set that accepts it.

@dataclass
class Claim:
    """A kept `claim`: by which key, counting for which root, received when,
    and the lease it is live for."""
    key: str
    root: str
    at: datetime | None
    lease: timedelta
    seq: int


@dataclass
class Commit:
    """A kept `commit`: its `h`, the lease it is unabandoned for twice over,
    and the seq of its reveal once one is folded."""
    key: str
    root: str
    at: datetime | None
    h: str
    seq: int
    lease: timedelta
    revealed: int | None = None


@dataclass
class Reveal:
    """A kept `reveal`: the return, the client's `by` and its vendor, the
    event's id, and the return's digest, which a run names."""
    key: str
    root: str
    at: datetime | None
    ret: dict
    by: dict
    vendor: str
    seq: int
    id: str
    digest: str


@dataclass
class Run:
    """A kept `run`: the digest it ran, its exit, and on a score piece its
    score."""
    key: str
    root: str
    at: datetime | None
    digest: str
    exit: int
    score: float | None
    seq: int
    id: str


@dataclass
class Decline:
    """A kept `decline`: the root that declined, under which problem."""
    key: str
    root: str
    problem: str | None
    seq: int


@dataclass
class AcceptingSet:
    """What accepted a piece (section 6): its kind; its reveals, two for
    `agree` and the patch's one for `check` and `score`; its runs, two for
    `check` and `score`; and the receipt that completed it, from which the
    window runs."""
    kind: str
    at: datetime | None
    seq: int
    reveals: list
    runs: list


class Piece:
    """One piece of the chain, by hash, with the sets its state is a
    function of."""

    def __init__(self, spec):
        self.spec = spec
        self.name = spec["name"]
        self.hash = spec["hash"]
        self.verifier = spec["verifier"]
        self.claims: list[Claim] = []
        self.commits: list[Commit] = []
        self.reveals: list[Reveal] = []
        self.runs: list[Run] = []
        self.declines: list[Decline] = []
        self.accepting: AcceptingSet | None = None
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
        self.now = None
        self.dropped = []            # (reason, event)
        # Kept for a caller that wants the fold; conformance reads neither.
        self.ignored = []            # extension events, passed over
        self.events = []             # (seq, event, root) folded, in order
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

    def resolve(self, key):
        """The root a key stands for, following rotations and delegations
        with no check of scope or expiry (that is `authority`)."""
        seen = set()
        while True:
            if key in seen:
                return key
            seen.add(key)
            rot = self.rotations.get(key)
            if rot is not None:
                key = rot["to"]
                continue
            d = self.delegations.get(key)
            if d is not None:
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

    def cannot_pair(self, root_a, root_b, owner):
        """Whether two roots may not stand together in an accepting set.

        Section 6: "Two roots are unrelated when neither is the other and
        neither is a delegate of the other. A root related to the owner is
        counted in no accepting set and handed no piece by `next`; it is not
        otherwise related to anyone." The owner rule is folded in: a root
        that is the owner pairs with nobody, which is what every caller
        asks. Delegations are followed with no check of scope or expiry."""
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
        state.pieces.append(state.by_hash[spec["hash"]])


def _lease_of(piece, state, claim_body=None):
    """The lease in force. Section 4: a claim is "live from its receipt for
    `lease_h`, else the piece's, else the problem's"; a commit's "lease is
    the piece's `lease_h`, else the problem's; a claim's own `lease_h` is
    the claim's alone", so a commit passes no body."""
    if claim_body and isinstance(claim_body.get("lease_h"), (int, float)) and claim_body["lease_h"] > 0:
        return hours(claim_body["lease_h"])
    if isinstance(piece.spec.get("lease_h"), (int, float)):
        return hours(piece.spec["lease_h"])
    return hours(state.settings["lease_h"])


def _valid_by(by):
    """Section 4: "`by` has `model` as `vendor/model` or `human`, `client`,
    and `can`, a subset of the `requires` list." `can` is held to the four
    capabilities section 2 lists, not to the piece's own `requires`."""
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
    element. Numbers are compared by `fields_agree`."""
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
    """Section 6: "A piece is disputed when any two reveals from unrelated
    roots differ on an agree field and no set exists." Through `cannot_pair`
    an owner's reveal disputes nothing here, though the owner "is not
    otherwise related to anyone" and the reference lets its reveal dispute.
    No fixture has the owner working. Left as it is for the maintainers to
    decide (FINDINGS.md)."""
    reveals = [r for r in piece.reveals if upto_seq is None or r.seq < upto_seq]
    for i, a in enumerate(reveals):
        for b in reveals[i + 1:]:
            if state.identity.cannot_pair(a.root, b.root, state.owner):
                continue
            if not returns_agree(piece, a.ret, b.ret):
                return True
    return False


def _try_complete_agree(piece, r, state):
    """On a new reveal `r`, look for an accepting set it completes.

    Section 6: "a reveal counts only when its root is unrelated to the owner
    and to the root of every earlier reveal on the piece; among counting
    reveals, the first pair in receipt order whose vendors differ and whose
    agree fields agree is the accepting set, completed at the receipt of its
    later reveal." This code applies the every-earlier-reveal rule only once
    the piece is disputed; before that, a reveal related to one earlier
    reveal may still pair with another. No fixture tells the two readings
    apart. Left as it is for the maintainers to decide (FINDINGS.md)."""
    disputed = _two_unrelated_differ(piece, state, upto_seq=r.seq)
    prior = [p for p in piece.reveals if p.seq < r.seq]
    if disputed:
        if any(state.identity.cannot_pair(r.root, p.root, state.owner) for p in prior):
            return
    for p in prior:
        if state.identity.cannot_pair(p.root, r.root, state.owner):
            continue
        if p.vendor == r.vendor:
            continue
        if returns_agree(piece, p.ret, r.ret):
            piece.accepting = AcceptingSet(kind="agree", at=r.at, seq=r.seq, reveals=[p, r], runs=[])
            return


def _try_complete_runs(piece, run, state):
    """On a new run, look for the pair of runs that accepts the piece.

    Section 6: "for check: a revealed { patch }, and two run events with exit
    0 at that patch's digest, in the declared image, from roots unrelated to
    each other and to the root that revealed the patch"; "for score: as
    check, with two run events whose score values are within the check's
    tolerance of each other. The accepting set is the pair completed
    first.\""""
    reveal = next((rv for rv in piece.reveals if rv.digest == run.digest), None)
    if reveal is None or run.exit != 0:
        return
    if piece.verifier == "score" and not isinstance(run.score, (int, float)):
        return
    tol = (piece.spec.get("check") or {}).get("tolerance", 0) or 0
    for other in piece.runs:
        if other is run or other.digest != run.digest or other.exit != 0:
            continue
        if state.identity.cannot_pair(other.root, run.root, state.owner):
            continue
        if piece.verifier == "score":
            if not isinstance(other.score, (int, float)):
                continue
            if abs(other.score - run.score) > tol:
                continue
        piece.accepting = AcceptingSet(kind=piece.verifier, at=run.at, seq=run.seq, reveals=[reveal], runs=[other, run])
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
        piece.claims.append(Claim(key=key, root=root, at=at, lease=_lease_of(piece, state, body), seq=seq))
        return True
    if type_ == "commit":
        if not isinstance(body.get("h"), str):
            _drop(state, "a commit without h", ev)
            return False
        piece.commits.append(Commit(key=key, root=root, at=at, h=body["h"], seq=seq, lease=_lease_of(piece, state)))
        return True
    if type_ == "reveal":
        ret, nonce, by = body.get("return"), body.get("nonce"), body.get("by")
        if not isinstance(nonce, str) or not _valid_by(by):
            _drop(state, "a reveal without nonce or by", ev)
            return False
        h = commit_hash(ret, nonce)
        commit = None
        for c in piece.commits:
            if same_address(c.key, key) and c.h == h and c.revealed is None:
                commit = c
                break
        if commit is None:
            _drop(state, "no commit by this key with this hash", ev)
            return False
        if at is not None and commit.at is not None and at >= commit.at + 2 * commit.lease:
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
        commit.revealed = seq
        r = Reveal(key=key, root=root, at=at, ret=ret, by=by, vendor=vendor_of(by),
                   seq=seq, id=eid, digest=hash_json(ret))
        piece.reveals.append(r)
        if piece.verifier == "agree" and piece.accepting is None:
            _try_complete_agree(piece, r, state)
        return True
    if type_ == "decline":
        if body.get("reason") not in DECLINE_REASONS:
            _drop(state, "a decline with no reason the core names", ev)
            return False
        piece.declines.append(Decline(key=key, root=root, problem=ev.get("problem"), seq=seq))
        return True
    if type_ == "run":
        if piece.verifier not in ("check", "score"):
            _drop(state, "a run on a piece that is not a check or a score", ev)
            return False
        digest = body.get("digest")
        reveal = next((rv for rv in piece.reveals if rv.digest == digest), None)
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
        if same_address(state.identity.resolve(root), state.identity.resolve(reveal.root)):
            _drop(state, "a run by the patch's author", ev)
            return False
        run = Run(key=key, root=root, at=at, digest=digest, exit=body["exit"],
                  score=body.get("score"), seq=seq, id=eid)
        piece.runs.append(run)
        if piece.accepting is None:
            _try_complete_runs(piece, run, state)
        return True
    return False


# ---------------------------------------------------------------- settling

def live_claims(piece, now):
    """Section 6: "A claim received at r is live while now < r + lease." This
    code also asks r <= now, so a claim received after `now` is not live;
    the sentence has no lower bound. No fixture has such a claim. Left as it
    is for the maintainers to decide."""
    return [c for c in piece.claims if c.at is not None and c.at <= now < c.at + c.lease]


def commits_in_force(piece, now):
    """Section 6: "A commit received at r is unabandoned while now < r + 2 ×
    lease, with the piece's lease, else the problem's." A revealed commit is
    kept in this list whatever the time, so `availability` counts it beside
    its reveal, where the reference counts unrevealed commits alone; no pick
    in the fixtures turns on the difference. Left as it is for the
    maintainers to decide (FINDINGS.md)."""
    out = []
    for c in piece.commits:
        if c.revealed is not None:
            out.append(c)
        elif c.at is not None and now < c.at + 2 * c.lease:
            out.append(c)
    return out


def _allows_unreachable(prop):
    """Section 6: `unreachable` counts "in an agree field whose schema is an
    enum that lists it". This code also takes a string field whose length
    bounds admit the word; the sentence names an enum alone. No fixture has
    such a field. Left as it is for the maintainers to decide."""
    if prop is None:
        return False
    if "enum" in prop:
        return "unreachable" in prop["enum"]
    if prop.get("type") == "string":
        return prop.get("minLength", 0) <= len("unreachable") <= prop.get("maxLength", 0)
    return False


def _is_unreachable(piece):
    if piece.accepting is None or piece.accepting.kind != "agree":
        return False
    props = piece.spec.get("schema", {}).get("properties", {})
    # Section 6: "where the accepting set's first reveal has the value
    # unreachable". This code reads the set's last reveal; on an enum field
    # the two carry one value, since the set exists. Left as it is for the
    # maintainers to decide.
    ret = piece.accepting.reveals[-1].ret
    for f in piece.agree_fields():
        if ret.get(f) == "unreachable" and _allows_unreachable(props.get(f)):
            return True
    return False


def _own_state(piece, state):
    """The piece's state before its inputs are looked at. Section 6: "A
    piece's state is a function of the sets of its live claims, its
    unabandoned commits, its valid reveals and its runs at now, not a token
    moved by transitions.\""""
    now = state.now
    if piece.accepting is not None:
        window = hours(state.settings["challenge_window_h"])
        # Section 6: "A window runs from the receipt c of the event that
        # completed the set while now < c + challenge_window_h." This code
        # uses <=, so at the window's last instant the piece is still
        # provisional. No fixture sits on the boundary. Left as it is for the
        # maintainers to decide.
        if now <= piece.accepting.at + window:
            return "accepted_provisional"
        return "unreachable" if _is_unreachable(piece) else "accepted"
    if piece.reveals:
        return "disputed" if _two_unrelated_differ(piece, state) else "needs_verify"
    if commits_in_force(piece, now):
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
            # Section 6: "the frontier is the best score, by the check's
            # better, among every pair of qualifying runs within tolerance,
            # whether or not that pair is the set." This code reads the two
            # runs of the accepting set alone, so a better pair that is not
            # the set is not seen. No fixture has two pairs. Left as it is
            # for the maintainers to decide (FINDINGS.md).
            scores = [r.score for r in p.accepting.runs]
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
    """Section 6: "A root's weight is (its reveals in accepting sets in this
    chain + 1) / (its claims in this chain + 1), bounded to [0.1, 1].\""""
    claims, accepted = {}, {}
    for piece in state.by_hash.values():
        for c in piece.claims:
            r = state.identity.resolve(c.root)
            claims[r] = claims.get(r, 0) + 1
        if piece.accepting:
            for rv in piece.accepting.reveals:
                r = state.identity.resolve(rv.root)
                accepted[r] = accepted.get(r, 0) + 1
    roots = set(claims) | set(accepted)
    out = {}
    for r in roots:
        w = (accepted.get(r, 0) + 1) / (claims.get(r, 0) + 1)
        out[r] = min(1.0, max(0.1, w))
    return out


def availability(piece, state, weights, endgame):
    """Section 6: "Availability of a piece is the sum over its live claims of
    the claimant root's weight, plus its unabandoned commits and its
    reveals." In endgame (section 7, step 4) "live claims count zero"."""
    now = state.now
    total = 0.0
    if not endgame:
        for c in live_claims(piece, now):
            total += weights.get(state.identity.resolve(c.root), 1.0)
    total += len(commits_in_force(piece, now))
    total += len(piece.reveals)
    return total


def output_document(state):
    """The output as CORE.md section 6 (Output) writes it: {"quilt": 1,
    "problem": hash, "pieces": [...]} in file order; each piece its name,
    hash and state; an agree piece adds "agreed" (the agree fields from the
    set's first reveal) and "evidence" (per reveal, the signer and every
    other field); a check or score piece adds "patch", "author" and "runs"
    (per run, the signer, exit, and score, image, host when present)."""
    pieces = []
    for piece in state.pieces:
        acc = piece.accepting
        entry = {"name": piece.name, "piece": piece.hash, "state": piece.state}
        if acc is None:
            pieces.append(entry)
            continue
        if acc.kind == "agree":
            agree = piece.agree_fields()
            first = acc.reveals[0].ret
            entry["agreed"] = {f: first.get(f) for f in agree}
            entry["evidence"] = [
                dict({"signer": rv.root}, **{k: v for k, v in rv.ret.items() if k not in agree})
                for rv in acc.reveals
            ]
        else:
            entry["patch"] = acc.reveals[0].ret.get("patch")
            entry["author"] = acc.reveals[0].root
            runs = []
            for run in acc.runs:
                r = {"signer": run.root, "exit": run.exit}
                # Section 6 adds "score", "image", "host" "with absent values
                # left out". The fold keeps a run's score and neither its
                # image nor its host, so the output carries neither; no
                # fixture reaches a check or score output. Left as it is for
                # the maintainers to decide (FINDINGS.md).
                if run.score is not None:
                    r["score"] = run.score
                runs.append(r)
            entry["runs"] = runs
        pieces.append(entry)
    return {"quilt": 1, "problem": state.problem_hash, "pieces": pieces}
