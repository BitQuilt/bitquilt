"""Standing, the panels and the decisions: READING.md sections 5 to 7.

Section 5 gives a `judge:n` piece "the candidate a panel's majority ranks first" (verifiers.md section 2). Section
6 is standing, QX-1 section 2, "one credit for each reveal in a set, by the reveal's id", with the pool of QX-1
section 3, locked and free standing by QX-15 section 3, and a burn "credited on the door's word in its receipt's
wrapper". "Sections 5 and 6 are brought to a fixed point, since a panel is drawn by standing and a panel's
ranking makes a set."

Section 7 is "one pass in receipt order over the locks (QX-15 sections 1 to 3), the owner's gold and its reveals
(QX-16 sections 1 to 5), and the challenges and verdicts (QX-1 sections 1 and 4 to 6)". "A strike is one strike:
each root docked once, the set's events struck on the line's record, and every lock behind the set forfeited."

Standing is kept as a list of moves, each from its instant, "run in time order" and "never below zero". The
forms of a challenge, a panel, a lock and a gold as a fixture keeps them are the fixtures' own (FINDINGS-2.md).
"""

import hashlib

from .canonical import canonical
from .grounds import set_aside
from .kinds import kind_of, Set, agree, WHY_CHALLENGE, WHY_GOLD, WHY_RANKED, WHY_VOID, WHY_OWNER, WHY_ROOT, WHY_LATE
from .record import iso, word, entries_of
from .reducer import commit_hash
from .schema import validate_return
from .times import hours

PASS = ("stake_rule", "lock", "gold", "gold_reveal", "challenge", "verdict")
FINAL = ("held", "failed", "void")


