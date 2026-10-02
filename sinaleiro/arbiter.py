"""The traffic cop: decides, for one tool call, whether another live session is in the way.

Pure functions only (no I/O), so every rule is unit-tested.

Lights:
- green:  nobody else is near this file.
- yellow: another live session read or edited this file, or something in the same component (the file's
          directory inside its repo), recently. The call goes ahead; Claude gets told who is there.
- red:    another live session edited this very file recently and hasn't handed it over. An edit is refused
          until the two sessions agree (SendMessage) and the holder runs `sinaleiro grant` / `release`,
          or the holder's claim goes stale.

Reads are never refused: at most they get a yellow ("being edited by X, it may change under you").
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
READ_TOOLS = {"Read"}
DEFAULT_TTL = 10 * 60  # a claim goes stale this long after the session last touched the file


@dataclass
class Touch:
    session: str
    path: str
    kind: str  # "read" | "edit"
    ts: float
    repo: str = ""
    component: str = ""


@dataclass
class Grant:
    path: str
    frm: str  # the session handing the file over
    to: str  # "*" = released to anyone
    ts: float


@dataclass
class Verdict:
    light: str  # green | yellow | red
    others: list[str] = field(default_factory=list)  # session ids in the way, closest first
    reason: str = ""
    holder: str | None = None  # red only: who holds the file


def repo_root(path: str) -> str:
    """The nearest directory above `path` with a .git (a file too: worktrees), or the file's own directory."""
    d = os.path.dirname(os.path.abspath(path))
    probe = d
    while True:
        if os.path.exists(os.path.join(probe, ".git")):
            return probe
        parent = os.path.dirname(probe)
        if parent == probe:
            return d
        probe = parent


def component_of(path: str, repo: str) -> str:
    """The file's directory relative to its repo ("." for the repo root)."""
    rel = os.path.relpath(os.path.dirname(os.path.abspath(path)), repo)
    return "." if rel in ("", ".") else rel


def kind_of(tool: str) -> str | None:
    if tool in EDIT_TOOLS:
        return "edit"
    if tool in READ_TOOLS:
        return "read"
    return None


def target_path(tool_input: dict | None) -> str | None:
    ti = tool_input or {}
    p = ti.get("file_path") or ti.get("notebook_path") or ti.get("path")
    return os.path.abspath(p) if isinstance(p, str) and p else None


def _granted(grants: list[Grant], path: str, frm: str, me: str, since: float) -> bool:
    """Did `frm` hand `path` to me (or to anyone) after its last edit?"""
    return any(g.path == path and g.frm == frm and g.to in (me, "*") and g.ts >= since for g in grants)


def decide(me: str, path: str, kind: str, touches: list[Touch], grants: list[Grant], alive: set[str],
           now: float, ttl: float = DEFAULT_TTL, names: dict[str, str] | None = None) -> Verdict:
    names = names or {}
    nm = lambda s: names.get(s, s[:8])  # noqa: E731
    repo = repo_root(path)
    comp = component_of(path, repo)
    fresh = [t for t in touches if t.session != me and t.session in alive and now - t.ts <= ttl]

    # red: someone else's live, fresh edit of this exact file that they haven't handed over
    last_edit: dict[str, float] = {}
    for t in fresh:
        if t.path == path and t.kind == "edit":
            last_edit[t.session] = max(last_edit.get(t.session, 0), t.ts)
    holders = sorted((s for s, ts in last_edit.items() if not _granted(grants, path, s, me, ts)),
                     key=lambda s: -last_edit[s])
    if kind == "edit" and holders:
        h = holders[0]
        mins = max(1, round((now - last_edit[h]) / 60))
        return Verdict("red", holders, holder=h, reason=(
            f"SINALEIRO 🔴 {os.path.basename(path)} is being edited by the Claude session '{nm(h)}' "
            f"(its last edit {mins} min ago). Don't edit it yet. Use SendMessage to '{nm(h)}': say what you need to "
            f"change in this file and why, and agree who does it. If it should be you, ask '{nm(h)}' to run "
            f"`sinaleiro grant {path} {nm(me)}` (or `sinaleiro release {path}` when it's done), then try again. "
            f"If you can do your part elsewhere, do that instead."))

    # yellow: the same file, or the same component, with someone else around
    same_file = sorted({t.session for t in fresh if t.path == path})
    same_comp = sorted({t.session for t in fresh if t.repo == repo and t.component == comp} - set(same_file))
    others = same_file + same_comp
    if not others:
        return Verdict("green")
    if kind == "read" and holders:
        why = f"{os.path.basename(path)} is being edited right now by '{nm(holders[0])}': it may change under you."
    else:
        bits = [f"'{nm(s)}' ({'this file' if s in same_file else 'files in ' + comp + '/'})" for s in others]
        why = f"other Claude sessions are working nearby: {', '.join(bits)}."
    return Verdict("yellow", others, reason=(
        f"SINALEIRO 🟡 {why} If your change could overlap with theirs, tell them with SendMessage before you go on."))
