"""The sets, kind by kind, and how each reading counts: READING.md sections 3 and 5.

Section 5: "Each kind's rule reads the record and says whether a set stands." An `agree` piece is read "as
version 1", CORE.md section 6, An accepting set; `human`, `judge:n` and `attest` by verifiers.md section 2;
`record:n` by QX-20 section 2; any other kind makes no set and its piece is `unknown`.

Section 3: a reading counts as `counted`, "in a set or toward one"; `kept`, "valid and counting for nothing,
with the reason"; `aside`, "set aside under section 4"; or `struck`, "with the decision that struck it".
The reasons are a closed list which no document writes out: the words here are the fixtures' (FINDINGS-2.md).
"""

from dataclasses import dataclass, field

from .hashes import hash_json
from .reducer import fields_agree

WHY_CHALLENGE = "a challenge held against its set"
WHY_GOLD = "the owner's gold missed its set"
WHY_RANKED = "the panel ranked another first"
WHY_ASIDE = "it rests on nothing where another reading rests on the record"
WHY_VENDOR_SAME = "an earlier reading from its vendor says the same"
WHY_VOID = "its panel is void"
WHY_OWNER = "its root is related to the owner"
WHY_SEAT = "it is not from a person's seat"
WHY_DIFFERS = "it differs from the set on an agree field"
WHY_SET_VENDOR = "the set holds a reading from its vendor"
WHY_SET_ROOT = "its root is related to the root of a reading in the set"
WHY_LATE = "the set was made before it"
WHY_ROOT = "its root is related to the root of an earlier reading"

# What each verifier says of itself beside a piece's state: its kind, the extension that defines it, and how
# strongly it earns a square. The table is in no one document (FINDINGS-2.md); the fixtures hold each row.
KIND_WORDS = {
    "agree": ("agree", None, "agreed"),
    "check": ("check", None, "reproduced"),
    "score": ("score", None, "reproduced"),
    "human": ("human", "QX-3", "agreed"),
    "judge": ("judge", "QX-2", "judged"),
    "attest": ("attest", "QX-10", "attested"),
    "record": ("record", "QX-20", "recorded"),
}


def kind_of(verifier):
    """The kind a verifier string names, with its number where it has one: `judge:3` is (`judge`, 3)."""
    if not isinstance(verifier, str):
        return None, None
    if verifier in ("agree", "check", "score", "human", "attest"):
        return verifier, None
    for kind in ("judge", "record"):
        if verifier.startswith(kind + ":"):
            n = verifier[len(kind) + 1:]
            if n.isdigit() and int(n) >= 1 and str(int(n)) == n:
                return kind, int(n)
    return None, None


@dataclass
class Set:
    """A set (section 5): the readings the kind's rule took, when it was completed, and the version the event
    that completed it names, whose window it runs for (section 3)."""
    members: list
    at: object
    at_text: str
    version: str
    name: str = ""

    def __post_init__(self):
        # "A set is named by the hash of the canonical JSON of its events' ids, sorted."
        self.name = hash_json(sorted(m.id for m in self.members))


def agree(rec, a, b):
    """Whether two returns agree on the piece's agree fields after canonicalisation, CORE.md section 6."""
    props = (rec.spec.get("schema") or {}).get("properties", {})
    for f in rec.agree_fields():
        if f not in a or f not in b:
            return False
        if not fields_agree(a[f], b[f], props.get(f)):
            return False
    return True


def set_of(members, completing):
    return Set(members=list(members), at=completing.at, at_text=completing.at_text, version=completing.problem)


def person_seat(r):
    """verifiers.md section 2, `human`: a reveal "came from a person's seat, which is any of: the receipt's
    wrapper says `seat: "person"`; the wrapper says `custody: "hosted"`, whatever `seat` it says beside"; "or
    the reveal's `by.model` is `human`". "Every wrapper the line carries is read."."""
    for w in r.entry["received"]:
        if w.get("seat") == "person" or w.get("custody") == "hosted":
            return True
    return isinstance(r.by, dict) and r.by.get("model") == "human"


