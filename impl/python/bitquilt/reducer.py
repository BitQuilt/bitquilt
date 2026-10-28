"""The reducer, CORE.md section 6.

    state = reduce(envelopes, blobs, receipts, now)

A pure function of its arguments. Where CORE.md leaves a choice open, the
choice is named in a comment and in FINDINGS.md. On 27 October 2026 every
place where this code read a sentence of sections 4, 6 or 7 differently from
the reference implementation was aligned to the reference (FINDINGS.md, the
last section), so the two compute one map from one ledger; the order of the
checks in `reduce` is the reference's too: shape, signature, standing, then
what the event names, then its type's own rule.
"""

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .canonical import canonical, canonical_bytes
from .hashes import hash_json
from .identity import signer_of, signed_body, same_address, checksum_address
from .envelope import (problem_hash, expand, validate_envelope, EnvelopeError,
                       REQUIRES, CORE_VERIFIERS)
from .schema import validate_return
from .times import parse_time, hours

DECLINE_REASONS = ("cannot", "unclear", "refuse", "duplicate", "no_time")
PIECE_EVENTS = ("claim", "commit", "reveal", "decline", "run")
PROBLEM_EVENTS = PIECE_EVENTS + ("version", "output")
IDENTITY_EVENTS = ("name", "delegate", "revoke", "rotate")
CORE_EVENTS = PROBLEM_EVENTS + IDENTITY_EVENTS
# Section 4: "Signed by a root" (delegate, revoke, rotate, version): a delegate
# or a rotated-from root signs none of these.
ROOT_ONLY = ("delegate", "revoke", "rotate", "version")
# Section 4, the event line: its fields, and the forms of a hash, a signature
# and a nonce (section 1).
EVENT_FIELDS = ("quilt", "type", "problem", "piece", "key", "ts", "body", "sig", "sig_to", "nonce")
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SIG_RE = re.compile(r"^0x[0-9a-fA-F]{130}$")
NONCE_RE = re.compile(r"^[0-9a-f]{32}$")
ZONE_RE = re.compile(r"(Z|[+-]\d\d:\d\d)$")

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
    """A kept `run`: the digest it ran, its exit, on a score piece its score,
    and the image and host it declared, which the output carries."""
    key: str
    root: str
    at: datetime | None
    digest: str
    exit: int
    score: float | None
    image: str | None
    host: str
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
    score: float | None = None   # a score piece: the pair's score, the better of the two


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
    """Roots, delegates and rotations, with the time each stood (section 6,
    Roots and delegates)."""

    def __init__(self):
        # delegate key -> {root, scope, expires, since, since_at, revoked, revoked_at}
        self.delegations = {}
        # old root -> {to, since, revoked}: "the old root is a delegate of the new until revoked"
        self.rotations = {}
        self.has_event = set()  # keys with a prior event (section 4)
        self.seq = 0

    def is_root(self, key):
        return key not in self.delegations and key not in self.rotations

    def final(self, root):
        """The root `root` has become through rotations: "rotations as they
        stand at the end of the fold". A revoked rotation still carries what
        the old root did to the new; it only stops the old key signing."""
        seen = set()
        while root in self.rotations and root not in seen:
            seen.add(root)
            root = self.rotations[root]["to"]
        return root

    def resolve(self, key):
        """The root a key stands for, following rotations and delegations
        with no check of scope or expiry; `standing` checks those."""
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

    def live(self, d, at):
        """Whether a delegation stands at `at`: begun by then, not yet
        expired, and not revoked by then."""
        if at is None:
            return d.get("revoked") is None
        return ((d["since_at"] is None or d["since_at"] <= at)
                and (d["expires"] is None or d["expires"] > at)
                and (d.get("revoked_at") is None or d["revoked_at"] > at))

    def root_of(self, key, at):
        """The root `key` counts for at `at`, as `next` asks it: through a
        delegation live then, of any scope; else through a rotation; else
        itself."""
        d = self.delegations.get(key)
        if d is not None and self.live(d, at):
            return self.final(d["root"])
        rot = self.rotations.get(key)
        if rot is not None:
            return self.final(rot["to"])
        return key

    def standing(self, key, type_, at):
        """(root, why): the root an event from `key` of `type_` received at
        `at` counts for, or (None, why) when it counts for nobody (section 6,
        Roots and delegates, and the Drop list). A delegate signs within its
        scope while the delegation is live; a root rotated from is a delegate
        of the new root for every type until revoked (section 4); neither
        signs what only a root signs."""
        d = self.delegations.get(key)
        delegated = d is not None and type_ in d["scope"] and self.live(d, at)
        rot = self.rotations.get(key)
        rotated = rot is not None and rot.get("revoked") is None
        if (delegated or rotated) and type_ in ROOT_ONLY:
            return None, "a %s is signed by a root" % type_
        if delegated:
            return self.final(d["root"]), None
        if rotated:
            return self.final(rot["to"]), None
        if d is not None or rot is not None:
            return None, "the delegation does not cover this event"
        return key, None

    def related(self, a, b, at):
        """Section 6: "Two roots are unrelated when neither is the other and
        neither is a delegate of the other", judged "as they stood at the
        receipt of the event being judged, with delegations as live then and
        rotations as they stand at the end of the fold". The owner is no
        relation of anyone's by this test ("it is not otherwise related to
        anyone"); each rule that sets the owner apart asks about the owner by
        name."""
        if same_address(self.final(a), self.final(b)):
            return True
        for to, d in self.delegations.items():
            if not self.live(d, at):
                continue
            root = self.final(d["root"])
            if (same_address(to, a) and same_address(root, self.final(b))) or (same_address(to, b) and same_address(root, self.final(a))):
                return True
        return False


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
    and `can`, a subset of the `requires` list." As the reference checks it:
    `model` and `client` are names of at most eighty characters, and `can` is
    held to the four capabilities section 2 lists, not to the piece's own
    `requires`; the vendor is whatever stands before the first slash."""
    if not isinstance(by, dict):
        return False
    for f in ("model", "client"):
        v = by.get(f)
        if not isinstance(v, str) or not v or len(v) > 80:
            return False
    can = by.get("can")
    return isinstance(can, list) and all(c in REQUIRES for c in can)


def is_address(s):
    """An identity (section 1): the hex of twenty bytes with the EIP-55 checksum."""
    if not isinstance(s, str) or len(s) != 42 or not s.startswith("0x"):
        return False
    try:
        raw = bytes.fromhex(s[2:])
    except ValueError:
        return False
    return checksum_address(raw) == s


def _is_hash(s):
    return isinstance(s, str) and HASH_RE.match(s) is not None


def _is_time_with_zone(s):
    return isinstance(s, str) and parse_time(s) is not None and ZONE_RE.search(s) is not None


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def _shape_problem(ev, type_):
    """The first thing wrong with the shape of an event, or None: the event
    line of section 4 and each type's body as the table there has it. The
    checks are the reference's, in its order, so the two implementations drop
    the same events for shape; the signature and what the event names are
    checked after."""
    if ev.get("quilt") != 1:
        return "event.quilt: 1"
    if not is_address(ev.get("key")):
        return "event.key: an address with its checksum"
    if not _is_time_with_zone(ev.get("ts")):
        return "event.ts: a time, ISO 8601 with a zone"
    if not isinstance(ev.get("sig"), str) or not SIG_RE.match(ev["sig"]):
        return "event.sig: a signature"
    if "sig_to" in ev and (not isinstance(ev["sig_to"], str) or not SIG_RE.match(ev["sig_to"])):
        return "event.sig_to: a signature"
    for f in ("problem", "piece"):
        if f in ev and not _is_hash(ev[f]):
            return "event.%s: a hash" % f
    if "nonce" in ev and not (isinstance(ev["nonce"], str) and NONCE_RE.match(ev["nonce"])):
        return "event.nonce: 32 hex characters"
    for k in ev:
        if k not in EVENT_FIELDS:
            return "event.%s: not a field of an event" % k
    body = ev.get("body")
    if not isinstance(body, dict):
        return "event.body: an object"
    if type_ in PIECE_EVENTS and ("problem" not in ev or "piece" not in ev):
        return "event: a %s names a problem and a piece" % type_
    if type_ in ("version", "output") and "problem" not in ev:
        return "event: a %s names a problem" % type_
    if type_ == "claim":
        if not _valid_by(body.get("by")):
            return "body.by: model, client and can"
        if "lease_h" in body and not (_is_number(body["lease_h"]) and body["lease_h"] > 0):
            return "body.lease_h: a number above 0"
    elif type_ == "commit":
        if not _is_hash(body.get("h")):
            return "body.h: a hash"
    elif type_ == "reveal":
        if not isinstance(body.get("return"), dict):
            return "body.return: an object"
        if not (isinstance(body.get("nonce"), str) and NONCE_RE.match(body["nonce"])):
            return "body.nonce: 32 hex characters"
        if not _valid_by(body.get("by")):
            return "body.by: model, client and can"
    elif type_ == "decline":
        if body.get("reason") not in DECLINE_REASONS:
            return "body.reason: one of %s" % ", ".join(DECLINE_REASONS)
    elif type_ == "run":
        if not _is_hash(body.get("digest")):
            return "body.digest: a hash"
        if not isinstance(body.get("exit"), int) or isinstance(body.get("exit"), bool):
            return "body.exit: a whole number"
        if "score" in body and not _is_number(body["score"]):
            return "body.score: a number"
        if "image" in body and not isinstance(body["image"], str):
            return "body.image: a digest"
        if not isinstance(body.get("host"), str):
            return "body.host: the platform"
        if not _valid_by(body.get("by")):
            return "body.by: model, client and can"
    elif type_ == "name":
        n = body.get("name")
        if not isinstance(n, str) or not n.strip() or len(n) > 60:
            return "body.name: a name of at most 60 characters"
        if "agent" in body and not isinstance(body["agent"], bool):
            return "body.agent: true or false"
    elif type_ == "delegate":
        if not is_address(body.get("to")):
            return "body.to: an address"
        if not isinstance(body.get("scope"), list) or not all(isinstance(s, str) for s in body["scope"]):
            return "body.scope: a list of event types"
        if not _is_time_with_zone(body.get("expires")):
            return "body.expires: a time"
    elif type_ == "revoke":
        if not is_address(body.get("of")):
            return "body.of: an address"
    elif type_ == "rotate":
        if not is_address(body.get("to")):
            return "body.to: an address"
        if not isinstance(ev.get("sig_to"), str) or not SIG_RE.match(ev["sig_to"]):
            return "event.sig_to: the new root's signature"
    elif type_ in ("version", "output"):
        if type_ == "version" and not isinstance(body.get("slug"), str):
            return "body.slug: a slug"
        if not _is_hash(body.get("hash")):
            return "body.hash: a hash"
    return None


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


def _two_unrelated_differ(piece, state):
    """Section 6: "A piece is disputed when any two reveals from unrelated
    roots differ on an agree field and no set exists." The owner's reveal
    counts here like anyone's, since the owner "is not otherwise related to
    anyone"."""
    reveals = piece.reveals
    for j, b in enumerate(reveals):
        for a in reveals[:j]:
            if state.identity.related(a.root, b.root, b.at):
                continue
            if not returns_agree(piece, a.ret, b.ret):
                return True
    return False


