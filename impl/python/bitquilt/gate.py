"""The plain-text gate, gate/2: CORE.md sections 11 and 12, held by QX-22 section 1 as part of what stands.

CORE.md section 11: "nothing invisible, no links or markup outside typed fields, no contact details, nothing
addressed to a machine, no shouting. ... Its reference implementation is `gate/1` in the reference library,
identified by the hash of its source and shipped with its own fixtures of inputs and issue codes", and section 12
makes it `gate/2`. QX-22 section 1: "A reader passes over a proposal whose brief or reason the gate refuses. So a
reader of reading 2 holds the gate".

The documents name the gate by its source and say no more of its patterns than the sentence above and the rule
for a telephone number in section 12. So this file is the one file here written beside the reference's source,
`packages/core/src/gate.ts`, pattern for pattern, and imports nothing from it. `conform2.py` holds it to the gate's
own fixture, `packages/core/fixtures/gate/cases.json`. Three things are this language's and not the gate's
(FINDINGS-2.md):

- The standard library names no script and no pictograph, so a letter of a script written with joiners is known by
  the first word of its character name, and a pictograph by ranges written out here.
- An unassigned code point is one this Python's Unicode tables leave unassigned.
- The patterns are asked of the text with every line break written as a line feed and the Ogham space as a space,
  so that a space, a line's start and a character that is no line break mean here what they mean to the reference.
"""

import re
import unicodedata

GATE_VERSION = "gate/2"

ZWNJ, ZWJ, VS16 = "‌", "‍", "️"
JOINED = (
    "ARABIC",
    "DEVANAGARI",
    "BENGALI",
    "GURMUKHI",
    "GUJARATI",
    "ORIYA",
    "TAMIL",
    "TELUGU",
    "KANNADA",
    "MALAYALAM",
    "SINHALA",
)
PICTOGRAPHS = (
    (0xA9, 0xA9), (0xAE, 0xAE), (0x203C, 0x203C), (0x2049, 0x2049), (0x2122, 0x2122), (0x2139, 0x2139),
    (0x2194, 0x2199), (0x21A9, 0x21AA), (0x231A, 0x231B), (0x2328, 0x2328), (0x2388, 0x2388), (0x23CF, 0x23CF),
    (0x23E9, 0x23F3), (0x23F8, 0x23FA), (0x24C2, 0x24C2), (0x25AA, 0x25AB), (0x25B6, 0x25B6), (0x25C0, 0x25C0),
    (0x25FB, 0x25FE), (0x2600, 0x2605), (0x2607, 0x2612), (0x2614, 0x2685), (0x2690, 0x2705), (0x2708, 0x2712),
    (0x2714, 0x2714), (0x2716, 0x2716), (0x271D, 0x271D), (0x2721, 0x2721), (0x2728, 0x2728), (0x2733, 0x2734),
    (0x2744, 0x2744), (0x2747, 0x2747), (0x274C, 0x274C), (0x274E, 0x274E), (0x2753, 0x2755), (0x2757, 0x2757),
    (0x2763, 0x2767), (0x2795, 0x2797), (0x27A1, 0x27A1), (0x27B0, 0x27B0), (0x27BF, 0x27BF), (0x2934, 0x2935),
    (0x2B05, 0x2B07), (0x2B1B, 0x2B1C), (0x2B50, 0x2B50), (0x2B55, 0x2B55), (0x3030, 0x3030), (0x303D, 0x303D),
    (0x3297, 0x3297), (0x3299, 0x3299), (0x1F000, 0x1F0FF), (0x1F10D, 0x1F10F), (0x1F12F, 0x1F12F),
    (0x1F16C, 0x1F171), (0x1F17E, 0x1F17F), (0x1F18E, 0x1F18E), (0x1F191, 0x1F19A), (0x1F1AD, 0x1F1E5),
    (0x1F201, 0x1F20F), (0x1F21A, 0x1F21A), (0x1F22F, 0x1F22F), (0x1F232, 0x1F23A), (0x1F23C, 0x1F23F),
    (0x1F249, 0x1F3FA), (0x1F400, 0x1F53D), (0x1F546, 0x1F64F), (0x1F680, 0x1F6FF), (0x1F774, 0x1F77F),
    (0x1F7D5, 0x1F7FF), (0x1F80C, 0x1F80F), (0x1F848, 0x1F84F), (0x1F85A, 0x1F85F), (0x1F888, 0x1F88F),
    (0x1F8AE, 0x1F8FF), (0x1F90C, 0x1F93A), (0x1F93C, 0x1F945), (0x1F947, 0x1FAFF), (0x1FC00, 0x1FFFD),
)  # fmt: skip


def pictograph(ch):
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in PICTOGRAPHS)


