"""Canonical JSON as RFC 8785 (JSON Canonicalization Scheme) defines it.

CORE.md section 1: "Canonical JSON is RFC 8785. Where this document hashes or
signs JSON, it means the UTF-8 bytes of the canonical form."

RFC 8785 in short: object keys sorted by their UTF-16 code units, no
whitespace, strings escaped as ECMAScript's JSON.stringify escapes them,
numbers written as ECMAScript's Number.prototype.toString writes them, and
the result encoded as UTF-8. Standard library only.
"""

import math


def canonical(value) -> str:
    """The canonical form of a JSON value, as text."""
    parts = []
    _write(value, parts)
    return "".join(parts)


def canonical_bytes(value) -> bytes:
    """The UTF-8 bytes of the canonical form."""
    return canonical(value).encode("utf-8")


def _write(value, out):
    if value is None:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, str):
        out.append(_string(value))
    elif isinstance(value, int):
        out.append(_number(float(value)) if abs(value) >= 10**21 else str(value))
    elif isinstance(value, float):
        out.append(_number(value))
    elif isinstance(value, (list, tuple)):
        out.append("[")
        for i, item in enumerate(value):
            if i:
                out.append(",")
            _write(item, out)
        out.append("]")
    elif isinstance(value, dict):
        out.append("{")
        keys = sorted(value.keys(), key=lambda k: k.encode("utf-16-be"))
        for i, key in enumerate(keys):
            if i:
                out.append(",")
            out.append(_string(key))
            out.append(":")
            _write(value[key], out)
        out.append("}")
    else:
        raise TypeError("not a JSON value: %r" % (value,))


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


def _string(s: str) -> str:
    out = ['"']
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _number(x: float) -> str:
    """ECMAScript Number::toString for a finite double."""
    if math.isnan(x) or math.isinf(x):
        raise ValueError("not a JSON number: %r" % (x,))
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    x = abs(x)
    # repr gives the shortest digit string that round-trips; take its digits
    # and decimal exponent, then lay them out as ECMAScript does.
    r = repr(x)
    if "e" in r or "E" in r:
        mant, exp = r.lower().split("e")
        exp = int(exp)
    else:
        mant, exp = r, 0
    if "." in mant:
        whole, frac = mant.split(".")
    else:
        whole, frac = mant, ""
    digits = (whole + frac).lstrip("0")
    # n: position of the decimal point relative to the start of `digits`
    n = len(whole) + exp
    if whole.strip("0") == "":
        # e.g. 0.00012 -> digits "12", n = -(leading zeros of frac)
        stripped = frac.lstrip("0")
        n = -(len(frac) - len(stripped)) + exp
        digits = stripped
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = ("+" if e >= 0 else "-") + str(abs(e))
    if k == 1:
        return sign + digits + "e" + es
    return sign + digits[0] + "." + digits[1:] + "e" + es
