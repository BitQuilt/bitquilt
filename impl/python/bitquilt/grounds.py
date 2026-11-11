"""The grounds: READING.md section 4, with the trace as QX-19 sections 1 to 4 keep it.

Section 4: "A reading that rests on nothing, where another on the piece rests on a kept read and the two differ,
is set aside as QX-19 section 4 says. The seams between readings that differ are computed as that section
computes them." Section 3 names, among what a reading carries, "what it rests on, by its trace".

A trace is never folded and changes no state by itself. What it changes is which reading is set aside, and
that is read with the sets.
"""

from .identity import same_address
from .kinds import kind_of, find_set, differs_on

SPAN_MAX = 2000


def is_whole(n):
    return isinstance(n, int) and not isinstance(n, bool) and n >= 0


def trace_fits(body, reading, reads):
    """QX-19 section 1, the body of a trace: `reads` is a list of 1 to 16 `{ url, hash, at, media? }`, each
    `hash` one whose blob the resolver holds; `rests` is a list of 1 to 64 `{ field, read, span }`, `field` a
    top-level field of the reveal's return, `read` an index into `reads`, and `span` two whole numbers with
    `start < end`, `end` at most the blob's length in bytes, and `end - start` at most 2000. The ledger's
    `reads` says which reads are held, with the length of each."""
    got, rests = body.get("reads"), body.get("rests")
    if not isinstance(got, list) or not 1 <= len(got) <= 16:
        return False
    for read in got:
        if not isinstance(read, dict):
            return False
        url = read.get("url")
        if not isinstance(url, str) or not 1 <= len(url) <= 2048:
            return False
        if not isinstance(read.get("hash"), str) or not is_whole(reads.get(read["hash"])):
            return False
        if not isinstance(read.get("at"), str):
            return False
    if not isinstance(rests, list) or not 1 <= len(rests) <= 64:
        return False
    for rest in rests:
        if not isinstance(rest, dict) or rest.get("field") not in reading.ret:
            return False
        i, span = rest.get("read"), rest.get("span")
        if not is_whole(i) or i >= len(got):
            return False
        if not isinstance(span, list) or len(span) != 2 or not is_whole(span[0]) or not is_whole(span[1]):
            return False
        if not span[0] < span[1] <= reads[got[i]["hash"]] or span[1] - span[0] > SPAN_MAX:
            return False
    return True


def fold_traces(line, reads):
    """The traces the line's record keeps, piece by piece, in receipt order. QX-19 section 1: a trace is valid
    when its `reveal` is the id of a kept reveal on the piece signed by the same key, the key and not its root,
    and no earlier kept trace names it."""
    for rec in line.recs.values():
        rec.traces = []
        rec.trace_of = {}
    for entry in line.ext:
        ev = entry["event"]
        if ev.get("type") != "trace":
            continue
        rec = line.recs.get(ev.get("piece"))
        if rec is None:
            continue
        body = ev["body"]
        reading = next((r for r in rec.readings if r.id == body.get("reveal")), None)
        if reading is None or not same_address(reading.key, ev["key"]) or reading.entry["seq"] > entry["seq"]:
            continue
        if reading.id in rec.trace_of or not trace_fits(body, reading, reads):
            continue
        trace = {"id": entry["id"], "key": ev["key"], "at": entry["at_text"], "reveal": reading.id,
                 "reads": body["reads"], "rests": body["rests"]}
        rec.traces.append(trace)
        rec.trace_of[reading.id] = trace


def rest_of(rec, reading, field):
    """The read and the span a reading rests a field on: the first rest its trace gives the field, or None."""
    trace = rec.trace_of.get(reading.id)
    if trace is None:
        return None
    for rest in trace["rests"]:
        if rest["field"] == field:
            return trace["reads"][rest["read"]], rest["span"]
    return None


def traced(rec, reading):
    """QX-19 section 3: a reveal is traced when a kept trace names it and every agreed field of the piece, the
    schema's `agree` fields, else its required fields, has at least one rest."""
    return reading.id in rec.trace_of and all(rest_of(rec, reading, f) is not None for f in rec.agree_fields())


def set_aside(line, rec):
    """QX-19 section 4: "Where, on every field the two differ on, one side rests on a kept read and the other on
    nothing, the layer sets the other reading aside", each pair judged on its own, and a reading that loses any
    pair is set aside. The pairs are those of a piece disputed over every reading no decision struck: each two
    readings from unrelated roots that differ, where no set stands over all of them. Returns the ids set
    aside."""
    kind = kind_of(rec.verifier)[0]
    if kind not in ("agree", "human"):
        return set()
    readings = [r for r in rec.readings if r.id not in rec.struck]
    readings = [r for r in readings if not line.identity.related(r.root, line.owner, r.at)]
    if not rec.trace_of or find_set(line, rec, readings, kind == "agree") is not None:
        return set()
    aside = set()
    for j, b in enumerate(readings):
        for a in readings[:j]:
            if line.identity.related(a.root, b.root, b.at):
                continue
            fields = differs_on(rec, a.ret, b.ret)
            if not fields:
                continue
            on_a = [rest_of(rec, a, f) is not None for f in fields]
            on_b = [rest_of(rec, b, f) is not None for f in fields]
            if all(on_a) and not any(on_b):
                aside.add(b.id)
            elif all(on_b) and not any(on_a):
                aside.add(a.id)
    return aside


def seams_of(line, rec, readings):
    """QX-19 section 4: each two reveals from unrelated roots that differ are the sides of its seams, pair by
    pair in the order they were kept, and for each agreed field on which a pair differs there is a seam, saying
    why from the traces: `source`, the sides' rests name reads of different hashes; `span`, the same read at
    spans that do not overlap; `reading`, the same read at spans that overlap; `unknown`, a side has no rest
    for the field. A passage is the bytes of a span, which the ledger does not carry, so it is null."""
    seams = []
    for i, a in enumerate(readings):
        for b in readings[i + 1:]:
            if line.identity.related(a.root, b.root, b.at):
                continue
            for field in differs_on(rec, a.ret, b.ret):
                on_a, on_b = rest_of(rec, a, field), rest_of(rec, b, field)
                if on_a is None or on_b is None:
                    why = "unknown"
                elif on_a[0]["hash"] != on_b[0]["hash"]:
                    why = "source"
                elif on_a[1][0] < on_b[1][1] and on_b[1][0] < on_a[1][1]:
                    why = "reading"
                else:
                    why = "span"
                sides = []
                for r, on in ((a, on_a), (b, on_b)):
                    sides.append({"key": r.key, "value": r.ret.get(field), "read": on[0] if on else None,
                                  "span": on[1] if on else None, "passage": None, "aside": r.id in rec.aside})
                seams.append({"field": field, "why": why, "sides": sides})
    return seams
