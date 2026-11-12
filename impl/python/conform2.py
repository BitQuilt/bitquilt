#!/usr/bin/env python3
"""Run every fixture of reading 2 against the Python read, READING.md section 11.

    python3 impl/python/conform2.py [fixture.json | fixtures-dir ...] [-v]

A fixture is one ledger with what the reference said of it at each of its times, `readings: [{now, expect}]`.
The read is asked for each time, and what it says is held to `expect` as JSON, key by key and place by place.
Prints PASS per fixture, or the first few places the read and the file are apart: the path into the JSON,
what the file expects and what the read produced. Ends with a total and exits non-zero when any fixture differs.
With -v every difference is printed, not the first few.
"""

import glob
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bitquilt.reading import read  # noqa: E402

SHOWN = 6


def default_fixtures_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "..", "packages", "core", "fixtures", "reading-2"))


def short(value, width=150):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= width else text[:width] + "..."


def apart(want, got, path, out):
    """Every place two JSON values are apart, as (path, expected, produced). A number is a number, so 1 and 1.0
    are the same, and a boolean is no number."""
    if isinstance(want, dict) and isinstance(got, dict):
        for k in want:
            if k not in got:
                out.append((path + "." + k, want[k], "(absent)"))
            else:
                apart(want[k], got[k], path + "." + k, out)
        for k in got:
            if k not in want:
                out.append((path + "." + k, "(absent)", got[k]))
        return
    if isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            out.append((path + ".length", len(want), len(got)))
        for i, (a, b) in enumerate(zip(want, got)):
            apart(a, b, "%s[%d]" % (path, i), out)
        return
    if isinstance(want, bool) or isinstance(got, bool):
        if want is not got:
            out.append((path, want, got))
        return
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        if want != got:
            out.append((path, want, got))
        return
    if want != got:
        out.append((path, want, got))


def unshared(expect):
    """The expected state with each piece's view in the place of its index, so a difference names the piece and
    not a place in `views`, and the order of `views` is held apart, by `views_order`."""
    out = {"refused": expect.get("refused"), "standing": expect.get("standing"), "problems": {}}
    for h, p in (expect.get("problems") or {}).items():
        q = {k: v for k, v in p.items() if k not in ("views", "pieces")}
        q["pieces"] = {name: p["views"][i] for name, i in p["pieces"].items()}
        q["views_order"] = p["pieces"]
        out["problems"][h] = q
    return out


def run_fixture(path, verbose=False):
    with open(path, "r", encoding="utf-8") as f:
        fx = json.load(f)
    diffs = []
    for i, reading in enumerate(fx.get("readings") or []):
        try:
            got = read(fx["ledger"], reading["now"])
        except Exception as e:  # a bug is a difference
            diffs.append(("readings[%d]" % i, "a state", "read raised %s: %s" % (type(e).__name__, e)))
            if verbose:
                traceback.print_exc()
            continue
        got = json.loads(json.dumps(got))
        apart(unshared(reading["expect"]), unshared(got), "readings[%d]" % i, diffs)
        if json.dumps(got) != json.dumps(reading["expect"]) and not diffs:
            diffs.append(("readings[%d]" % i, "the same order of keys", "another order"))
    return diffs


def gate_apart():
    """The gate's own fixture, which a reader of reading 2 holds since a proposal stands by it (QX-22 section 1):
    each case whose issue codes this gate says otherwise, and how many cases there are."""
    from bitquilt.gate import text_issues

    path = os.path.join(default_fixtures_dir(), "..", "gate", "cases.json")
    with open(path, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    said = [(c["text"], c["issues"], text_issues(c["text"])) for c in cases]
    return [s for s in said if s[1] != s[2]], len(cases)


def main(argv):
    verbose = "-v" in argv
    args = [a for a in argv if a != "-v"]
    paths = []
    for a in args or [default_fixtures_dir()]:
        if os.path.isdir(a):
            paths.extend(sorted(glob.glob(os.path.join(a, "*.json"))))
        elif os.path.exists(a):
            paths.append(a)
        else:
            paths.append(os.path.join(default_fixtures_dir(), a if a.endswith(".json") else a + ".json"))
    passed = 0
    for path in paths:
        name = os.path.basename(path)[:-5]
        diffs = run_fixture(path, verbose)
        if not diffs:
            passed += 1
            print("PASS  %s" % name)
            continue
        print("FAIL  %s  (%d places apart)" % (name, len(diffs)))
        for where, want, got in diffs if verbose else diffs[:SHOWN]:
            print("        %s" % where)
            print("            expected %s" % short(want))
            print("            produced %s" % short(got))
    apart, cases = gate_apart()
    if apart:
        print("FAIL  the gate  (%d of %d cases apart)" % (len(apart), cases))
        for text, want, got in apart if verbose else apart[:SHOWN]:
            print("        %s" % short(text))
            print("            expected %s" % short(want))
            print("            produced %s" % short(got))
    else:
        print("PASS  the gate  (%d cases)" % cases)
    print("%d of %d" % (passed, len(paths)))
    return 0 if passed == len(paths) and not apart else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