def _accepting_agree(piece, state):
    """Section 6: "for agree: two valid reveals from unrelated roots of
    different vendors that agree on the agree fields after canonicalisation.
    Reveals are taken in receipt order, and a reveal counts only when its
    root is unrelated to the owner and to the root of every earlier reveal
    on the piece; among counting reveals, the first pair in receipt order
    whose vendors differ and whose agree fields agree is the accepting set,
    completed at the receipt of its later reveal." As the reference reads
    it, the earlier reveals a reveal is held against are the ones the owner
    did not make, and the later reveal of the pair is the one that counts."""
    ident = state.identity
    reveals = [r for r in piece.reveals if not ident.related(r.root, state.owner, r.at)]
    for j, b in enumerate(reveals):
        if any(ident.related(a.root, b.root, b.at) for a in reveals[:j]):
            continue
        for a in reveals[:j]:
            if a.vendor == b.vendor:
                continue
            if returns_agree(piece, a.ret, b.ret):
                return AcceptingSet(kind="agree", at=b.at, seq=b.seq, reveals=[a, b], runs=[])
    return None


def _qualifying_runs(piece, state):
    """The pairs of runs that could accept a check or score piece (section
    6), in the reference's search order: the patches in receipt order, then
    the later run, then the earlier. A run counts at the patch's digest,
    "with exit 0", "from roots unrelated to each other" and "unrelated to the
    owner" (the patch's author's own run was dropped at the fold); on a score
    piece "two run events whose score values are within the check's
    tolerance of each other", the pair's score the better of the two. Each
    pair is (patch, a, b, score), the score None on a check piece."""
    ident = state.identity
    check = piece.spec.get("check") or {}
    tol = check.get("tolerance", 0) or 0
    better = check.get("better", "higher")
    out = []
    for patch in piece.reveals:
        runs = [r for r in piece.runs if r.digest == patch.digest and not ident.related(r.root, state.owner, r.at)]
        for j, b in enumerate(runs):
            if b.exit != 0:
                continue
            for a in runs[:j]:
                if a.exit != 0 or ident.related(a.root, b.root, b.at):
                    continue
                if piece.verifier != "score":
                    out.append((patch, a, b, None))
                    continue
                if not _is_number(a.score) or not _is_number(b.score) or abs(a.score - b.score) > tol:
                    continue
                out.append((patch, a, b, max(a.score, b.score) if better == "higher" else min(a.score, b.score)))
    return out


