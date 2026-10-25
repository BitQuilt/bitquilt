"""Times: ISO 8601 instants in UTC, hours, and the `YYYY-MM-DDTHH` hour.

CORE.md section 1: "An hour is `YYYY-MM-DDTHH` in UTC."
"""

from datetime import datetime, timedelta, timezone


def parse_time(s):
    """An ISO 8601 instant as an aware UTC datetime. Returns None for
    anything that does not parse."""
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    if not isinstance(s, str):
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc)


def hours(h) -> timedelta:
    return timedelta(hours=float(h))


def hour_string(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
