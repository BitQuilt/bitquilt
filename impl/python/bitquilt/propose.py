"""The proposed pieces beside a problem: READING.md section 3, by QX-22 sections 1 to 3 and 5.

Section 3: "The proposed pieces beside a problem (QX-22 sections 1 to 3) are on the line's record and move no
state." A proposal is read from the line alone. None is accepted or struck, and none earns.

QX-22 section 1 holds `piece.brief` and `why` to the plain-text gate (CORE.md section 11). This implementation
has no gate, since reading 1 leaves the gate to the door, so a proposal the gate alone would pass over stands
here. No fixture holds one (FINDINGS-2.md).
"""

import re

from .canonical import canonical
from .envelope import expand
from .inherit import listed
from .kinds import kind_of

SLUG = re.compile(r"^[a-z0-9-]{1,64}$")
PIECE_MAX = 16384
WHY_MAX = 500


def proposed_hash(name, piece):
    """QX-22 section 1: "the hash is had from the body alone: the piece set alone under `name` and expanded. A
    piece that cannot be expanded so has no hash and is no proposal.\""""
    try:
        specs = expand({"problem": {"pieces": {name: piece}, "data": {}}}, {})
    except Exception:
        return None
    return specs[0]["hash"] if len(specs) == 1 else None


def well_formed(ev):
    """Section 1's table: the body's shape and a piece its hash can name. The signature of the event's own key
    was held when the line's record was folded. Gives the piece's hash, or None for a `propose` passed over."""
    if "piece" in ev:
        return None
    body = ev.get("body")
    if not isinstance(body, dict) or set(body) != {"name", "piece", "why"}:
        return None
    name, piece, why = body["name"], body["piece"], body["why"]
    if not isinstance(name, str) or not SLUG.match(name):
        return None
    if not isinstance(piece, dict) or "count" in piece or "data" in piece:
        return None
    if len(canonical(piece).encode("utf-8")) > PIECE_MAX:
        return None
    inputs = piece.get("inputs")
    if inputs is not None and (not isinstance(inputs, list) or name in inputs):
        return None
    if not isinstance(why, str) or len(why) > WHY_MAX:
        return None
    return proposed_hash(name, piece)


def standing_proposals(line):
    """QX-22 section 2: "The proposals that stand on a problem are the well-formed `propose` events on its
    chain, in receipt order. Of several proposals of one piece by one root, the first stands and the rest are
    passed over." The chain is the line's record, so "the proposals of every version of a line stand at each
    version of it"."""
    out, seen = [], set()
    for entry in line.ext:
        ev = entry["event"]
        if ev.get("type") != "propose":
            continue
        h = well_formed(ev)
        if h is None or (entry["root"], h) in seen:
            continue
        seen.add((entry["root"], h))
        out.append((entry, h))
    return out


def workers(line):
    """The roots with work standing on the line: "a root of an accepting set on a piece of the problem or of an
    ancestor, or of a reading that stands on a record piece". A struck set is no set on the record here."""
    out = set()
    for rec in line.recs.values():
        if kind_of(rec.verifier)[0] == "record":
            out.update(m.root for m in getattr(rec, "standing", []))
        elif rec.set is not None:
            out.update(m.root for m in rec.set.members)
    return out


def holds(version, piece):
    return any(s["hash"] == piece for s in version.specs)


def taken(version, under, piece):
    """"The first version after the one the proposal names, up to the version read, whose envelope holds a
    piece of that hash, or null where none does. A read at the version a proposal names says null." A version
    read that does not come after the one named, along `prev`, says null too."""
    path, seen = [], set()
    v = version
    while v is not None and v.hash not in seen and v.hash != under:
        seen.add(v.hash)
        path.append(v)
        v = version.line.by_hash.get(v.problem.get("prev"))
    if v is None or v.hash != under:
        return None
    for v in reversed(path):
        if holds(v, piece):
            return v.hash
    return None


def pursued(led, line, piece):
    """"The forks of a version of the line ... whose envelopes hold a piece of that hash. A fork of the line is
    a problem another owner published with `from` naming a version of the line, and each later version of that
    fork." Every version of the fork's line that holds the piece is listed, in the order of the hashes, as the
    fixture propose-1 lists a fork and the version that replaced it."""
    out = []
    for other in led.lines.values():
        if other is line or other.owner == line.owner:
            continue
        if not any(h in line.by_hash for v in other.versions for h in listed(v.problem.get("from"))):
            continue
        out.extend(v.hash for v in other.versions if holds(v, piece))
    return sorted(out)


def proposals_said(led, version):
    """The proposals that stand at a version, each in the form QX-22 section 5 lists and a fixture keeps."""
    line = version.line
    worked = workers(line)
    out = []
    for entry, h in standing_proposals(line):
        ev = entry["event"]
        body = ev["body"]
        out.append({
            "id": entry["id"], "under": ev["problem"], "name": body["name"], "hash": h, "piece": body["piece"],
            "why": body["why"], "key": ev["key"], "root": entry["root"], "at": entry["at_text"],
            "proposer": None, "worked": entry["root"] in worked,
            "taken": taken(version, ev["problem"], h), "pursued": pursued(led, line, h),
        })
    return out
