"""The envelope (CORE.md section 2) and the piece hash (section 3).

    { "quilt": 1, "problem": { ... }, "hints": { ... }, "sig": "0x..." }

"The problem's hash, which is its name, is the hash of `problem` alone."
"A family expands to `count` pieces, `n` from 1. Each piece's id is
sha256(canonical({ family, n, brief, schema, verifier, agree, requires,
inputs, lease_h, workspace, check })) with `brief` the template after `{n}`
and the data slots are filled from the problem's data, and with absent
fields absent. Slots that render other pieces' accepted returns stay as
written. A single piece is a family of one with `n` 1."
"""

import json
import re

from .canonical import canonical
from .hashes import hash_json, hash_bytes
from .identity import signer_of, same_address
from .schema import schema_problems

REQUIRES = ("web", "files", "shell", "person")
CORE_VERIFIERS = ("check", "score", "agree")
HASH_FIELDS = ("family", "n", "brief", "schema", "verifier", "agree", "requires",
               "inputs", "lease_h", "workspace", "check")
SLOT = re.compile(r"\{([^{}]+)\}")  # a brief's slot: `{n}`, `{name.field}`, or `{entry}` for an input


class EnvelopeError(ValueError):
    """An envelope that is not valid under section 2."""


def problem_hash(envelope) -> str:
    return hash_json(envelope["problem"])


def family_name(key: str) -> str:
    """The family of a piece key: `cite/*` is the family `cite`; a single
    piece is a family of one under its own key.

    CORE.md does not say this; the fixtures' piece ids reproduce only with
    the `/*` removed (FINDINGS.md)."""
    return key[:-2] if key.endswith("/*") else key


def piece_name(key: str, n: int, is_family: bool) -> str:
    """The name a fixture gives an expanded piece: `cite/1` for the first of
    `cite/*`; a single piece keeps its key."""
    return "%s/%d" % (family_name(key), n) if is_family else key


def piece_hash(fields: dict) -> str:
    obj = {k: fields[k] for k in HASH_FIELDS if k in fields and fields[k] is not None}
    return hash_json(obj)


def _blob_json(blobs, h):
    data = blobs.get(h)
    if data is None:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def render_data_slots(template: str, spec: dict, problem: dict, blobs: dict, n: int) -> str:
    """Fill `{n}` and the data slots `{name.field}` of a brief. Other slots
    stay as written.

    CORE.md does not say how a blob is indexed by `n`; the fixtures' blob is
    a JSON array and piece `n` takes element `n - 1` (FINDINGS.md)."""
    data_names = spec.get("data") or {}

    def fill(m):
        slot = m.group(1)
        if slot == "n":
            return str(n)
        if "." in slot:
            name, field = slot.split(".", 1)
            if name in data_names:
                blob_hash = (problem.get("data") or {}).get(data_names[name])
                blob = _blob_json(blobs, blob_hash) if blob_hash else None
                row = None
                if isinstance(blob, list) and 1 <= n <= len(blob):
                    row = blob[n - 1]
                elif isinstance(blob, dict):
                    row = blob
                if isinstance(row, dict) and field in row:
                    v = row[field]
                    return v if isinstance(v, str) else canonical(v)
        return m.group(0)

    return SLOT.sub(fill, template)


def expand(envelope: dict, blobs: dict) -> list:
    """Every piece of an envelope in file order, each a dict with its `name`,
    `hash`, the hashed fields, `key` (the file key), `data` (the slot names)
    and `position` (its place in the file, from 0; the last tie-break of
    section 7)."""
    problem = envelope["problem"]
    out = []
    for key, spec in (problem.get("pieces") or {}).items():
        is_family = "count" in spec
        count = int(spec["count"]) if is_family else 1
        for n in range(1, count + 1):
            fields = {"family": family_name(key), "n": n}
            fields["brief"] = render_data_slots(spec.get("brief", ""), spec, problem, blobs, n)
            for f in ("schema", "verifier", "agree", "requires", "inputs", "lease_h", "workspace", "check"):
                if f in spec and spec[f] is not None:
                    fields[f] = spec[f]
            piece = dict(fields)
            piece["name"] = piece_name(key, n, is_family)
            piece["key"] = key
            piece["hash"] = piece_hash(fields)
            piece["data"] = spec.get("data") or {}
            piece["position"] = len(out)
            out.append(piece)
    return out


