"""The read of reading 2: READING.md section 1, in the eight steps of sections 2 to 9.

Section 1: "`state = read(ledger, now)`", where the ledger is "every envelope, every blob the envelopes name,
and every receipt held, on every log", and the state is, "for each piece of each line: its record, its set or
none, its one state, and what its readings rest on; for each line: complete or not, and the output; across the
ledger: each root's standing". `now` enters only through the leases, the windows and the hold a lock's free
standing is read at.

What `read` returns is the state in the form a fixture keeps under `expect`, key for key and in the fixture's
order, so `conform2.py` holds it to the file as JSON.
"""

from .canonical import canonical
from .hashes import hash_json
from .identity import same_address
from .kinds import KIND_WORDS, kind_of, agree_pass, differ
from .record import Ledger, fold_record, iso
from .times import parse_time, hours

DONE = ("accepted", "unreachable", "recorded")
SET_STATES = ("accepted", "accepted_provisional", "unreachable", "challenged")


def read(ledger, now):
    """The state of a ledger at `now`, as a fixture says it."""
    now = parse_time(now) if isinstance(now, str) else now
    led = Ledger(ledger)
    reading = Read(led, now)
    reading.run()
    return reading.said()


class Read:
    def __init__(self, led, now):
        self.led = led
        self.now = now
        self.credits = {}       # root -> the ids of the reveals it is credited for

    def run(self):
        # Section 3, the record.
        for line in self.led.lines.values():
            fold_record(line, self.led.identity)
        # Sections 4 to 6, the grounds, the sets and standing, to a fixed point.
        self.sets()

    # Section 5, the sets.

    def sets(self):
        for line in self.led.lines.values():
            for rec in line.recs.values():
                self.set_of(line, rec)

    def set_of(self, line, rec):
        rec.counts = {}
        rec.set = None
        kind, n = kind_of(rec.verifier)
        if kind == "agree":
            rec.set = agree_pass(line, rec)
        else:
            for r in rec.live():
                rec.counts[r.id] = ("counted", None)

    # Section 9, the state.

    def own_state(self, line, rec):
        now = self.now
        kind, n = kind_of(rec.verifier)
        if kind is None:
            return "unknown"
        if rec.set is not None:
            window = hours(line.by_hash[rec.set.version].settings["challenge_window_h"])
            if now < rec.set.at + window:
                return "accepted_provisional"
            return "unreachable" if unreachable(rec) else "accepted"
        live = rec.live()
        if differ(line, rec, live):
            return "disputed"
        if live:
            return "needs_verify"
        if any(c.revealed is None and now < c.at + 2 * c.lease for c in rec.commits):
            return "sealed"
        if any(now < c.at + c.lease for c in rec.claims):
            return "in_flight"
        return "open"

    def states_of(self, version):
        """Each piece's state on one version: its own state on the line's record, or `locked` while an input of
        its own version is not done (CORE.md section 6, Per piece)."""
        line = version.line
        specs = version.specs
        memo = {}

        def inputs_of(spec):
            out = []
            for name in spec.get("inputs") or []:
                found = [s for s in specs if s["name"] == name or s["key"] == name]
                if not found:
                    out.append(None)
                out.extend(found)
            return out

        def final(spec, stack):
            h = spec["hash"]
            if h in memo:
                return memo[h]
            if h in stack:
                return "locked"
            stack = stack | {h}
            for inp in inputs_of(spec):
                if inp is None or final(inp, stack) not in DONE:
                    memo[h] = "locked"
                    return "locked"
            memo[h] = self.own_state(line, line.recs[h])
            return memo[h]

        return {spec["name"]: final(spec, frozenset()) for spec in specs}

    def view(self, version, spec, state):
        line = version.line
        rec = line.recs[spec["hash"]]
        kind, n = kind_of(rec.verifier)
        words = KIND_WORDS.get(kind, (None, None, None))
        readings = []
        for r in rec.readings:
            if r.id in rec.struck:
                why, by = rec.struck[r.id]
                counts = "struck"
            elif r.id in rec.aside:
                counts, why, by = "aside", "it rests on nothing where another reading rests on the record", None
            else:
                counts, why = rec.counts.get(r.id, ("counted", None))
                by = None
            readings.append({"id": r.id, "problem": r.problem, "key": r.key, "root": r.root, "vendor": r.vendor,
                             "at": r.at_text, "counts": counts, "why": why, "by": by})
        s = rec.set
        said_set = None
        if s is not None:
            said_set = {"name": s.name, "kind": "agree", "completedAt": s.at_text,
                        "members": [{"id": m.id, "key": m.key, "at": m.at_text, "digest": m.digest}
                                    for m in s.members]}
        return {
            "state": state,
            "kind": words[0],
            "extension": words[1],
            "strength": words[2],
            "attested": False,
            "stake": 0,
            "gold": None,
            "verified": False,
            "aside": [],
            "readings": readings,
            "inherited": None,
            "challenge": None,
            "set": said_set,
            "record": None,
            "trace": {"traces": [], "traced": "none" if s is not None else None, "seams": [], "aside": [],
                      "record": None},
        }

    def said(self):
        led = self.led
        problems = {}
        for h in sorted(led.versions):
            version = led.versions[h]
            states = self.states_of(version)
            views, index, pieces = [], {}, {}
            for spec in version.specs:
                view = self.view(version, spec, states[spec["name"]])
                key = canonical(view)
                if key not in index:
                    index[key] = len(views)
                    views.append(view)
                pieces[spec["name"]] = index[key]
            own = bool(version.specs) and all(states[s["name"]] in DONE for s in version.specs)
            output = None
            if own and all(states[s["name"]] in ("accepted", "unreachable") for s in version.specs):
                output = hash_json(self.output_document(version, states))
            problems[h] = {
                "line": version.line.name,
                "complete": own,
                "own_complete": own,
                "output": output,
                "record_output": None,
                "dropped": 0,
                "unoffered": [],
                "stake": None,
                "gold": {"committed": 0, "pending": 0, "verified": 0, "missed": 0, "overruled": 0, "lapsed": 0},
                "locks": [],
                "golds": [],
                "challenges": [],
                "panels": [],
                "proposals": [],
                "views": views,
                "pieces": pieces,
            }
        return {"problems": problems, "refused": dict(sorted(led.refused.items())), "standing": self.standing()}

    def output_document(self, version, states):
        """CORE.md section 6, Output: `{quilt, problem, pieces}`, a piece's name, hash and state, an agree piece
        with `agreed`, the agree fields of the set's first reveal, and `evidence`, for each reveal of the set
        its signer and every other field."""
        pieces = []
        for spec in version.specs:
            rec = version.line.recs[spec["hash"]]
            entry = {"name": spec["name"], "piece": spec["hash"], "state": states[spec["name"]]}
            if rec.set is not None:
                fields = rec.agree_fields()
                first = rec.set.members[0].ret
                entry["agreed"] = {f: first.get(f) for f in fields}
                entry["evidence"] = [dict({"signer": m.root}, **{k: v for k, v in m.ret.items() if k not in fields})
                                     for m in rec.set.members]
            pieces.append(entry)
        return {"quilt": 1, "problem": version.hash, "pieces": pieces}

    # Section 6, standing.

    def standing(self):
        led = self.led
        roots = set()
        credit = {}
        for line in led.lines.values():
            roots.add(line.owner)
            roots.update(line.identity.final(r) for r in line.roots)
            for rec in line.recs.values():
                if rec.set is not None:
                    for m in rec.set.members:
                        credit.setdefault(m.root, set()).add(m.id)
        out = {}
        for root in sorted(roots):
            n = 1 + int(led.founding.get(root, 0)) + len(credit.get(root, ()))
            out[root] = {"standing": n, "locked": 0, "free": n}
        return out


def unreachable(rec):
    """CORE.md section 6: "where the accepting set's first reveal has the value unreachable in an agree field
    whose schema is an enum that lists it"."""
    props = (rec.spec.get("schema") or {}).get("properties", {})
    ret = rec.set.members[0].ret
    for f in rec.agree_fields():
        prop = props.get(f)
        if ret.get(f) == "unreachable" and prop is not None and "unreachable" in (prop.get("enum") or []):
            return True
    return False
