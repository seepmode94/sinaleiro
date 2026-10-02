"""The 5-hour limit: how full the account's window is, and how much of it this machine filled.

Claude Code hands the statusline the account's usage (rate_limits.five_hour.used_percentage, 0-100, and resets_at),
which counts everything on the account: this machine, other computers, the Claude apps. The transcripts here give
the tokens this machine spent, per model. The difference is what was spent elsewhere:

    outside = rise of the % - local tokens x what a token is worth in %

What a token is worth, per model family, is learned from the steps where one family did (almost) all the local work:
the low quartile of rise/tokens, so steps where something outside was spending too don't inflate it. Until a family
has been seen alone, steps that use it count entirely as local ("learning").

Pure functions only (samples and burns in, numbers out), so the arithmetic is tested without Claude Code.
"""

from __future__ import annotations

from dataclasses import dataclass

WINDOW = 5 * 3600
FAMILIES = ("fable", "opus", "sonnet", "haiku")
MIN_RISE = 1.0  # a step closes once the % rose this much...
MAX_STEP = 900.0  # ...or after this long (s), so a slow trickle still makes steps
ALONE = 0.8  # a family "did the step alone" with this share of its tokens
PER = 100_000  # rates are shown as % per 100K tokens
MIN_PACE = 600.0  # the pace needs at least this much (s) between its two readings
MAX_LEARN = 1800.0  # a step longer than this mixes too much to learn a rate from
SEEN = 0.5  # an outside rise this big (%) counts as "someone out there is spending"
RECENT = 1800.0  # ...and the neighbour shows what came from outside in the last half hour


@dataclass(frozen=True)
class Sample:
    ts: float
    pct: float
    reset: float  # unix seconds the window resets


def family(model: str | None) -> str | None:
    """'claude-opus-5-5' -> 'opus'. None for synthetic messages (no model, nothing spent)."""
    m = (model or "").lower()
    if not m or m.startswith("<"):
        return None
    return next((f for f in FAMILIES if f in m), "outro")


def windows(samples: list[Sample]) -> list[list[Sample]]:
    """Samples grouped by 5-hour window (the reset time of the window's first reading, give or take two minutes),
    oldest first. A % that goes down inside a window (a correction on the server's side) stays in that window."""
    out: list[list[Sample]] = []
    for s in sorted(samples, key=lambda s: s.ts):
        if out and abs(out[-1][0].reset - s.reset) < 120:
            out[-1].append(s)
        else:
            out.append([s])
    return out


def steps(win: list[Sample], start: float | None = None) -> list[tuple[float, float, float]]:
    """(t1, t2, rise) between samples, merged until the rise is worth measuring. `start` adds the window's opening
    (0 % at reset - 5 h) as the first point, so the % already there when we began watching is explained too."""
    pts = [(start, 0.0)] if start is not None and win and start < win[0].ts else []
    top = 0.0
    for s in win:  # the highest % so far: after a dip, the climb back isn't counted twice
        top = max(top, s.pct)
        pts.append((s.ts, top))
    out, i = [], 0
    while i < len(pts) - 1:
        j = i + 1
        while j < len(pts) - 1 and pts[j][1] - pts[i][1] < MIN_RISE and pts[j][0] - pts[i][0] < MAX_STEP:
            j += 1
        out.append((pts[i][0], pts[j][0], max(0.0, pts[j][1] - pts[i][1])))
        i = j
    return out


def spent(burns: list[tuple[float, str, int]], t1: float, t2: float) -> dict[str, int]:
    """Local tokens per family in (t1, t2]."""
    out: dict[str, int] = {}
    for ts, fam, n in burns:
        if t1 < ts <= t2:
            out[fam] = out.get(fam, 0) + n
    return out