def joined_letter(ch):
    word = unicodedata.name(ch, "").replace("-", " ").split(" ")[0]
    return word in JOINED


def unseen(ch):
    """What a reader cannot see: "zero-width and direction marks, tag characters, private-use and unassigned code
    points, variation selectors and controls", the tab, the line feed and the carriage return kept."""
    cp = ord(ch)
    if unicodedata.category(ch) in ("Cf", "Co", "Cn", "Cs"):
        return True
    if cp <= 0x08 or cp in (0x0B, 0x0C) or 0x0E <= cp <= 0x1F or 0x7F <= cp <= 0x9F:
        return True
    return 0xFE00 <= cp <= 0xFE0F or 0xE0100 <= cp <= 0xE01EF


def joins(s, at):
    """The one exception: "a single joiner between two letters of a script written with joiners, or between two
    emoji", and between two emoji the zero-width joiner alone."""
    ch = s[at]
    if ch not in (ZWNJ, ZWJ) or at == 0 or at + 1 >= len(s):
        return False
    b, a = s[at - 1], s[at + 1]
    if b == VS16 and at >= 2 and pictograph(s[at - 2]):
        b = s[at - 2]
    before = "emoji" if pictograph(b) else "letter" if joined_letter(b) else None
    after = "emoji" if pictograph(a) else "letter" if joined_letter(a) else None
    if before is None or after is None or before != after:
        return False
    return ch == ZWJ if before == "emoji" else True


def visible(raw):
    """The text as a reader sees it: NFKC, with everything invisible removed but a joiner doing its work."""
    s = unicodedata.normalize("NFKC", raw)
    return "".join(ch for i, ch in enumerate(s) if not unseen(ch) or joins(s, i))


A, I, M = re.ASCII, re.ASCII | re.IGNORECASE, re.ASCII | re.IGNORECASE | re.MULTILINE

LINK = re.compile(r"https?:|www\.|\b[a-z0-9-]+\.[a-z]{2,24}/\S|\]\(|\]\[|^\s*\[[^\]]+\]:|</?[a-z][^>]*>", M)
DOMAIN = re.compile(
    r"\b[a-z0-9-]+\.(com|org|net|io|ai|dev|xyz|gov|edu|app|me|ly|co|gg|to|sh|link|info|biz|page|site|online|uk|de"
    r"|fr|ru|cn|us)\b",
    I,
)
CAPITALISED = re.compile(r"[A-Z][a-z]+", A)


def linkish(text):
    if LINK.search(text):
        return True
    return any(not CAPITALISED.fullmatch(m.group(1)) for m in DOMAIN.finditer(text))


EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+", A)
HANDLE = re.compile(r"(^|[^\w])@[\w.]{2,}", A)
PHONE = re.compile(r"(?<![A-Za-z\d])\+?(?:\(\d{2,4}\)|\d)[\d\s().-]{5,}\d", A)
WHEN = re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\(\s*(?:1\d{3}|20\d{2})\s*\)", A)
NUMBERED = re.compile(
    r"\b(?:isbn|issn|doi|pmc|pmid|item|no\.?|number|id|barcode|catalogue|catalog|accession|specimen|page|pp\.?"
    r"|ref\.?)\s*[:#]?\s*\Z",
    I,
)
YEAR = re.compile(r"(?:1\d{3}|20\d{2})", A)
DIGITS = re.compile(r"\d+", A)
BROKEN = re.compile(r"\d[-.]\d", A)
AREA = re.compile(r"\(\d{3}\)", A)


def units_before(s, at, units):
    """The last `units` UTF-16 code units before a place, which is how far back the reference looks."""
    raw = s[:at].encode("utf-16-le", "surrogatepass")[-2 * units :]
    return raw.decode("utf-16-le", "surrogatepass")


def phone_like(text):
    """Section 12: "a phone number needs the shape of one: a leading plus, a bracketed area code, dashes or dots
    between its groups, a single unbroken run, or two to four spaced groups making nine digits or more; a run of
    years, a run of figures in more groups than a number has, and a run named as an item, page or catalogue
    number pass.\""""
    cleaned = WHEN.sub(" when ", text)
    for m in PHONE.finditer(cleaned):
        run = m.group(0)
        groups = DIGITS.findall(run)
        digits = sum(len(g) for g in groups)
        if digits < 7 or digits > 15:
            continue
        if all(YEAR.fullmatch(g) for g in groups):
            continue
        if NUMBERED.search(units_before(cleaned, m.start(), 14)):
            continue
        shaped = run.startswith("+") or AREA.match(run) or BROKEN.search(run) or len(groups) == 1
        spaced = 2 <= len(groups) <= 4 and all(2 <= len(g) <= 5 for g in groups) and digits >= 9
        if shaped or spaced:
            return True
    return False


