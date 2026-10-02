"""The live Claude Code sessions on this machine, and what each one is doing.

Claude Code keeps a registry of its running sessions in ~/.claude/sessions/<pid>.json (name, cwd, busy/idle) and a
transcript of each one in ~/.claude/projects/<project>/<session id>.jsonl. We only read both.
"""

from __future__ import annotations

import glob
import json
import os
import time

CLAUDE_HOME = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
TAIL_BYTES = 256 * 1024


def _pid_alive(pid: int, proc_start: str | None) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    if proc_start:  # the pid may have been reused by another process: compare its start time
        try:
            with open(f"/proc/{pid}/stat") as f:
                fields = f.read().rsplit(")", 1)[1].split()
            return fields[19] == str(proc_start)
        except (OSError, IndexError):
            return True
    return True


def registry() -> list[dict]:
    """Every live session: {pid, id, name, cwd, status, started, updated}."""
    out = []
    for p in glob.glob(os.path.join(CLAUDE_HOME, "sessions", "*.json")):
        try:
            with open(p) as f:
                s = json.load(f)
            pid = int(s["pid"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if not _pid_alive(pid, s.get("procStart")):
            continue
        out.append({"pid": pid, "id": s.get("sessionId", ""), "name": s.get("name") or str(pid),
                    "cwd": s.get("cwd", ""), "status": s.get("status", "idle"), "kind": s.get("kind", ""),
                    "started": (s.get("startedAt") or 0) / 1000, "updated": (s.get("updatedAt") or 0) / 1000})
    return sorted(out, key=lambda s: s["started"])


def session_of_pid(pid: int | None = None) -> dict | None:
    """The session this process runs under: walk up the parents until one is in the registry."""
    by_pid = {s["pid"]: s for s in registry()}
    pid = pid or os.getpid()
    for _ in range(64):
        if pid in by_pid:
            return by_pid[pid]
        try:
            with open(f"/proc/{pid}/stat") as f:
                pid = int(f.read().rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            return None
        if pid <= 1:
            return None
    return None


def transcript_path(session_id: str) -> str | None:
    hits = glob.glob(os.path.join(CLAUDE_HOME, "projects", "*", f"{session_id}.jsonl"))
    return max(hits, key=os.path.getmtime) if hits else None


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def _short(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _tool_label(name: str, inp: dict) -> str:
    target = inp.get("file_path") or inp.get("notebook_path") or inp.get("path") or inp.get("pattern") \
        or inp.get("command") or inp.get("url") or inp.get("query") or inp.get("description") or ""
    if isinstance(target, str) and target.startswith("/"):
        target = os.path.basename(target)
    return f"{name} {_short(str(target), 48)}".strip()


_cache: dict[str, tuple[float, int, dict]] = {}


def activity(session_id: str) -> dict:
    """{prompt, prompt_at, tool, tool_at, files} from the tail of the session's transcript (cached by mtime/size)."""
    path = transcript_path(session_id)
    if not path:
        return {}
    try:
        st = os.stat(path)
    except OSError:
        return {}
    hit = _cache.get(path)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    with open(path, "rb") as f:
        if st.st_size > TAIL_BYTES:
            f.seek(st.st_size - TAIL_BYTES)
            f.readline()  # drop the partial line
        lines = f.read().decode("utf-8", "replace").splitlines()
    act: dict = {"files": []}
    files: list[str] = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        msg = e.get("message") or {}
        if e.get("type") == "user" and e.get("origin", {}).get("kind") == "human" and not e.get("isSidechain"):
            t = _text_of(msg.get("content"))
            if t and not t.startswith("<"):
                act["prompt"], act["prompt_at"] = _short(t, 140), e.get("timestamp")
        elif e.get("type") == "assistant":
            for c in msg.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    inp = c.get("input") or {}
                    act["tool"], act["tool_at"] = _tool_label(c.get("name", ""), inp), e.get("timestamp")
                    fp = inp.get("file_path") or inp.get("notebook_path")
                    if c.get("name") in ("Edit", "Write", "MultiEdit", "NotebookEdit") and fp:
                        if fp in files:
                            files.remove(fp)
                        files.append(fp)
    act["files"] = files[-12:]
    _cache[path] = (st.st_mtime, st.st_size, act)
    return act


def snapshot() -> list[dict]:
    now = time.time()
    out = []
    for s in registry():
        out.append({**s, **activity(s["id"]), "age": now - s["started"]})
    return out
