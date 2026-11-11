"""The reach and the inherited squares: READING.md section 8, by QX-23 sections 1 to 4.

Section 8: "A fork reaches the line of each problem its line's envelopes name in `from`, and what those lines
reach", and "A piece the fork keeps, with no set of the fork's own and its inputs done, shows the square it has
on a line the fork reaches". "Nothing is credited, struck or earned for it, and a square is read where it was
made."

This is the layer's last pass. It reads each piece's own state, which sections 3 to 7 settled, and adds no event
and no set. A version's states are worked out once and kept, and a version met again while its own states are
being worked out, on a ring of `from`, gives its own states with no inherited square among them.
"""

DONE = ("accepted", "unreachable", "recorded")
SQUARES = ("accepted_provisional", "accepted", "unreachable", "challenged", "recorded")


def listed(value):
    """What an envelope's `from` names, as a list: nothing, one hash, or each hash of a list."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [v for v in value if isinstance(v, str)]
    return []


def inputs_of(version, spec):
    """The pieces a piece's inputs name on its own version, with None for a name no piece has."""
    out = []
    for name in spec.get("inputs") or []:
        found = [s for s in version.specs if s["name"] == name or s["key"] == name]
        if not found:
            out.append(None)
        out.extend(found)
    return out


class Reach:
    def __init__(self, read):
        self.read = read
        self.led = read.led
        self.reached = {}       # version hash -> the versions it reaches, in the order of QX-23 section 1
        self.settled = {}       # version hash -> {piece name: (state, own state, inherited or None)}
        self.working = set()

    # QX-23 section 1, what a fork reaches.

    def chain(self, version):
        """The length of a version's chain along `prev`, over the versions held."""
        n, seen = 0, set()
        while version is not None and version.hash not in seen:
            seen.add(version.hash)
            n += 1
            version = version.line.by_hash.get(version.problem.get("prev"))
        return n

    def sources(self, version):
        """"Each `from` an envelope of F's line names is a source: F's own envelope first, then each ancestor's
        along `prev`, then those of the other versions of F's line the tracker holds, in the order of their
        hashes.\""""
        line = version.line
        order, seen = [], set()
        v = version
        while v is not None and v.hash not in seen:
            order.append(v)
            seen.add(v.hash)
            v = line.by_hash.get(v.problem.get("prev"))
        order.extend(sorted((x for x in line.versions if x.hash not in seen), key=lambda x: x.hash))
        out = []
        for v in order:
            for h in listed(v.problem.get("from")):
                if h not in out:
                    out.append(h)
        return out

    def reach(self, version):
        """The versions a problem reaches. "For a source S the tracker holds, F reaches the line of S: S first,
        and then every other version of S's line the tracker holds, a shorter chain before a longer and, of two
        as long, the lesser hash first", and "what S's line reaches by the same rule". "A problem never reaches
        a version of its own line, and a ring of `from` is walked once.\""""
        if version.hash in self.reached:
            return self.reached[version.hash]
        out = []
        walked = {version.line.name}

        def walk(v):
            for h in self.sources(v):
                source = self.led.versions.get(h)
                if source is None or source.line.name in walked:
                    continue
                walked.add(source.line.name)
                out.append(source)
                rest = [x for x in source.line.versions if x is not source]
                out.extend(sorted(rest, key=lambda x: (self.chain(x), x.hash)))
                walk(source)

        walk(version)
        self.reached[version.hash] = out
        return out

    # QX-23 sections 2 and 3, the inherited square and what waits on it.

    def own(self, version, challenges=True):
        """Each piece's own state on a version, with no square inherited: its state on the line's record, or
        `locked` while an input of its own version is not done (CORE.md section 6, Per piece)."""
        line = version.line
        memo = {}

        def final(spec, stack):
            h = spec["hash"]
            if h in memo:
                return memo[h]
            if h in stack:
                return "locked"
            for inp in inputs_of(version, spec):
                if inp is None or final(inp, stack | {h}) not in DONE:
                    memo[h] = "locked"
                    return "locked"
            memo[h] = self.read.own_state(line, line.recs[h], challenges)
            return memo[h]

        return {spec["name"]: final(spec, frozenset()) for spec in version.specs}

    def square(self, version, piece):
        """The square in reach of a piece hash, as `{problem, state}`, or None. QX-23 section 2: "Of several
        squares in reach, the one named is the furthest along, a final one (`accepted`, `unreachable`,
        `recorded`) over `accepted_provisional` over `challenged`, and of equals the first in the order of
        section 1.\""""
        best, rank = None, 3
        for other in self.reach(version):
            spec = next((s for s in other.specs if s["hash"] == piece), None)
            if spec is None:
                continue
            state = self.states(other)[spec["name"]][0]
            if state not in SQUARES:
                continue
            r = 0 if state in DONE else 1 if state == "accepted_provisional" else 2
            if r < rank:
                best, rank = {"problem": other.hash, "state": state}, r
        return best

    def states(self, version):
        """Each piece's state on a version as the layer says it: `(state, own, inherited)`, where `own` is the
        piece's own state on the version and `inherited` the square named, or None."""
        if version.hash in self.settled:
            return self.settled[version.hash]
        if version.hash in self.working:
            return {name: (state, state, None) for name, state in self.own(version).items()}
        self.working.add(version.hash)
        line = version.line
        memo, squares = {}, {}

        def square(h):
            if h not in squares:
                squares[h] = self.square(version, h)
            return squares[h]

        def done(spec, stack):
            """QX-23 section 3: "A dependent's input counts as done where the input is `accepted`, `unreachable`
            or `recorded` on the fork, as before, or where it is done elsewhere and its own inputs on the fork
            are done.\""""
            state = final(spec, stack)[0]
            if state in DONE:
                return True
            if state == "locked":
                return False
            sq = square(spec["hash"])
            return sq is not None and sq["state"] in DONE

        def final(spec, stack):
            h = spec["hash"]
            if h in memo:
                return memo[h]
            if h in stack:
                return ("locked", "locked", None)
            for inp in inputs_of(version, spec):
                if inp is None or not done(inp, stack | {h}):
                    memo[h] = ("locked", "locked", None)
                    return memo[h]
            own = self.read.own_state(line, line.recs[h])
            sq = square(h) if own not in SQUARES else None
            memo[h] = ("inherited", own, sq) if sq is not None else (own, own, None)
            return memo[h]

        out = {spec["name"]: final(spec, frozenset()) for spec in version.specs}
        self.working.discard(version.hash)
        self.settled[version.hash] = out
        return out

    # QX-23 section 4, complete.

    def complete(self, version):
        """"A fork is complete, in the tracker's layer, where every piece is `accepted`, `unreachable` or
        `recorded`, or is `inherited` from a square that is one of those three.\""""
        states = self.states(version)
        if not version.specs:
            return False
        for spec in version.specs:
            state, _, sq = states[spec["name"]]
            if state not in DONE and not (sq is not None and sq["state"] in DONE):
                return False
        return True

    def own_complete(self, version):
        """The problem's own: every piece done on its own record, read with an open challenge left out
        (the fixture gold-1 says true of a problem whose one piece is `challenged`)."""
        states = self.own(version, challenges=False)
        return bool(version.specs) and all(states[s["name"]] in DONE for s in version.specs)
