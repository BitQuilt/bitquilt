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
from .grounds import fold_traces, set_aside, seams_of, traced
from .kinds import KIND_WORDS, WHY_VERIFIER, kind_of, agree_pass, attest_pass, record_pass, person_seat, differ
from .kinds import find_set, runs_pass
from .decisions import Decisions
from .inherit import Reach
from .propose import proposals_said
from .record import Ledger, entries_of, fold_record, iso
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
            fold_traces(line, self.led.reads)
        # Sections 4 to 6, the grounds, the sets and standing, to a fixed point, then section 7, the decisions.
        self.dec = Decisions(self)
        self.dec.run()
        # Section 8, the reach.
        self.inh = Reach(self)

    # Section 5, the sets.

    def sets(self):
        for line in self.led.lines.values():
            for rec in line.recs.values():
                # Section 4, "The grounds are read before the sets".
                rec.aside = set_aside(line, rec)
                self.set_of(line, rec)

    def set_of(self, line, rec):
        rec.counts = {}
        rec.set = None
        kind, n = kind_of(rec.verifier)
        rec.standing = []
        if kind == "agree":
            rec.set = agree_pass(line, rec)
        elif kind == "human":
            rec.set = agree_pass(line, rec, seat=person_seat)
        elif kind == "attest":
            rec.set = attest_pass(line, rec)
        elif kind == "record":
            rec.standing = record_pass(line, rec, n)
        elif kind == "judge":
            rec.set = self.dec.judge(line, rec, n)
        elif kind in ("check", "score"):
            rec.set = runs_pass(line, rec, kind)
        else:
            # READING.md section 3: "Any other verifier: every reading says" that its piece asks one unknown here.
            for r in rec.live():
                rec.counts[r.id] = ("kept", WHY_VERIFIER)

    # Section 9, the state.

    def own_state(self, line, rec, challenges=True):
        now = self.now
        kind, n = kind_of(rec.verifier)
        if kind is None:
            return "unknown"
        if rec.set is not None:
            # QX-1 section 7: "`challenged`: a challenge on the piece is open."
            if challenges and self.dec.open_on(line, rec) is not None:
                return "challenged"
            window = hours(line.by_hash[rec.set.version].settings["challenge_window_h"])
            if now < rec.set.at + window:
                return "accepted_provisional"
            return "unreachable" if unreachable(rec) else "accepted"
        live = rec.live()
        if kind == "judge":
            # verifiers.md section 2: "`judging` while the panel sits", "`disputed` when void".
            panel = self.dec.panels.get((line.name, rec.hash))
            if panel is not None:
                return "judging" if panel.outcome == "open" else "disputed"
        if kind == "record":
            if len(rec.standing) >= n:
                return "recorded"
            if rec.standing:
                return "recording"
            live = []
        if kind == "human":
            live = [r for r in live if rec.counts.get(r.id) != ("kept", "it is not from a person's seat")]
            if differ(line, rec, [r for r in live if not line.identity.related(r.root, line.owner, r.at)]):
                return "disputed"
            if rec.live():
                return "needs_verify"
        elif differ(line, rec, live):
            return "disputed"
        if live:
            return "needs_verify"
        if any(c.revealed is None and now < c.at + 2 * c.lease for c in rec.commits):
            return "sealed"
        if any(now < c.at + c.lease for c in rec.claims):
            return "in_flight"
        return "open"

    def core_open(self, version, spec, stack=frozenset()):
        """Whether version 1's fold leaves a piece unlocked: each input is of a kind the core knows, is itself
        unlocked there, and has the core's set, over every reading, with its window closed."""
        line = version.line
        if spec["hash"] in stack:
            return False
        stack = stack | {spec["hash"]}
        for name in spec.get("inputs") or []:
            found = [s for s in version.specs if s["name"] == name or s["key"] == name]
            if not found:
                return False
            for inp in found:
                rec = line.recs[inp["hash"]]
                if kind_of(rec.verifier)[0] != "agree" or not self.core_open(version, inp, stack):
                    return False
                readings = [r for r in rec.readings if not line.identity.related(r.root, line.owner, r.at)]
                found_set = find_set(line, rec, readings)
                if found_set is None:
                    return False
                if self.now < found_set.at + hours(line.by_hash[found_set.version].settings["challenge_window_h"]):
                    return False
        return True

    def grounds_of(self, version, spec, state):
        """What a piece's view says of its grounds: the traces kept, the grade of its set, the seams and the
        readings set aside. QX-19 section 4: a seam "is computed over the layer's fold where the layer still
        calls the piece disputed, and over the core's fold where the layer has set a reading aside"."""
        line = version.line
        rec = line.recs[spec["hash"]]
        kind = kind_of(rec.verifier)[0]
        grade = None
        # A set of runs has no grade: a trace says what a return rests on, and a run is no return.
        if rec.set is not None and rec.set.kind == "agree" and state in SET_STATES:
            n = sum(1 for m in rec.set.members if traced(rec, m))
            grade = "both" if n >= 2 else "one" if n == 1 else "none"
        seams, aside = [], []
        if kind == "record":
            seams = seams_of(line, rec, rec.standing)
        elif state == "disputed":
            seams = seams_of(line, rec, rec.live())
        elif rec.aside and self.core_open(version, spec):
            seams = seams_of(line, rec, [r for r in rec.readings if r.id not in rec.struck])
            aside = sorted(rec.aside)
        return {"traces": rec.traces, "traced": grade, "seams": seams, "aside": aside}

    def view(self, version, spec, state, own=None, inherited=None):
        own = state if own is None else own
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
            said_set = {"name": s.name, "kind": s.kind, "completedAt": s.at_text,
                        "members": [{"id": m.id, "key": m.key, "at": m.at_text, "digest": m.digest}
                                    for m in s.members]}
        last = self.dec.last_on(line, rec)
        said_record, grade = None, None
        if kind == "record":
            stands = rec.standing
            said_record = {"wanted": n, "recordedAt": stands[n - 1].at_text if len(stands) >= n else None,
                           "standing": [{"id": m.id, "key": m.key, "at": m.at_text, "digest": m.digest}
                                        for m in stands]}
            grade = {"wanted": n, "standing": len(stands), "grounded": sum(1 for m in stands if traced(rec, m)),
                     "roots": len({m.root for m in stands}), "vendors": len({m.vendor for m in stands}),
                     "keys": [m.key for m in stands]}
        return {
            "state": state,
            "kind": words[0],
            "extension": words[1],
            "strength": words[2],
            "attested": kind == "attest" and s is not None,
            "stake": self.dec.stake_of(version, spec, self.now),
            "gold": self.dec.gold_of(version, rec),
            "verified": self.dec.gold_of(version, rec) == "match",
            "aside": sorted({r.key for r in rec.readings if r.id in rec.aside and r.id not in rec.struck}),
            "readings": readings,
            "inherited": inherited,
            "challenge": last.id if last is not None else None,
            "set": said_set,
            "record": said_record,
            "trace": dict(self.grounds_of(version, spec, own), record=grade),
        }

    def said(self):
        led = self.led
        problems = {}
        for h in sorted(led.versions):
            version = led.versions[h]
            settled = self.inh.states(version)
            states = {name: s[0] for name, s in settled.items()}
            views, index, pieces = [], {}, {}
            for spec in version.specs:
                view = self.view(version, spec, *settled[spec["name"]])
                key = canonical(view)
                if key not in index:
                    index[key] = len(views)
                    views.append(view)
                pieces[spec["name"]] = index[key]
            own = self.inh.own_complete(version)
            complete = self.inh.complete(version)
            output = None
            core = all(kind_of(s.get("verifier"))[0] in ("agree", "check", "score") for s in version.specs)
            if complete and core and all(states[s["name"]] in ("accepted", "unreachable") for s in version.specs):
                output = hash_json(self.output_document(version, states))
            # QX-20 section 4: "When the layer calls the problem complete and it has a record piece".
            record_output = None
            if complete and any(kind_of(s.get("verifier"))[0] == "record" for s in version.specs):
                record_output = hash_json(self.record_document(version, settled))
            dec = self.dec
            line = version.line
            names = {s["hash"]: s["name"] for s in version.specs}
            rule = dec.rule_at(version, self.now)
            golds = [g for g in dec.golds if g.version is version]
            panels = [(dec.panels.get((line.name, s["hash"])), s) for s in version.specs]
            problems[h] = {
                "line": version.line.name,
                "complete": complete,
                "own_complete": own,
                "output": output,
                "record_output": record_output,
                # The locks, the golds, the gold reveals and the challenges the pass dropped at this problem, and the
                # ranks its panels took for nothing; what reading 1's fold drops is not counted (FINDINGS-2.md).
                "dropped": dec.dropped.get(h, 0) + sum(len(p.dropped) for p, s in panels if p is not None),
                "unoffered": sorted(s["hash"] for p, s in panels if p is not None and p.outcome != "decided"),
                "stake": {"min": rule.min, "pieces": rule.pieces} if rule is not None else None,
                "gold": dec.gold_counts(golds),
                "locks": [dec.lock_said(k) for k in dec.locks if k.version == h],
                "golds": [dec.gold_said(g) for g in golds],
                "challenges": [dec.challenge_said(c) for c in dec.challenges if c.version is version],
                "panels": [dec.panel_said(p, s["name"]) for p, s in panels if p is not None],
                "proposals": proposals_said(led, version),
                "views": views,
                "pieces": pieces,
            }
        return {"problems": problems, "refused": dict(sorted(led.refused.items())), "standing": self.standing()}

    def output_document(self, version, states):
        """CORE.md section 6, Output: `{quilt, problem, pieces}`, a piece's name, hash and state, an agree piece
        with `agreed`, the agree fields of the set's first reveal, and `evidence`, for each reveal of the set
        its signer and every other field; a check or a score piece with `patch`, `author` and `runs`, each run
        its signer, `exit` and `host`, with `score` and `image` where it says them."""
        pieces = []
        for spec in version.specs:
            rec = version.line.recs[spec["hash"]]
            entry = {"name": spec["name"], "piece": spec["hash"], "state": states[spec["name"]]}
            if rec.set is not None and rec.set.kind != "agree":
                patch, *runs = rec.set.members
                entry["patch"] = patch.ret.get("patch")
                entry["author"] = patch.root
                entry["runs"] = [dict({"signer": x.root, "exit": x.exit, "host": x.host},
                                      **{k: v for k, v in (("score", x.score), ("image", x.image)) if v is not None})
                                 for x in runs]
            elif rec.set is not None:
                fields = rec.agree_fields()
                first = rec.set.members[0].ret
                entry["agreed"] = {f: first.get(f) for f in fields}
                entry["evidence"] = [dict({"signer": m.root}, **{k: v for k, v in m.ret.items() if k not in fields})
                                     for m in rec.set.members]
            pieces.append(entry)
        return {"quilt": 1, "problem": version.hash, "pieces": pieces}

    def record_document(self, version, settled):
        """QX-20 section 4: "canonical JSON `{ quilt: 1, problem, extension: "QX-20", pieces: [...] }`, one entry
        per piece in file order as the core's output has it", "a record piece's entry carrying `wanted` and
        `readings`, each `{ signer, key, vendor, model, at, return, trace }` with the trace as the chain states
        it (the reads and the rests of the key's trace event, or null)". QX-23 section 4: "an inherited piece's
        entry is `{ name, piece, state: "inherited", inherited }`, where `inherited` is the hash of the problem
        where the square stands"."""
        states = {name: s[0] for name, s in settled.items()}
        pieces = []
        for entry in self.output_document(version, states)["pieces"]:
            spec = next(s for s in version.specs if s["name"] == entry["name"])
            rec = version.line.recs[spec["hash"]]
            kind, n = kind_of(rec.verifier)
            if entry["state"] == "inherited":
                entry = {"name": entry["name"], "piece": entry["piece"], "state": "inherited",
                         "inherited": settled[entry["name"]][2]["problem"]}
            elif kind == "record":
                readings = []
                for m in rec.standing:
                    trace = rec.trace_of.get(m.id)
                    readings.append({"signer": m.root, "key": m.key, "vendor": m.vendor, "model": m.by.get("model"),
                                     "at": m.at_text, "return": m.ret,
                                     "trace": {"reads": trace["reads"], "rests": trace["rests"]} if trace else None})
                entry["wanted"] = n
                entry["readings"] = readings
            pieces.append(entry)
        return {"quilt": 1, "problem": version.hash, "extension": "QX-20", "pieces": pieces}

    # Section 6, standing.

    def standing(self):
        """Each root's standing at `now`, with what is locked and what is free (QX-15 section 3)."""
        led = self.led
        roots = set()
        for line in led.lines.values():
            roots.add(line.owner)
            roots.update(line.identity.final(r) for r in line.roots)
        # The signers of the coin log's events are listed too (routes-2, coin-1), by their roots.
        lines = list(led.lines.values())
        for entry in entries_of([led.coin or []]):
            key = entry["event"].get("key")
            if isinstance(key, str) and entry["at"] is not None:
                root = lines[0].identity.root_of(key, entry["at"]) if lines else key
                roots.add(lines[0].identity.final(root) if lines else root)
        out = {}
        for root in sorted(roots):
            n = self.dec.standing_at(root, self.now)
            locked = self.dec.locked_at(root, self.now)
            out[root] = {"standing": n, "locked": locked, "free": max(0, n - locked)}
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