def validate_envelope(envelope: dict, blobs: dict) -> None:
    """Raise EnvelopeError unless the envelope is valid under section 2.
    `prev`'s owner is checked by the chain assembly, which holds both."""
    if not isinstance(envelope, dict) or envelope.get("quilt") != 1:
        raise EnvelopeError("not a quilt 1 envelope")
    problem = envelope.get("problem")
    if not isinstance(problem, dict):
        raise EnvelopeError("no problem")
    owner = problem.get("owner")
    if not same_address(signer_of(envelope), owner):
        raise EnvelopeError("the signature is not the owner's")
    settings = problem.get("settings") or {}
    for k in ("challenge_window_h", "lease_h", "endgame_at", "budget", "patch_max"):
        if not isinstance(settings.get(k), (int, float)) or isinstance(settings.get(k), bool):
            raise EnvelopeError("settings.%s missing" % k)
    pieces = problem.get("pieces")
    if not isinstance(pieces, dict) or not pieces:
        raise EnvelopeError("no pieces")
    total = 0
    for key, spec in pieces.items():
        if not isinstance(spec, dict):
            raise EnvelopeError("piece %s is not an object" % key)
        verifier = spec.get("verifier")
        if not isinstance(verifier, str):
            raise EnvelopeError("piece %s has no verifier" % key)
        if "count" in spec:
            if not isinstance(spec["count"], int) or spec["count"] < 1:
                raise EnvelopeError("piece %s has a bad count" % key)
        total += spec.get("count", 1)
        if verifier in ("check", "score"):
            ws, ck = spec.get("workspace"), spec.get("check")
            if not isinstance(ws, dict) or "repo" not in ws or "base" not in ws:
                raise EnvelopeError("piece %s has no workspace" % key)
            if not isinstance(ck, dict) or "file" not in ck:
                raise EnvelopeError("piece %s has no check" % key)
            if verifier == "score" and "better" in ck and ck["better"] not in ("higher", "lower"):
                raise EnvelopeError("piece %s: better is higher or lower" % key)
        else:
            problems = schema_problems(spec.get("schema"))
            if problems:
                raise EnvelopeError("piece %s: %s" % (key, "; ".join(problems)))
            agree = spec.get("agree")
            if agree is not None:
                if not isinstance(agree, list) or not all(a in spec["schema"]["properties"] for a in agree):
                    raise EnvelopeError("piece %s: agree names a field the schema lacks" % key)
        requires = spec.get("requires", [])
        if not isinstance(requires, list) or not all(r in REQUIRES for r in requires):
            raise EnvelopeError("piece %s: requires is not from %s" % (key, ", ".join(REQUIRES)))
        inputs = spec.get("inputs", [])
        if not isinstance(inputs, list) or not all(isinstance(i, str) for i in inputs):
            raise EnvelopeError("piece %s: inputs is not a list of names" % key)
        if "lease_h" in spec and (not isinstance(spec["lease_h"], (int, float)) or spec["lease_h"] <= 0):
            raise EnvelopeError("piece %s: lease_h is not hours" % key)
    if total > settings["budget"]:
        raise EnvelopeError("%d pieces exceed the budget of %d" % (total, settings["budget"]))
    for name, h in (problem.get("data") or {}).items():
        data = blobs.get(h)
        if data is None:
            raise EnvelopeError("blob %s (%s) is missing" % (name, h))
        if hash_bytes(data) != h:
            raise EnvelopeError("blob %s does not match its hash" % name)