def _low_quartile(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[(len(xs) - 1) // 4] if len(xs) >= 4 else xs[(len(xs) - 1) // 2]  # few: the lower middle


def rates(samples: list[Sample], burns: list[tuple[float, str, int]]) -> dict[str, float]:
    """% of the window one token of each family is worth, learned from the steps it did alone."""
    seen: dict[str, list[float]] = {}
    for win in windows(samples):
        for t1, t2, rise in steps(win):
            tok = spent(burns, t1, t2)
            total = sum(tok.values())
            if not total or rise <= 0 or t2 - t1 > MAX_LEARN:
                continue
            fam, n = max(tok.items(), key=lambda kv: kv[1])
            if n / total >= ALONE:
                seen.setdefault(fam, []).append(rise / total)
    return {f: _low_quartile(v) for f, v in seen.items()}


def summary(samples: list[Sample], burns: list[tuple[float, str, int]], now: float) -> dict:
    """The current window: % used, when it resets, how much was here vs outside, the pace, and per-model tokens."""
    if not samples:
        return {"available": False}
    wins = windows(samples)
    win, last = wins[-1], wins[-1][-1]
    r = rates(samples, burns)
    out = {"available": True, "rates": {f: v * PER for f, v in r.items()}, "updated": last.ts}
    if last.reset <= now:  # the window ran out and nothing has been asked since: a fresh one starts at 0
        return {**out, "pct": 0.0, "resets_at": None, "started": None, "here": 0.0, "outside": 0.0,
                "learning": False, "per_hour": 0.0, "eta": None, "models": {}, "outside_recent": 0.0, "outside_at": None}
    start = last.reset - WINDOW
    here = outside = recent = 0.0
    outside_at = None  # when something outside last spent a visible bit (the neighbour wakes up for it)
    learning = False
    for t1, t2, rise in steps(win, start):
        tok = spent(burns, t1, t2)
        if not sum(tok.values()):
            ext = rise  # the % rose and nothing ran here: certainly outside
        elif all(f in r for f in tok):
            expect = sum(r[f] * n for f, n in tok.items())
            here += min(rise, expect)
            ext = max(0.0, rise - expect)
        else:
            here += rise
            ext = 0.0
            learning = True
        outside += ext
        if ext >= SEEN and t2 >= now - RECENT:
            recent += ext
        if ext >= SEEN:
            outside_at = t2
    # pace over the last half hour of this window (or since it started, if younger), over at least MIN_PACE
    back = max(start, min(now - 1800, last.ts - MIN_PACE))
    older = [s for s in win if s.ts <= back]
    base = (older[-1].ts, older[-1].pct) if older else (start, 0.0)
    span = last.ts - base[0]
    per_hour = max(0.0, (last.pct - base[1]) / (span / 3600)) if span >= MIN_PACE else 0.0
    eta = now + (100 - last.pct) / per_hour * 3600 if per_hour > 0 and last.pct < 100 else None  # from now on
    return {**out, "pct": last.pct, "resets_at": last.reset, "started": start, "here": here, "outside": outside,
            "outside_recent": recent, "outside_at": outside_at,
            "learning": learning, "per_hour": per_hour, "eta": eta if eta and eta < last.reset else None,
            "models": spent(burns, start, now)}


def from_statusline(data: dict) -> tuple[float, float, float | None, float | None] | None:
    """(five_pct, five_reset, week_pct, week_reset) from the statusline's input, or None without plan limits."""
    rl = (data or {}).get("rate_limits") or {}
    if not isinstance(rl, dict):
        return None
    five, week = rl.get("five_hour") or {}, rl.get("seven_day") or {}
    try:
        if five.get("used_percentage") is None or not five.get("resets_at"):
            return None
        f = float(five["used_percentage"]), float(five["resets_at"])
    except (TypeError, ValueError, AttributeError):
        return None
    try:
        w = (float(week["used_percentage"]), float(week["resets_at"])) \
            if week.get("used_percentage") is not None and week.get("resets_at") else (None, None)
    except (TypeError, ValueError, AttributeError):
        w = (None, None)
    return (*f, *w)