ORDER = r"(?:ignore|disregard|override|forget|bypass)"
RULES = r"(?:instructions?|prompts?|guidelines|rules|directives|system prompt|programming|training)"
READER_NAME = r"(?:claude|chatgpt|gpt|gemini|copilot|grok|llama)"
READERS = r"(?:ais?|llms?|models?|assistants?|bots?|agents?|everyone)"
DASHES = "[,:—–-]"
# A word before a reader's name that makes the sentence a question or a report. The reference asks it in one
# look behind, which this language takes only at a fixed width, so each word is asked on its own.
NOT_ASKED = "".join(
    r"(?<!\b%s\s)" % w
    for w in ("do", "does", "did", "would", "will", "can", "could", "should", "might", "may", "to", "that")
)
QUANTITY = r"\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?"

READER_INSTRUCTIONS = [
    re.compile(
        r"\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier)\b[^.]{0,20}"
        r"\b(instructions?|prompts?)\b",
        I,
    ),
    re.compile(r"\byou are now (?:a|an|the)\b[^.]{0,30}\b(assistant|model|bot|persona|character)\b", I),
    re.compile(
        r"(^|\n)\s*#*\s*(system|developer)\s*(prompt|message)\s*:"
        r"|\b(new|updated|override|real)\s+(system|developer)\s*(prompt|message)\b",
        I,
    ),
    re.compile(
        r"\b(reveal|disclose|print|output|repeat|show)\b[^.]{0,30}"
        r"\b(your (?:system prompt|instructions|hidden instructions|rules)|hidden instructions)\b",
        I,
    ),
    re.compile(r"\bDAN mode\b", I),
    re.compile(r"\[\s*(system|inst|/inst|assistant)\s*\]|<\|.*?\|>|\{\{.*?\}\}", I),
    re.compile(
        r"\b" + ORDER + QUANTITY + r"(?:your|all previous|previous|prior|above|earlier)\b[^.!?]{0,25}\b" + RULES + r"\b",
        I,
    ),
    re.compile(
        r"(?:^|[.!?:;]\s*|\b(?:please|ok|okay|hey)\b[\s,]*|"
        + NOT_ASKED
        + r"\b"
        + READER_NAME
        + r"\b\s*"
        + DASHES
        + r"?\s*|\b"
        + READERS
        + r"\s*"
        + DASHES
        + r"\s*)"
        + ORDER
        + QUANTITY
        + r"(?:the|these|those|its|my)?\s*(?:own\s+)?(?:safety\s+)?"
        + RULES
        + r"\b",
        I,
    ),
    re.compile(r"\bI (?:want|need) you to (?:ignore|disregard|forget|override)\b", I),
    re.compile(
        r"\b(if you are|to any|attention,?|note to) (an? )?(AI|LLM|language model|assistant|agent|model)\b[^.]{0,20}"
        r"\b(reading|parsing|processing|summari[sz]ing)\b",
        I,
    ),
    re.compile(
        r"\b(you are now|from now on,? you are)\s+(?:\w+\s+){0,3}?(assistant|model|AI|bot|agent|persona|character"
        r"|mode)\b",
        I,
    ),
    re.compile(
        "\\b(?:[Yy]ou(?: are|'re|’re) now|[Ff]rom now on,? you(?: are|'re|’re))"
        "\\s+(?:called\\s+|named\\s+)?[A-Z][A-Za-z]{1,20}\\b",
        A,
    ),
    re.compile(
        r"\b(here are|these are|follow|obey)\s+(?:your\s+|my\s+|the\s+)?new instructions\b"
        r"|\bnew instructions\s*(:|follow\b|below\b|are as follows\b)"
        r"|\byour new (?:instructions|rules|task|role|prompt|orders)\b",
        I,
    ),
]
SHOUT = re.compile(r"[A-Z]{12,}", A)
BREAKS = str.maketrans({"\r": "\n", " ": "\n", " ": "\n", " ": " "})


def text_issues(raw):
    """What is wrong with a piece of public text, as the fixture's codes in its order. Empty when clean."""
    text = visible(raw).translate(BREAKS)
    out = []
    if linkish(text):
        out.append("links")
    if EMAIL.search(text) or phone_like(text) or HANDLE.search(text):
        out.append("contact")
    if any(p.search(text) for p in READER_INSTRUCTIONS):
        out.append("machines")
    if SHOUT.search(re.sub(r"\s", "", text, flags=A)):
        out.append("shouting")
    return out


def passes(text):
    """Whether the gate takes a text: no issue of the four."""
    return not text_issues(text)