def is_whole(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def is_hash(v):
    return isinstance(v, str) and len(v) == 71 and v.startswith("sha256:")


def draw(seed, roots):
    """QX-1 section 4: "The order is the pool sorted ascending by `sha256(canonical([seed, address]))`"."""
    def place(address):
        text = canonical([seed, address])
        return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()
    return sorted(roots, key=place)


def chain_hash(entry):
    """The `hash` of an event's chained receipt line, or None where its line carries none."""
    for line in entry["lines"]:
        if isinstance(line.get("hash"), str):
            return line["hash"]
    return None


class Seat:
    def __init__(self, root, offered):
        self.root = root
        self.offered = offered
        self.lapsed = None
        self.answer = None


class Board:
    """The seats of a panel, QX-1 section 5: the first `n` of the order are offered a seat at once; a seat
    "whose holder has given no verdict `lease_h` hours after it was offered" lapses, "and at that moment a seat
    is offered to the next root in the order not yet offered one"."""

    def __init__(self, order, n, at, lease):
        self.order = order
        self.lease = lease
        self.seats = []
        self.taken = 0
        for _ in range(n):
            self.offer(at)

    def offer(self, at):
        if self.taken < len(self.order):
            self.seats.append(Seat(self.order[self.taken], at))
            self.taken += 1

    def advance(self, t):
        """Every lapse at or before `t`, in time order, each offering the next seat."""
        while True:
            due = [s for s in self.seats if s.answer is None and s.lapsed is None and s.offered + self.lease <= t]
            if not due:
                return
            seat = min(due, key=lambda s: s.offered)
            seat.lapsed = seat.offered + self.lease
            self.offer(seat.lapsed)

    def live(self, root):
        for s in self.seats:
            if s.root == root and s.answer is None and s.lapsed is None:
                return s
        return None

    def spent(self):
        return all(s.answer is not None or s.lapsed is not None for s in self.seats)

    def last_lapse(self):
        lapses = [s.lapsed for s in self.seats if s.lapsed is not None]
        return max(lapses) if lapses else None

    def said(self, word_):
        return [{"root": s.root, "offeredAt": iso(s.offered), "lapsedAt": iso(s.lapsed), word_: s.answer}
                for s in self.seats]


class Thing:
    """A kept lock, gold, commitment, challenge or panel: a bag of what the fold knows of it."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


class Decisions:
    def __init__(self, read):
        self.read = read
        self.led = read.led
        self.now = read.now
        self.moves = []         # (time, order, root, delta)
        self.credited = {}      # reveal id -> Thing(root, at, line)
        self.known = None       # the credits of the pass before, while the panels are brought to a fixed point
        self.returned = set()   # the ids of the reveals a held challenge against the gold brought back
        self.panels = {}        # (line name, piece hash) -> the panel
        self.rules = {}         # problem hash -> [Thing(at, min, pieces)], a rule being its own version's
        self.locks = []
        self.golds = []
        self.gold_on = {}       # (line name, piece hash) -> the commitment revealed on the piece
        self.challenges = []

    # Standing, section 6.

    def final(self, line, root):
        return line.identity.final(root)

    def move(self, at, line, root, delta):
        self.moves.append((at, len(self.moves), self.final(line, root), delta))

    def standing_at(self, root, t):
        n = 1 + int(self.led.founding.get(root, 0))
        for at, _, r, delta in sorted(self.moves, key=lambda m: (m[0], m[1])):
            if r == root and at <= t:
                n = max(0, n + delta)
        return n

    def locked_at(self, root, t):
        n = 0
        for lock in self.locks:
            if lock.kind == "standing" and self.final(lock.line, lock.root) == root and self.lock_live(lock, t):
                n += lock.amount
        for g in self.golds:
            if self.final(g.line, g.root) == root and self.gold_locked(g, t):
                n += g.stake
        return n

    def free_at(self, line, root, t):
        root = self.final(line, root)
        return max(0, self.standing_at(root, t) - self.locked_at(root, t))

    def sync(self, line, rec, when=None):
        """One credit for each reveal in a set that stands, from the set's completion; an attest set earns
        none (verifiers.md section 2)."""
        s = rec.set
        if s is None or kind_of(rec.verifier)[0] == "attest":
            return
        for m in s.members:
            if m.id not in self.credited:
                self.credited[m.id] = Thing(root=m.root, at=s.at, line=line)
                self.move(s.at if when is None else max(when, s.at), line, m.root, 1)

    def refresh(self, line, rec, when=None):
        """Sections 4 and 5 over one piece's record as it stands."""
        rec.aside = set_aside(line, rec)
        self.read.set_of(line, rec)
        self.sync(line, rec, when)

    def window_end(self, line, s):
        return s.at + hours(line.by_hash[s.version].settings["challenge_window_h"])

    def pool(self, line, rec, t, out):
        """QX-1 section 3: every root with a reveal in a set completed at or before `t` on another line, not
        struck, unrelated to each root of `out`, with no reveal and no run on the piece from a related root."""
        ident = line.identity
        roots = []
        for id_, c in (self.credited if self.known is None else self.known).items():
            # "The set not struck at or before `t`": a set the gold struck stays out though a held challenge
            # returned it, as the fixture gold-1 draws no seat for a root whose one set was struck and returned.
            if id_ in self.returned:
                continue
            if c.line is not line and c.at <= t and c.root not in roots:
                roots.append(c.root)
        keep = []
        for r in roots:
            if any(ident.related(r, o, t) for o in out):
                continue
            if any(ident.related(r, x.root, t) for x in rec.readings):
                continue
            if any(ident.related(r, x.get("root"), t) for x in rec.runs if x.get("root")):
                continue
            keep.append(r)
        return keep

    # The fold.

    def run(self):
        lines = list(self.led.lines.values())
        judged = [(line, rec) for line in lines for rec in line.recs.values() if kind_of(rec.verifier)[0] == "judge"]
        last = None
        for _ in range(6):
            # A panel is drawn over the credits of the pass before, so the first pass draws none.
            self.known, self.moves, self.credited = self.credited, [], {}
            for line in lines:
                for rec in line.recs.values():
                    self.refresh(line, rec)
            said = sorted((k, p.outcome, p.decided, tuple(p.order)) for k, p in self.panels.items())
            if not judged or (said == last and set(self.known) == set(self.credited)):
                break
            last = said
        self.known = None
        self.burns()
        events = []
        for line in lines:
            for entry in line.ext:
                if entry["event"].get("type") in PASS:
                    events.append((entry["at"], entry["id"], line, entry))
        events.sort(key=lambda e: (e[0], e[1]))
        for at, _, line, entry in events:
            self.advance(at)
            getattr(self, "on_" + entry["event"]["type"])(line, entry)
        self.advance(self.now)

    def burns(self):
        """QX-17 section 4: "the tracker credits `floor(amount / rate)` standing to the root from the receipt",
        read as the door's word on the receipt, `stake: { kind: "burn", standing }`."""
        if not self.led.coin:
            return
        lines = list(self.led.lines.values())
        for entry in entries_of([self.led.coin]):
            ev = entry["event"]
            said = word(entry, "stake")
            if ev.get("type") != "burn" or not isinstance(said, dict) or said.get("kind") != "burn":
                continue
            if not is_whole(said.get("standing")) or entry["at"] is None:
                continue
            root = lines[0].identity.root_of(ev.get("key"), entry["at"]) if lines else ev.get("key")
            self.moves.append((entry["at"], len(self.moves), root, said["standing"]))

    def advance(self, t):
        """The seats that lapsed by `t`, and each challenge whose order ran out with them."""
        for c in self.challenges:
            if c.outcome == "open" and c.board is not None:
                c.board.advance(t)
                if c.board.spent():
                    c.outcome, c.decided = "void", c.board.last_lapse() or t

    # Judge panels, verifiers.md section 2.

    def judge(self, line, rec, n):
        """The panel of a `judge:n` piece and the set it made, or None. Says how each reading counts."""
        ident = line.identity
        counts = rec.counts
        key = (line.name, rec.hash)
        self.panels.pop(key, None)
        wanted = rec.spec.get("candidates")
        wanted = wanted if is_whole(wanted) and wanted >= 1 else 2
        cands, rest = [], []
        for r in rec.live():
            if ident.related(r.root, line.owner, r.at):
                counts[r.id] = ("kept", WHY_OWNER)
            elif len(cands) >= wanted:
                counts[r.id] = ("kept", WHY_LATE)
            elif any(ident.related(c.root, r.root, r.at) for c in cands):
                counts[r.id] = ("kept", WHY_ROOT)
            elif any(c.digest == r.digest for c in cands):
                counts[r.id] = ("kept", WHY_LATE)
                rest.append(r)
            else:
                counts[r.id] = ("counted", None)
                cands.append(r)
        if len(cands) < wanted:
            return None
        last = cands[-1]
        t = last.at
        out = [line.owner]
        pool = self.pool(line, rec, t, out)
        seed = chain_hash(cands[0].entry)
        version = line.by_hash[last.problem]
        lease = rec.spec.get("lease_h")
        lease = hours(lease if isinstance(lease, (int, float)) and not isinstance(lease, bool) else version.settings["lease_h"])
        p = Thing(rec=rec, n=n, majority=n // 2 + 1, wanted=wanted, cands=cands, seed=seed, at=t, at_text=last.at_text,
                  order=draw(seed, pool) if seed is not None else [], board=None, outcome="open", winner=None,
                  decided=None, decided_text=None)
        self.panels[key] = p
        if seed is None:
            return None
        if len(pool) < n:
            p.outcome, p.decided, p.decided_text = "void", t, last.at_text
            for c in cands:
                counts[c.id] = ("kept", WHY_VOID)
            return None
        p.board = Board(p.order, n, t, lease)
        digests = [c.digest for c in cands]
        firsts = {}
        made = None
        for entry in line.ext:
            ev = entry["event"]
            if ev.get("type") != "rank" or ev.get("piece") != rec.hash or entry["at"] < t:
                continue
            p.board.advance(entry["at"])
            if p.board.spent():
                break
            seat = p.board.live(entry["root"])
            ranking = ev["body"].get("ranking")
            if seat is None or not isinstance(ranking, list) or sorted(map(str, ranking)) != sorted(digests):
                continue
            seat.answer = {"id": entry["id"], "key": ev["key"], "root": entry["root"], "at": entry["at_text"],
                           "ranking": ranking}
            firsts[ranking[0]] = firsts.get(ranking[0], 0) + 1
            if firsts[ranking[0]] >= p.majority:
                made = entry
                p.winner = ranking[0]
                break
        if made is None:
            p.board.advance(self.now)
            if p.board.spent():
                p.outcome = "void"
                p.decided = p.board.last_lapse() or t
                p.decided_text = iso(p.decided)
                for c in cands:
                    counts[c.id] = ("kept", WHY_VOID)
            return None
        p.outcome, p.decided, p.decided_text = "decided", made["at"], made["at_text"]
        winner = next(c for c in cands if c.digest == p.winner)
        for c in cands:
            counts[c.id] = ("counted", None) if c is winner else ("kept", WHY_RANKED)
        return Set(members=[winner], at=made["at"], at_text=made["at_text"], version=made["event"]["problem"])

    def panel_said(self, p, name):
        return {
            "piece": p.rec.hash, "name": name, "panel": p.n, "majority": p.majority, "wanted": p.wanted,
            "candidates": [{"digest": c.digest, "key": c.key, "root": c.root, "at": c.at_text, "return": c.ret}
                           for c in p.cands],
            "seed": p.seed, "completedAt": p.at_text, "order": p.order,
            "seats": p.board.said("rank") if p.board is not None else [],
            "outcome": p.outcome, "winner": p.winner, "decidedAt": p.decided_text, "dropped": [],
        }

    # Stake, QX-15.

    def rule_at(self, version, t):
        rules = [r for r in self.rules.get(version.hash, []) if r.at <= t]
        return rules[-1] if rules else None

    def stake_of(self, version, spec, t):
        """QX-15 section 1: "the rule's `min` when the rule covers the piece and 0 otherwise"."""
        rule = self.rule_at(version, t)
        if rule is None:
            return 0
        if rule.pieces is None or spec.get("name") in rule.pieces or spec.get("key") in rule.pieces:
            return rule.min
        return 0

    def on_stake_rule(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        version = entry["version"]
        pieces = body.get("pieces")
        if not is_whole(body.get("min")) or self.final(line, entry["root"]) != self.final(line, line.owner):
            return
        if pieces is not None:
            names = {s["name"] for s in version.specs} | {s.get("key") for s in version.specs}
            if not isinstance(pieces, list) or any(p not in names for p in pieces):
                return
        self.rules.setdefault(version.hash, []).append(Thing(at=entry["at"], min=body["min"], pieces=pieces))

    def production(self, rec, line, root):
        """A root's production on a piece (QX-15 section 2): its claims, commits and reveals there, by time."""
        same = lambda r: self.final(line, r) == self.final(line, root)
        return ([c for c in rec.claims if same(c.root)], [c for c in rec.commits if same(c.root)],
                [r for r in rec.readings if same(r.root)])

    def release_of(self, lock):
        """When a lock is released (QX-15 section 3), or None while it is not."""
        line, rec = lock.line, lock.rec
        claims, commits, reveals = self.production(rec, line, lock.root)
        runs = [x for x in rec.runs if x.get("root") and self.final(line, x["root"]) == self.final(line, lock.root)]
        first = lock.at + lock.lease
        made = [x.at for x in claims + commits + reveals] + [x["at"] for x in runs]
        if not any(at <= first for at in made):
            return first
        ends = []
        s = rec.set
        if s is not None:
            end = self.window_end(line, s)
            open_ = [c for c in self.challenges if c.rec is rec and c.line is line and c.against == "acceptance"]
            if any(c.outcome == "open" for c in open_):
                end = None
            else:
                for c in open_:
                    if c.decided is not None:
                        end = max(end, c.decided)
            if end is not None:
                ends.append(end)
        if not reveals and not runs:
            if any(c.revealed is None for c in commits):
                ends.append(max(c.at + 2 * c.lease for c in commits if c.revealed is None))
            elif not commits and claims:
                ends.append(max(c.at + c.lease for c in claims))
        return max(lock.at, min(ends)) if ends else None

    def lock_live(self, lock, t):
        if t < lock.at:
            return False
        if lock.forfeited is not None and lock.forfeited <= t and (lock.restored is None or lock.restored > t):
            return False
        end = self.release_of(lock)
        return end is None or t < end

    def on_lock(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        version, t, root = entry["version"], entry["at"], entry["root"]
        rec = line.recs.get(ev.get("piece"))
        spec = next((s for s in version.specs if s["hash"] == ev.get("piece")), None)
        if rec is None or spec is None:
            return
        asked = self.stake_of(version, spec, t)
        amount = body.get("amount")
        if asked <= 0 or not is_whole(amount) or amount < 1 or amount < asked:
            return
        mine = [k for k in self.locks if k.line is line and k.rec is rec
                and self.final(line, k.root) == self.final(line, root)]
        if any(self.lock_live(k, t) for k in mine):
            return
        coin = None
        if body.get("kind") == "standing":
            if self.free_at(line, root, t) < amount:
                return
        elif body.get("kind") == "coin":
            said = word(entry, "stake")
            if not isinstance(said, dict) or said.get("kind") != "coin" or said.get("id") != body.get("id"):
                return
            coin = body.get("id")
        else:
            return
        lease = spec.get("lease_h")
        lease = hours(lease if isinstance(lease, (int, float)) and not isinstance(lease, bool) else version.settings["lease_h"])
        self.locks.append(Thing(id=entry["id"], line=line, rec=rec, version=version.hash, name=spec["name"],
                                key=ev["key"], root=root, at=t, at_text=entry["at_text"], kind=body["kind"],
                                amount=amount, coin=coin, lease=lease, forfeited=None, restored=None, by=None))

    def lock_said(self, k):
        return {"id": k.id, "problem": k.version, "piece": k.rec.hash, "name": k.name, "key": k.key, "root": k.root,
                "at": k.at_text, "kind": k.kind, "amount": k.amount, "coinId": k.coin,
                "forfeitedAt": iso(k.forfeited), "restoredAt": iso(k.restored)}

    # The strike, QX-1 section 6, and its undoing, QX-16 section 4.

    def strike(self, line, rec, s, t, why, by, asof=None):
        """"The set's events, the two reveals with their commits", are struck: left out of the fold. Each
        credited root "loses one and its point for the set", and its lock on the piece is forfeited."""
        ids, roots = [], []
        live = [k for k in self.locks if k.line is line and k.rec is rec and self.lock_live(k, t if asof is None else asof)]
        docked = []
        for m in s.members:
            rec.struck[m.id] = (why, by)
            ids.append(m.id)
            if m.commit is not None:
                ids.append(m.commit.id)
            roots.append(m.root)
            if self.credited.pop(m.id, None) is not None:
                self.move(t, line, m.root, -1)
                self.move(t, line, m.root, -1)
                docked.append(m.id)
        forfeits = []
        for k in live:
            if any(self.final(line, k.root) == self.final(line, r) for r in roots):
                k.forfeited, k.restored, k.by = t, None, by
                forfeits.append(k)
                if k.kind == "standing":
                    self.move(t, line, k.root, -k.amount)
        self.refresh(line, rec)
        return ids, roots, docked, forfeits

    def undo(self, line, rec, c, t):
        """QX-16 section 4, held: "the strike is undone from the decision: the events return, each struck root
        regains the point docked, its set point and its lock"."""
        for m in c.set.members:
            rec.struck.pop(m.id, None)
            self.returned.add(m.id)
            if m.id in c.docked:
                self.move(t, line, m.root, 1)
        for k in c.forfeits:
            k.restored = t
            if k.kind == "standing":
                self.move(t, line, k.root, k.amount)
        self.refresh(line, rec, when=t)

    # The owner's gold, QX-16.

    def share(self, line, version, t):
        """QX-16 section 1: the problem's share is the largest, over its pieces with agreed fields, of what a
        strike of the piece's set would cost its roots."""
        best = 0
        for spec in version.specs:
            rec = line.recs[spec["hash"]]
            kind = kind_of(rec.verifier)[0]
            if kind not in ("agree", "human", "judge", "attest") or not rec.agree_fields():
                continue
            per = self.stake_of(version, spec, t) or 1
            best = max(best, per * (1 if kind == "attest" else 2))
        return best

    def on_gold(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        version, t, root = entry["version"], entry["at"], entry["root"]
        hs, stake = body.get("commitments"), body.get("stake")
        if self.final(line, root) != self.final(line, line.owner):
            return
        if not isinstance(hs, list) or not hs or any(not is_hash(h) for h in hs) or len(set(hs)) != len(hs):
            return
        if any(c.h in hs for g in self.golds if g.line is line for c in g.commitments):
            return
        if not is_whole(stake) or stake < len(hs) * self.share(line, version, t):
            return
        if self.free_at(line, root, t) < stake:
            return
        g = Thing(id=entry["id"], line=line, version=version, key=ev["key"], root=root, at=t, at_text=entry["at_text"],
                  stake=stake, forfeited=None, commitments=[])
        g.commitments = [Thing(h=h, gold=g, rec=None, name=None, outcome="pending", revealed=None, projection=None,
                               struck=[], roots=[], set=None, window=None, docked=[], forfeits=[]) for h in hs]
        self.golds.append(g)

    def on_gold_reveal(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        version, t, root = entry["version"], entry["at"], entry["root"]
        rec = line.recs.get(ev.get("piece"))
        spec = next((s for s in version.specs if s["hash"] == ev.get("piece")), None)
        projection, nonce = body.get("projection"), body.get("nonce")
        if rec is None or spec is None or not isinstance(projection, dict) or not isinstance(nonce, str):
            return
        if self.final(line, root) != self.final(line, line.owner) or (line.name, rec.hash) in self.gold_on:
            return
        h = commit_hash({"piece": rec.hash, "projection": projection}, nonce)
        c = next((c for g in self.golds if g.line is line and g.forfeited is None for c in g.commitments
                  if c.h == h and c.outcome == "pending"), None)
        if c is None or not rec.agree_fields():
            return
        g = c.gold
        before = [x.at for x in rec.claims + rec.commits + rec.readings] + [x["at"] for x in rec.runs]
        if any(at < g.at for at in before):
            return
        s = rec.set
        if s is None or s.at > t or t >= self.window_end(line, s):
            return
        c.rec, c.name, c.revealed, c.projection, c.set = rec, spec["name"], entry["at_text"], projection, s
        c.id = entry["id"]
        self.gold_on[(line.name, rec.hash)] = c
        if all(agree(rec, projection, m.ret) for m in s.members):
            c.outcome = "match"
            return
        c.outcome = "miss"
        c.window = t + hours(version.settings["challenge_window_h"])
        c.struck, c.roots, c.docked, c.forfeits = self.strike(line, rec, s, t, WHY_GOLD, entry["id"])

    def settled(self, version):
        """When a problem settled, "complete with every window closed" (QX-16 section 3), or None."""
        line = version.line
        ends = []
        for spec in version.specs:
            rec = line.recs[spec["hash"]]
            kind, n = kind_of(rec.verifier)
            if rec.set is not None:
                ends.append(self.window_end(line, rec.set))
            elif kind == "record" and len(rec.standing) >= n:
                ends.append(rec.standing[n - 1].at)
            else:
                return None
        return max(ends) if ends else None

    def final_time(self, g, c):
        """When a commitment is final (QX-16 section 5), or None while it is not."""
        if c.outcome == "match":
            return self.window_end(g.line, c.set)
        if c.outcome == "miss":
            made = [x for x in self.challenges if x.against == "gold" and x.miss is c]
            if any(x.outcome == "open" for x in made):
                return None
            return max(x.decided for x in made) if made else c.window
        if c.outcome in ("overruled", "dropped"):
            return g.forfeited
        return self.settled(g.version)

    def gold_locked(self, g, t):
        if t < g.at or (g.forfeited is not None and g.forfeited <= t):
            return False
        for c in g.commitments:
            end = self.final_time(g, c)
            if end is None or end > t:
                return True
        return False

    def lapsed(self, g, c):
        end = self.settled(g.version)
        return c.outcome == "pending" and g.forfeited is None and end is not None and end <= self.now

    def gold_said(self, g):
        return {"id": g.id, "problem": g.version.hash, "key": g.key, "root": g.root, "at": g.at_text, "stake": g.stake,
                "commitments": [{"h": c.h, "piece": c.rec.hash if c.rec else None, "name": c.name,
                                 "outcome": c.outcome, "revealedAt": c.revealed, "projection": c.projection,
                                 "struck": c.struck, "struckRoots": c.roots} for c in g.commitments],
                "forfeitedAt": iso(g.forfeited)}

    # Challenges and verdicts, QX-1.

    def on_challenge(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        version, t, root = entry["version"], entry["at"], entry["root"]
        rec = line.recs.get(ev.get("piece"))
        stake, ground = body.get("stake"), body.get("ground")
        if rec is None or not is_whole(stake) or not isinstance(ground, str) or len(ground) > 200:
            return
        if any(c.outcome in ("open", "held") for c in self.challenges if c.line is line and c.rec is rec):
            return
        ident = line.identity
        miss = self.gold_on.get((line.name, rec.hash))
        if miss is not None and miss.outcome == "miss":
            if t >= miss.window or not any(self.final(line, r) == self.final(line, root) for r in miss.roots):
                return
            against, parties, s = "gold", [line.owner], None
            out = [root, line.owner] + miss.roots
        else:
            s, miss = rec.set, None
            if s is None or s.at > t or t >= self.window_end(line, s) or stake < 1:
                return
            against = "acceptance"
            parties = [m.root for m in s.members] + [line.owner]
            if any(ident.related(root, p, t) for p in parties):
                return
            out = [root] + parties
        if stake > self.free_at(line, root, t):
            return
        seed = chain_hash(entry)
        pool = self.pool(line, rec, t, out)
        c = Thing(id=entry["id"], line=line, rec=rec, version=version, key=ev["key"], root=root, at=t,
                  at_text=entry["at_text"], stake=stake, ground=ground, against=against, parties=parties, seed=seed,
                  order=draw(seed, pool) if seed is not None else [], board=None, outcome="open", decided=None,
                  struck=[], set=s, miss=miss)
        self.challenges.append(c)
        if seed is None:
            return
        if len(pool) < 3:
            c.outcome, c.decided = "void", t
            return
        c.board = Board(c.order, 3, t, hours(version.settings["lease_h"]))

    def on_verdict(self, line, entry):
        ev, body = entry["event"], entry["event"]["body"]
        t, root = entry["at"], entry["root"]
        c = next((c for c in self.challenges if c.id == body.get("challenge") and c.line is line
                  and c.rec.hash == ev.get("piece") and c.outcome == "open" and c.board is not None), None)
        if c is None or body.get("for") not in ("challenger", "author"):
            return
        seat = c.board.live(root)
        if seat is None:
            return
        ret = body.get("return")
        if ret is not None:
            if c.rec.verifier in ("check", "score") or validate_return(ret, c.rec.spec.get("schema") or {}):
                return
        seat.answer = {"id": entry["id"], "key": ev["key"], "root": root, "at": entry["at_text"], "for": body["for"],
                       "return": ret}
        said = [s.answer["for"] for s in c.board.seats if s.answer is not None]
        if said.count("challenger") >= 2:
            c.outcome, c.decided = "held", t
            self.move(t, line, c.root, c.stake)
            if c.against == "acceptance":
                c.struck = self.strike(line, c.rec, c.set, t, WHY_CHALLENGE, c.id, asof=c.at)[0]
            else:
                self.overrule(line, c, t)
        elif said.count("author") >= 2:
            c.outcome, c.decided = "failed", t
            self.move(t, line, c.root, -c.stake)
        elif c.board.spent():
            c.outcome, c.decided = "void", c.board.last_lapse() or t

    def overrule(self, line, c, t):
        """QX-16 section 4, held: the strike undone, "the gold's whole stake forfeited from the owner", "the
        gold's unrevealed commitments dropped", the piece's gold `overruled`."""
        miss = c.miss
        g = miss.gold
        self.undo(line, c.rec, miss, t)
        miss.outcome = "overruled"
        g.forfeited = t
        self.move(t, line, g.root, -g.stake)
        for other in g.commitments:
            if other.outcome == "pending":
                other.outcome = "dropped"

    def challenge_said(self, c):
        return {"id": c.id, "problem": c.version.hash, "piece": c.rec.hash, "key": c.key, "root": c.root,
                "at": c.at_text, "stake": c.stake, "ground": c.ground, "against": c.against, "parties": c.parties,
                "seed": c.seed, "order": c.order, "seats": c.board.said("verdict") if c.board is not None else [],
                "outcome": c.outcome, "decidedAt": iso(c.decided), "struck": c.struck, "dropped": []}

    # What the views read.

    def open_on(self, line, rec):
        return next((c for c in self.challenges if c.line is line and c.rec is rec and c.outcome == "open"), None)

    def last_on(self, line, rec):
        made = [c for c in self.challenges if c.line is line and c.rec is rec]
        return made[-1] if made else None

    def gold_of(self, version, rec):
        """The owner's gold on a piece, said at the version its gold names (across-1, carried-12)."""
        c = self.gold_on.get((version.line.name, rec.hash))
        return c.outcome if c is not None and c.gold.version is version else None

    def gold_counts(self, golds):
        cs = [(g, c) for g in golds for c in g.commitments]
        lapsed = [c for g, c in cs if self.lapsed(g, c)]
        return {"committed": sum(1 for g, c in cs if c.outcome != "dropped"),
                "pending": sum(1 for g, c in cs if c.outcome == "pending" and c not in lapsed),
                "verified": sum(1 for g, c in cs if c.outcome == "match"),
                "missed": sum(1 for g, c in cs if c.outcome == "miss"),
                "overruled": sum(1 for g, c in cs if c.outcome == "overruled"),
                "lapsed": len(lapsed)}