def _not_before(run, acc):
    """Whether `run` completes no earlier than the set `acc`: by receipt, and
    by the fold's order where a receipt is missing."""
    if run.at is not None and acc.at is not None:
        return run.at >= acc.at
    return run.seq >= acc.seq


def _accepting_runs(piece, state):
    """Section 6: "for check: a revealed { patch }, and two run events with
    exit 0 at that patch's digest, in the declared image, from roots
    unrelated to each other and to the root that revealed the patch"; "for
    score: as check, with two run events whose score values are within the
    check's tolerance of each other. The accepting set is the pair completed
    first.\""""
    best = None
    for patch, a, b, score in _qualifying_runs(piece, state):
        if best is not None and _not_before(b, best):
            continue
        best = AcceptingSet(kind=piece.verifier, at=b.at, seq=b.seq, reveals=[patch], runs=[a, b], score=score)
    return best


def _frontier(piece, state):
    """Section 6: "the frontier is the best score, by the check's better,
    among every pair of qualifying runs within tolerance, whether or not
    that pair is the set.\""""
    better = (piece.spec.get("check") or {}).get("better", "higher")
    frontier = None
    for _patch, _a, _b, score in _qualifying_runs(piece, state):
        if score is None:
            continue
        if frontier is None or (score > frontier if better == "higher" else score < frontier):
            frontier = score
    return frontier


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
        # Section 6, Drop, in the reference's order: the shape, the signature,
        # the key's standing; then what the event names; then its type's rule.
        why = _shape_problem(ev, type_)
        if why is not None:
            _drop(state, why, ev)
            continue
        key, body = ev["key"], ev["body"]
        if not same_address(signer_of(ev), key):
            _drop(state, "signature is not the key's", ev)
            continue
        root, why = ident.standing(key, type_, at)
        if root is None:
            _drop(state, why, ev)
            continue
        # Section 4, A prior event: a key has one "once a core event signed
        # by it has passed the checks of shape, signature and standing as a
        # root or live delegate, whether or not it was then dropped for what
        # it names". So the key is recorded here, before the rest.
        ident.has_event.add(key)
        if type_ in IDENTITY_EVENTS:
            if _fold_identity(state, ev, type_, key, body, at, seq):
                state.events.append((seq, ev, root))
            continue
        if ev.get("problem") not in chain_hashes:
            _drop(state, "names a problem outside the chain", ev)
            continue
        if type_ in PIECE_EVENTS:
            # Section 6, Envelopes: "A piece hash counts if any envelope in the
            # chain contains it", so a piece an ancestor had and this version
            # dropped still takes events, which count toward weights.
            piece = state.by_hash.get(ev.get("piece"))
            if piece is None:
                _drop(state, "names a piece outside the chain", ev)
                continue
            if not _fold_piece_event(state, piece, ev, type_, key, root, body, at, seq, entry["id"]):
                continue
        # A `version` is "signed by a root", any root (section 4); an `output`
        # names a hash. Neither has more to check than its shape.
        state.events.append((seq, ev, root))

    _settle(state)
    return state


