#!/usr/bin/env python3
"""Run every conformance fixture against the Python core.

    python3 impl/python/conform.py [fixtures-dir] [-v]

Prints PASS per fixture, or the first difference: which piece, the expected
state against the produced one; the expected pick against the produced one;
then the counts of dropped events, `complete` and the output hash. Ends with
a total and exits non-zero when any fixture differs.

A fixture is a JSON object with `envelopes`, `blobs` (hash -> base64),
`receipts`, `now` and `expect` (`states` by piece name, `dropped`,
`complete`, `output`, `picks`). This format is read from the fixtures
themselves; nothing I may read documents it (FINDINGS.md).
"""

import base64
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bitquilt  # noqa: E402


def default_fixtures_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "..", "packages", "core", "fixtures"))


def run_fixture(path, verbose=False):
    with open(path, "r", encoding="utf-8") as f:
        fx = json.load(f)
    blobs = {h: base64.b64decode(b) for h, b in (fx.get("blobs") or {}).items()}
    expect = fx.get("expect") or {}
    diffs = []
    try:
        state = bitquilt.reduce(fx["envelopes"], blobs, fx.get("receipts") or [], fx["now"])
    except Exception as e:  # an invalid envelope or a bug: both are differences
        return ["reduce raised %s: %s" % (type(e).__name__, e)]

    produced = state.states()
    for name, want in (expect.get("states") or {}).items():
        got = produced.get(name, "(no such piece)")
        if got != want:
            diffs.append("piece %s: expected %s, produced %s" % (name, want, got))
    for name in produced:
        if name not in (expect.get("states") or {}):
            diffs.append("piece %s: produced %s, not in the fixture" % (name, produced[name]))

    for pick in expect.get("picks") or []:
        got = bitquilt.next(state, pick["key"], pick["client"], pick["now"])
        got_name = got["piece"] if got else None
        if got_name != pick.get("piece"):
            diffs.append("pick for %s (%s, %s): expected %s, produced %s" % (
                pick["key"], pick["client"].get("model"), ",".join(pick["client"].get("can") or []),
                pick.get("piece"), got_name))

    if "dropped" in expect:
        want_n = len(expect["dropped"])
        got_n = len(state.dropped)
        if want_n != got_n:
            diffs.append("dropped: expected %d (%s), produced %d (%s)" % (
                want_n, "; ".join(expect["dropped"]), got_n, "; ".join(r for r, _ in state.dropped)))
    if "complete" in expect and bool(expect["complete"]) != bool(state.complete):
        diffs.append("complete: expected %s, produced %s" % (expect["complete"], state.complete))
    if "output" in expect and expect["output"] != state.output:
        diffs.append("output: expected %s, produced %s" % (expect["output"], state.output))

    if verbose:
        print("   states:", json.dumps(produced))
        print("   dropped:", [r for r, _ in state.dropped])
        if state.output_document is not None:
            print("   output:", bitquilt.canonical(state.output_document))
    return diffs


def main(argv):
    verbose = "-v" in argv
    args = [a for a in argv[1:] if a != "-v"]
    fixtures_dir = args[0] if args else default_fixtures_dir()
    paths = sorted(glob.glob(os.path.join(fixtures_dir, "*.json")))
    if not paths:
        print("no fixtures under %s" % fixtures_dir)
        return 2
    passed = 0
    for path in paths:
        name = os.path.splitext(os.path.basename(path))[0]
        diffs = run_fixture(path, verbose)
        if not diffs:
            passed += 1
            print("PASS  %s" % name)
        else:
            print("FAIL  %s" % name)
            for d in diffs:
                print("      %s" % d)
    print("%d of %d fixtures pass" % (passed, len(paths)))
    return 0 if passed == len(paths) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
