"""The ledger, the line and its record: READING.md sections 2 and 3.

Section 2: "Each envelope, blob, signature and chain is checked as CORE.md section 6 checks them", and "an
envelope that fails makes its problem's input invalid, and the rest of the ledger is read without it". "A line
is the versions of one problem under one owner", "named by the hash of its first version", and "a reader that
holds a line part of the way names it by the oldest version its chain reaches".

Section 3: "For each line and each piece of it, the record is every event that names the piece and a version of
the line, in the order CORE.md section 6 gives under Order, each with the root it counts for". "The lease and
the window an event is held to are those of the version it names."

The checks of an event are reading 1's, from `reducer.py`: shape, signature, standing, what it names, then its
type's rule. What differs is what an event may name, a version of the line and a piece of the line's expansion,
and whose settings hold it, the named version's.
"""

import base64
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .canonical import canonical
from .envelope import problem_hash, expand, validate_envelope, EnvelopeError
from .hashes import hash_json
from .identity import signer_of, same_address
from .reducer import (Identity, event_id, commit_hash, vendor_of, _shape_problem, _fold_identity, is_address,
                      _is_hash, PIECE_EVENTS, IDENTITY_EVENTS, CORE_EVENTS)
from .schema import validate_return
from .times import parse_time, hours

# The types the extensions add to a problem's log, each with the document that says its body.
EXTENSION_EVENTS = ("challenge", "verdict", "rank", "stake_rule", "lock", "gold", "gold_reveal", "trace", "propose",
                    "seed", "announce")