def _fold_identity(state, ev, type_, key, body, at, seq):
    """The identity events (section 4): what each adds to the roots, or why
    it is dropped. The key's standing to sign one was checked before."""
    ident = state.identity
    if type_ == "name":
        return True
    if type_ == "delegate":
        to = body["to"]
        if to in ident.has_event:
            _drop(state, "the delegate has a prior event", ev)
            return False
        # "is no other root's delegate": once delegated to, a key stays one in
        # the reference's eyes, revoked or not, and a rotated-from root is the
        # new root's delegate.
        if to in ident.delegations or to in ident.rotations:
            _drop(state, "the delegate is another root's", ev)
            return False
        ident.delegations[to] = {"root": key, "scope": body["scope"], "expires": parse_time(body["expires"]),
                                 "since": seq, "since_at": at, "revoked": None, "revoked_at": None}
        return True
    if type_ == "revoke":
        of = body["of"]
        d = ident.delegations.get(of)
        if d is not None and same_address(d["root"], key) and d.get("revoked") is None:
            d["revoked"] = seq
            d["revoked_at"] = at
            return True
        rot = ident.rotations.get(of)
        if rot is not None and same_address(rot["to"], key) and rot.get("revoked") is None:
            rot["revoked"] = seq
            return True
        _drop(state, "revokes a key that is not this root's delegate", ev)
        return False
    if type_ == "rotate":
        to = body["to"]
        if not same_address(signer_of(ev, "sig_to"), to):
            _drop(state, "sig_to does not recover to the new root", ev)
            return False
        if to in ident.has_event:
            _drop(state, "the new root has a prior event", ev)
            return False
        if to in ident.delegations or to in ident.rotations:
            _drop(state, "the new root is another root's delegate", ev)
            return False
        ident.rotations[key] = {"to": to, "since": seq, "revoked": None}
        # Section 4: a key has a prior event "once a kept rotate names it as to".
        ident.has_event.add(to)
        return True
    return False