def agree_pass(line, rec, seat=None):
    """CORE.md section 6, An accepting set, for agree: "Reveals are taken in receipt order, and a reveal counts
    only when its root is unrelated to the owner and to the root of every earlier reveal on the piece; among
    counting reveals, the first pair in receipt order whose vendors differ and whose agree fields agree is the
    accepting set, completed at the receipt of its later reveal."

    The readings it reads are the live ones: a struck reading and one set aside are not among them. `seat`,
    where given, is the test of verifiers.md section 2 for a `human` piece, "as `agree`, with the seat where the
    vendor was": a reading not from a person's seat counts for nothing, and "two vendors are not asked for".

    Returns the set, or None, and says how each reading counts in `rec.counts`."""
    ident = line.identity
    counts = rec.counts
    live = []
    for r in rec.live():
        if ident.related(r.root, line.owner, r.at):
            counts[r.id] = ("kept", WHY_OWNER)
            continue
        if seat is not None and not seat(r):
            counts[r.id] = ("kept", WHY_SEAT)
            continue
        live.append(r)
    found = None
    for j, b in enumerate(live):
        if any(ident.related(a.root, b.root, b.at) for a in live[:j]):
            continue
        for a in live[:j]:
            if (seat is not None or a.vendor != b.vendor) and agree(rec, a.ret, b.ret):
                found = set_of([a, b], b)
                break
        if found:
            break
    if found is None:
        # No set: a reading counts toward one unless its vendor has said the same already. A second reading from
        # one root counts toward one too, on a human piece at least (fixture verifiers-human-one-root).
        toward = []
        for r in live:
            if seat is None and any(a.vendor == r.vendor and agree(rec, a.ret, r.ret) for a in toward):
                counts[r.id] = ("kept", WHY_VENDOR_SAME)
            else:
                counts[r.id] = ("counted", None)
                toward.append(r)
        return None
    members = {m.id for m in found.members}
    first = found.members[0]
    for r in live:
        if r.id in members:
            counts[r.id] = ("counted", None)
        elif r.at > found.at or live.index(r) > live.index(found.members[-1]):
            counts[r.id] = ("kept", WHY_LATE)
        elif not agree(rec, first.ret, r.ret):
            counts[r.id] = ("kept", WHY_DIFFERS)
        elif any(ident.related(m.root, r.root, r.at) for m in found.members):
            counts[r.id] = ("kept", WHY_SET_ROOT)
        elif seat is None and any(m.vendor == r.vendor for m in found.members):
            counts[r.id] = ("kept", WHY_SET_VENDOR)
        else:
            counts[r.id] = ("counted", None)
    return found


def differ(line, rec, readings):
    """CORE.md section 6: "A piece is disputed when any two reveals from unrelated roots differ on an agree
    field and no set exists." The owner's reveal counts here like anyone's."""
    for j, b in enumerate(readings):
        for a in readings[:j]:
            if line.identity.related(a.root, b.root, b.at):
                continue
            if not agree(rec, a.ret, b.ret):
                return True
    return False


def attest_pass(line, rec):
    """verifiers.md section 2, `attest`: "The first valid reveal from a root unrelated to the owner is the
    accepting set", "with that one reveal, completed at its receipt"."""
    found = None
    for r in rec.live():
        if line.identity.related(r.root, line.owner, r.at):
            rec.counts[r.id] = ("kept", WHY_OWNER)
        elif found is None:
            found = set_of([r], r)
            rec.counts[r.id] = ("counted", None)
        else:
            rec.counts[r.id] = ("kept", WHY_LATE)
    return found


def record_pass(line, rec, n):
    """QX-20 section 2: "A reading stands when its reveal is valid in the core's sense, its root is unrelated to
    the owner and to the root of every earlier standing reading, and fewer than `n` stand before it, in receipt
    order." "A record piece has no accepting set." Returns the standing readings."""
    standing = []
    for r in rec.live():
        if line.identity.related(r.root, line.owner, r.at):
            rec.counts[r.id] = ("kept", WHY_OWNER)
        elif any(line.identity.related(a.root, r.root, r.at) for a in standing):
            rec.counts[r.id] = ("kept", WHY_ROOT)
        elif len(standing) >= n:
            rec.counts[r.id] = ("kept", WHY_LATE)
        else:
            rec.counts[r.id] = ("counted", None)
            standing.append(r)
    return standing