def iso(t):
    """A time as the fixtures write one: UTC, to the millisecond, with Z."""
    if t is None:
        return None
    t = t.astimezone(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


@dataclass
class Claim:
    key: str
    root: str
    at: datetime
    lease: timedelta
    problem: str
    id: str


@dataclass
class Commit:
    key: str
    root: str
    at: datetime
    h: str
    lease: timedelta
    problem: str
    id: str
    revealed: str | None = None   # the id of its reveal


@dataclass
class Reading:
    """A valid reveal (section 3): its signer and root, its vendor, its seat where the receipt says one, the
    version it names, and the return with its digest."""
    id: str
    key: str
    root: str
    at: datetime
    at_text: str
    ret: dict
    by: dict
    vendor: str
    digest: str
    problem: str
    custody: str | None
    seat: object
    commit: Commit | None = None
    entry: dict | None = None


@dataclass
class Ran:
    """A run the fold keeps (CORE.md section 6, Folding events): its signer and root, the version it names, the
    digest of the patch it ran, and what it says of the run. It stands in a set beside its patch, so it answers
    what a set asks of a member, with no commit and no return of its own."""
    id: str
    key: str
    root: str
    at: datetime
    at_text: str
    digest: str
    exit: int
    host: str
    problem: str
    seq: int
    score: float | None = None
    image: str | None = None
    commit: None = None
    ret: None = None


class Rec:
    """The line's record of one piece: every kept event that names it and a version of the line, in order."""

    def __init__(self, spec):
        self.spec = spec
        self.hash = spec["hash"]
        self.verifier = spec.get("verifier")
        self.claims = []
        self.commits = []
        self.readings = []      # every valid reveal, in receipt order
        self.struck = {}        # a reading's id -> the id of the decision that struck it
        self.aside = set()      # the ids of the readings set aside under section 4
        self.set = None         # the set that stands, section 5
        self.runs = []          # every run on a check or score piece in its declared image, in receipt order
        self.declines = []

    def agree_fields(self):
        if self.verifier in ("check", "score"):
            return []
        agree = self.spec.get("agree")
        if agree is None:
            return list((self.spec.get("schema") or {}).get("required", []))
        return list(agree)

    def live(self):
        """The readings the kinds read: those no decision struck and the grounds did not set aside."""
        return [r for r in self.readings if r.id not in self.struck and r.id not in self.aside]

    def ran(self, ident):
        """The runs the fold keeps over the readings that stand. CORE.md section 6 drops a run where "the digest
        is no revealed return of the piece" and "a run by the patch's author": the patch is the first reading
        with the run's digest received before it, and a struck run is left out of the fold with its set."""
        live = self.live()
        out = []
        for x in self.runs:
            if x.id in self.struck:
                continue
            patch = next((r for r in live if r.digest == x.digest and r.entry["seq"] < x.seq), None)
            if patch is not None and not ident.related(x.root, patch.root, x.at):
                out.append(x)
        return out


class Version:
    """One problem the ledger holds: its envelope, its hash, its pieces in file order and its log's lines."""

    def __init__(self, envelope, lines, blobs):
        self.envelope = envelope
        self.problem = envelope["problem"]
        self.hash = problem_hash(envelope)
        self.lines = lines
        self.settings = self.problem["settings"]
        self.specs = expand(envelope, blobs)
        self.line = None


class Line:
    """A line (section 2): its versions in the ledger's order, its owner, its one expansion and its record."""

    def __init__(self, name):
        self.name = name
        self.versions = []
        self.by_hash = {}       # version hash -> Version
        self.owner = None
        self.recs = {}          # piece hash -> Rec
        self.identity = Identity()
        self.dropped = []       # (reason, event)
        self.kept = []          # every kept entry, in order
        self.ext = []           # the kept extension events, in order
        self.roots = set()      # every root a line of the ledger counts for here


def entries_of(logs):
    """The lines of several logs as one sequence in the order of CORE.md section 6, Order: by the earliest
    `received.at` across the wrapper, then by event id. An event two logs hold is one entry with both wrappers."""
    merged = {}
    for log in logs:
        for line in log:
            event = line.get("event") if isinstance(line, dict) else None
            if not isinstance(event, dict):
                continue
            eid = event_id(event)
            entry = merged.setdefault((eid, canonical(event)), {"event": event, "id": eid, "received": [], "lines": []})
            entry["received"].extend(x for x in (line.get("received") or []) if isinstance(x, dict))
            entry["lines"].append(line)
    out = []
    for entry in merged.values():
        ats = [(parse_time(x.get("at")), x.get("at")) for x in entry["received"]]
        ats = [a for a in ats if a[0] is not None]
        first = min(ats, key=lambda a: a[0]) if ats else (None, None)
        entry["at"], entry["at_text"] = first
        entry["ts"] = parse_time(entry["event"].get("ts"))
        out.append(entry)
    receipted = [e for e in out if e["at"] is not None]
    bare = [e for e in out if e["at"] is None]
    receipted.sort(key=lambda e: (e["at"], e["id"]))
    bare.sort(key=lambda e: (e["ts"] or parse_time("9999-12-31T23:59:59Z"), e["id"]))
    for e in bare:
        e["at"], e["at_text"] = e["ts"], e["event"].get("ts")
    return receipted + bare


def word(entry, name):
    """A word the door wrote on the receipt's wrapper beside `at`, from the first wrapper that carries it."""
    for r in entry["received"]:
        if name in r:
            return r[name]
    return None


class Ledger:
    """What `read` is handed (section 1), checked (section 2): the versions that pass, grouped into lines, and
    the problems refused with the reason."""

    def __init__(self, ledger):
        self.blobs = {h: base64.b64decode(b) for h, b in (ledger.get("blobs") or {}).items()}
        self.identity = ledger.get("identity") or []
        self.coin = ledger.get("coin")
        self.founding = ledger.get("founding") or {}
        self.reads = ledger.get("reads") or {}
        self.versions = {}      # hash -> Version, in the ledger's order
        self.refused = {}
        for entry in ledger.get("problems") or []:
            envelope = entry.get("envelope")
            try:
                h = problem_hash(envelope)
            except Exception:
                continue
            why = envelope_refusal(envelope, self.blobs)
            if why is not None:
                self.refused[h] = why
                continue
            self.versions[h] = Version(envelope, entry.get("lines") or [], self.blobs)
        self.lines = {}
        for v in self.versions.values():
            name = self.line_name(v)
            line = self.lines.get(name)
            if line is None:
                line = self.lines[name] = Line(name)
                line.owner = v.problem["owner"]
            line.versions.append(v)
            line.by_hash[v.hash] = v
            v.line = line
            for spec in v.specs:
                if spec["hash"] not in line.recs:
                    line.recs[spec["hash"]] = Rec(spec)

    def line_name(self, v):
        """Section 2: the hash of the first version, or of the oldest version the chain along `prev` reaches
        among those held, under one owner."""
        seen = set()
        while True:
            seen.add(v.hash)
            prev = self.versions.get(v.problem.get("prev"))
            if prev is None or prev.hash in seen or not same_address(prev.problem["owner"], v.problem["owner"]):
                return v.hash
            v = prev


def envelope_refusal(envelope, blobs):
    """Why an envelope fails the checks of CORE.md section 6, Envelopes, in the words the fixtures keep, or None.
    The words are in no document: `unfolded-1` holds the three seen (FINDINGS-2.md)."""
    problem = envelope.get("problem") if isinstance(envelope, dict) else None
    if not isinstance(problem, dict):
        return "envelope: not an envelope"
    try:
        signed = same_address(signer(envelope), problem.get("owner"))
    except Exception:
        signed = False
    if not signed:
        return "envelope: not signed by its owner"
    for name, h in (problem.get("data") or {}).items():
        if h not in blobs:
            return "blob %s: %s not present" % (name, h)
    try:
        validate_envelope(envelope, blobs)
    except EnvelopeError as e:
        return "envelope: %s" % e
    return None


SIGNERS = {}


def signer(obj):
    """The address an object's `sig` recovers to (CORE.md section 1), remembered by the object's bytes, since
    one ledger is read at several times and the identity log is folded once for each line."""
    key = canonical(obj)
    if key not in SIGNERS:
        SIGNERS[key] = signer_of(obj)
    return SIGNERS[key]


def fold_record(line, identity_lines):
    """Section 3: the line's record, one pass over the identity log's lines and the lines of every version's log
    in receipt order. Each event that passes is kept with the root it counts for; the rest are dropped with the
    reason, as CORE.md section 6 drops."""
    ident = line.identity
    entries = entries_of([identity_lines] + [v.lines for v in line.versions])
    for seq, entry in enumerate(entries):
        ev = entry["event"]
        at = entry["at"]
        type_ = ev.get("type")
        entry["seq"] = seq
        if type_ in CORE_EVENTS:
            why = _shape_problem(ev, type_)
        elif type_ in EXTENSION_EVENTS or type_ == "hide":
            why = extension_shape(ev, type_)
        else:
            continue
        if why is not None:
            line.dropped.append((why, ev))
            continue
        key, body = ev["key"], ev["body"]
        if not same_address(signer(ev), key):
            line.dropped.append(("signature is not the key's", ev))
            continue
        root, why = ident.standing(key, type_, at)
        if root is None:
            line.dropped.append((why, ev))
            continue
        entry["root"] = root
        line.roots.add(root)
        if type_ in CORE_EVENTS:
            ident.has_event.add(key)
        if type_ in IDENTITY_EVENTS:
            if _fold_identity(line, ev, type_, key, body, at, seq):
                line.kept.append(entry)
            continue
        if type_ == "hide":
            line.kept.append(entry)
            continue
        version = line.by_hash.get(ev.get("problem"))
        if version is None:
            line.dropped.append(("names a problem outside the line", ev))
            continue
        entry["version"] = version
        if type_ in PIECE_EVENTS:
            rec = line.recs.get(ev.get("piece"))
            if rec is None:
                line.dropped.append(("names a piece outside the line", ev))
                continue
            if not fold_piece_event(line, rec, version, entry, type_, key, root, body, at):
                continue
        elif type_ in EXTENSION_EVENTS:
            line.ext.append(entry)
        line.kept.append(entry)


def extension_shape(ev, type_):
    """The event line of an extension's event, held as CORE.md section 4 holds every event's; its body is held
    by the step that reads it."""
    if ev.get("quilt") != 1:
        return "event.quilt: 1"
    if not is_address(ev.get("key")):
        return "event.key: an address with its checksum"
    if not isinstance(ev.get("body"), dict):
        return "event.body: an object"
    for f in ("problem", "piece"):
        if f in ev and not _is_hash(ev[f]):
            return "event.%s: a hash" % f
    if not isinstance(ev.get("sig"), str):
        return "event.sig: a signature"
    return None


def lease_of(rec, version, claim_body=None):
    """CORE.md section 4: a claim is live "for `lease_h`, else the piece's, else the problem's", and section 3
    here takes the problem's from the version the event names."""
    lease = claim_body.get("lease_h") if claim_body else None
    if isinstance(lease, (int, float)) and not isinstance(lease, bool) and lease > 0:
        return hours(lease)
    if isinstance(rec.spec.get("lease_h"), (int, float)):
        return hours(rec.spec["lease_h"])
    return hours(version.settings["lease_h"])


def fold_piece_event(line, rec, version, entry, type_, key, root, body, at):
    """The piece events of CORE.md section 4 over the line's record: what each adds, or why it is dropped."""
    ev, eid = entry["event"], entry["id"]
    if type_ == "claim":
        rec.claims.append(Claim(key, root, at, lease_of(rec, version, body), version.hash, eid))
        return True
    if type_ == "commit":
        rec.commits.append(Commit(key, root, at, body["h"], lease_of(rec, version), version.hash, eid))
        return True
    if type_ == "reveal":
        ret, nonce, by = body["return"], body["nonce"], body["by"]
        h = commit_hash(ret, nonce)
        commit = next((c for c in rec.commits if same_address(c.key, key) and c.h == h and c.revealed is None), None)
        if commit is None:
            line.dropped.append(("no commit by this key with this hash", ev))
            return False
        if at >= commit.at + 2 * commit.lease:
            line.dropped.append(("the commit was abandoned before the reveal", ev))
            return False
        if rec.verifier in ("check", "score"):
            if set(ret) != {"patch"} or not isinstance(ret["patch"], str) or len(ret["patch"]) > version.settings["patch_max"]:
                line.dropped.append(("a check or score return is { patch } within patch_max", ev))
                return False
        else:
            problems = validate_return(ret, rec.spec.get("schema") or {})
            if problems:
                line.dropped.append((problems[0], ev))
                return False
        commit.revealed = eid
        rec.readings.append(Reading(id=eid, key=key, root=root, at=at, at_text=entry["at_text"], ret=ret, by=by,
                                    vendor=vendor_of(by), digest=hash_json(ret), problem=version.hash,
                                    custody=word(entry, "custody"), seat=word(entry, "seat"), commit=commit,
                                    entry=entry))
        return True
    if type_ == "decline":
        rec.declines.append(entry)
        return True
    if type_ == "run":
        if rec.verifier not in ("check", "score"):
            line.dropped.append(("a run belongs to a check or score piece", ev))
            return False
        image = (rec.spec.get("check") or {}).get("image")
        if image is not None and body.get("image") != image:
            line.dropped.append(("not in the declared image", ev))
            return False
        rec.runs.append(Ran(id=eid, key=key, root=root, at=at, at_text=entry["at_text"], digest=body["digest"],
                            exit=body["exit"], host=body["host"], problem=version.hash, seq=entry["seq"],
                            score=body.get("score"), image=body.get("image")))
        return True
    return False