def _fold_piece_event(state, piece, ev, type_, key, root, body, at, seq, eid):
    """The piece events (section 4), their shape already checked: what each
    adds to the piece, or why it is dropped."""
    if type_ == "claim":
        piece.claims.append(Claim(key=key, root=root, at=at, lease=_lease_of(piece, state, body), seq=seq))
        return True
    if type_ == "commit":
        piece.commits.append(Commit(key=key, root=root, at=at, h=body["h"], seq=seq, lease=_lease_of(piece, state)))
        return True
    if type_ == "reveal":
        ret, nonce, by = body["return"], body["nonce"], body["by"]
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
            if set(ret) != {"patch"} or not isinstance(ret["patch"], str) or len(ret["patch"]) > state.settings["patch_max"]:
                _drop(state, "a check or score return is { patch } within patch_max", ev)
                return False
        else:
            problems = validate_return(ret, piece.spec.get("schema", {}))
            if problems:
                _drop(state, problems[0], ev)
                return False
        commit.revealed = seq
        piece.reveals.append(Reveal(key=key, root=root, at=at, ret=ret, by=by, vendor=vendor_of(by),
                                    seq=seq, id=eid, digest=hash_json(ret)))
        return True
    if type_ == "decline":
        piece.declines.append(Decline(key=key, root=root, problem=ev.get("problem"), seq=seq))
        return True
    if type_ == "run":
        if piece.verifier not in ("check", "score"):
            _drop(state, "a run belongs to a check or score piece", ev)
            return False
        digest = body["digest"]
        reveal = next((rv for rv in piece.reveals if rv.digest == digest), None)
        if reveal is None:
            _drop(state, "the digest is no revealed return of the piece", ev)
            return False
        image = (piece.spec.get("check") or {}).get("image")
        if image is not None and body.get("image") != image:
            _drop(state, "not in the declared image", ev)
            return False
        # "a run by the root that revealed that return or a delegate of it"
        if state.identity.related(root, reveal.root, at):
            _drop(state, "a run by the patch's author", ev)
            return False
        piece.runs.append(Run(key=key, root=root, at=at, digest=digest, exit=body["exit"], score=body.get("score"),
                              image=body.get("image"), host=body["host"], seq=seq, id=eid))
        return True
    return False


# ---------------------------------------------------------------- settling

def live_claims(piece, now):
    """Section 6: "A claim received at r is live while now < r + lease.\""""
    return [c for c in piece.claims if c.at is not None and now < c.at + c.lease]


def unabandoned_commits(piece, now):
    """Section 6: "A commit received at r is unabandoned while now < r + 2 ×
    lease, with the piece's lease, else the problem's." A commit that has
    been revealed is its reveal's from then on and is not counted again:
    `sealed` and availability read the unrevealed ones, as the reference
    does."""
    return [c for c in piece.commits if c.revealed is None and c.at is not None and now < c.at + 2 * c.lease]


def _allows_unreachable(prop):
    """Section 6: `unreachable` counts "in an agree field whose schema is an
    enum that lists it"."""
    return prop is not None and "enum" in prop and "unreachable" in prop["enum"]


def _is_unreachable(piece):
    """Section 6: "where the accepting set's first reveal has the value
    unreachable in an agree field whose schema is an enum that lists it"."""
    if piece.accepting is None or piece.accepting.kind != "agree":
        return False
    props = piece.spec.get("schema", {}).get("properties", {})
    ret = piece.accepting.reveals[0].ret
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
        # Section 6: "A window runs from the receipt c of the event that
        # completed the set while now < c + challenge_window_h."
        window = hours(state.settings["challenge_window_h"])
        if now < piece.accepting.at + window:
            return "accepted_provisional"
        return "unreachable" if _is_unreachable(piece) else "accepted"
    if _two_unrelated_differ(piece, state):
        return "disputed"
    if piece.reveals:
        return "needs_verify"
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
    """Section 6, Per piece: "A piece's state is a function of the sets of
    its live claims, its unabandoned commits, its valid reveals and its runs
    at now, not a token moved by transitions." Each piece's accepting set
    first, every piece of the chain's since weights count the whole chain;
    then the states, a piece's inputs before it; the frontier of a score
    piece; the dependents, the weights, the availabilities; and the output
    when every piece is done."""
    pieces = state.pieces
    for p in state.by_hash.values():
        if p.verifier in ("check", "score"):
            p.accepting = _accepting_runs(p, state)
            if p.verifier == "score":
                p.frontier = _frontier(p, state)
        elif p.verifier == "agree" and p.spec.get("schema") is not None:
            p.accepting = _accepting_agree(p, state)
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
            r = state.identity.final(c.root)
            claims[r] = claims.get(r, 0) + 1
        if piece.accepting:
            # The two reveals of an agree set; the patch's reveal of a check or score set.
            for rv in piece.accepting.reveals:
                r = state.identity.final(rv.root)
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
            total += weights.get(state.identity.final(c.root), 1.0)
    total += len(unabandoned_commits(piece, now))
    total += len(piece.reveals)
    return total


def output_document(state):
    """The output as CORE.md section 6 (Output) writes it: {"quilt": 1,
    "problem": hash, "pieces": [...]} in file order; each piece its name,
    hash and state; an agree piece adds "agreed" (the agree fields from the
    set's first reveal) and "evidence" (per reveal, the signer and every
    other field); a check or score piece adds "patch", "author" and "runs"
    (per run, the signer, exit, host, and score and image when present)."""
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
                # Section 6: "exit", "score", "image", "host" "with absent values left out".
                r = {"signer": run.root, "exit": run.exit, "host": run.host}
                if run.score is not None:
                    r["score"] = run.score
                if run.image is not None:
                    r["image"] = run.image
                runs.append(r)
            entry["runs"] = runs
        pieces.append(entry)
    return {"quilt": 1, "problem": state.problem_hash, "pieces": pieces}
