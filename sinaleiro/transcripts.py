"""Reads Claude Code transcripts incrementally: each file is parsed once, then only its new bytes on every poll.

From a session's transcript we get what the farm shows: its last prompt and tool, the files it edited, its sub-agents
(Agent/Task calls, running or done, including background ones that finish with a task notification), the messages it
sent to other sessions (SendMessage), the tokens it used per day, and the tail of its conversation.
"""

from __future__ import annotations

import glob
import json
import os
import re
import threading
import time
from collections import deque
from datetime import datetime

from .limits import family
from .sessions import CLAUDE_HOME

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
AGENT_TOOLS = ("Agent", "Task")
NOTE_ID = re.compile(r"<tool-use-id>(toolu_[A-Za-z0-9]+)</tool-use-id>")
NOTE_STATUS = re.compile(r"<status>(\w+)</status>")
NOTE_TASK = re.compile(r"<task-id>([A-Za-z0-9]+)</task-id>")
AGENT_ID = re.compile(r"agentId: ([A-Za-z0-9]+)")
BURNS_KEEP = 26 * 3600


def _ts(iso) -> float:
    if not iso:
        return time.time()
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def _day(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _short(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def _tool_label(name: str, inp: dict) -> str:
    target = inp.get("file_path") or inp.get("notebook_path") or inp.get("path") or inp.get("pattern") \
        or inp.get("description") or inp.get("command") or inp.get("url") or inp.get("query") or inp.get("to") or ""
    if isinstance(target, str) and target.startswith("/"):
        target = os.path.basename(target)
    return f"{name} {_short(str(target), 60)}".strip()


class Transcript:
    def __init__(self, path: str):
        self.path, self.offset, self.rest = path, 0, b""
        self.prompt = self.prompt_at = self.tool = self.tool_at = None
        self.files: list[str] = []
        self.agents: dict[str, dict] = {}
        self.sent: list[dict] = []
        self.tokens: dict[str, int] = {}
        # message id -> (ts, model family, tokens): a reply is written once per content block, the first lines with a
        # provisional output count, so a later line of the same id replaces what its earlier ones counted
        self.burns: dict[str, tuple[float, str | None, int]] = {}
        self.convo: deque = deque(maxlen=60)
        self.last_at = 0.0

    def update(self):
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return
        if size < self.offset:  # rewritten: start over
            self.__init__(self.path)
        if size == self.offset:
            return
        with open(self.path, "rb") as f:
            f.seek(self.offset)
            data = self.rest + f.read()
            self.offset = f.tell()
        lines = data.split(b"\n")
        self.rest = lines.pop()  # a partial last line waits for the next read
        for raw in lines:
            if raw.strip():
                self._line(raw.decode("utf-8", "replace"))

    def _line(self, line: str):
        # a background sub-agent finished (task notification). One that is still waiting on background work of its own
        # gets an interim "completed" first: it keeps working until the notification that carries its report.
        if ("<tool-use-id>" in line or "<task-id>" in line) and "has not reported yet" not in line:
            st = NOTE_STATUS.search(line)
            ids = set(NOTE_ID.findall(line))
            for task in NOTE_TASK.findall(line):  # the final notification may name only the task (the agent's id)
                ids |= {k for k, a in self.agents.items() if a.get("agent_id") == task}
            for tid in ids:
                a = self.agents.get(tid)
                if a and a["status"] == "running" and st:
                    a["status"] = "done" if st.group(1) == "completed" else "failed"
                    a["ended"] = time.time()
        try:
            e = json.loads(line)
        except ValueError:
            return
        ts = _ts(e.get("timestamp"))
        if e.get("timestamp"):
            self.last_at = max(self.last_at, ts)
        msg = e.get("message") or {}
        content = msg.get("content")
        if e.get("type") == "assistant":  # tokens first: a sub-agent's (sidechain) spend the same limit
            mid, usage = msg.get("id"), msg.get("usage") or {}
            if mid and usage:
                n = sum(int(usage.get(k) or 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens"))
                old = self.burns.get(mid)
                if old:  # the same reply again: count the difference, keep its first timestamp
                    ts = old[0]
                    self.tokens[_day(ts)] = self.tokens.get(_day(ts), 0) + n - old[2]
                else:
                    self.tokens[_day(ts)] = self.tokens.get(_day(ts), 0) + n
                self.burns[mid] = (ts, family(msg.get("model")), n)
                if len(self.burns) > 6000:
                    cut = time.time() - BURNS_KEEP
                    self.burns = {k: b for k, b in self.burns.items() if b[0] >= cut}
        if e.get("isSidechain"):
            return
        if e.get("type") == "user":
            if e.get("origin", {}).get("kind") == "human":
                t = _text_of(content)
                if t and not t.lstrip().startswith("<"):
                    self.prompt, self.prompt_at = _short(t, 160), ts
                    self.convo.append({"role": "user", "text": _short(t, 600), "ts": ts})
            for c in content if isinstance(content, list) else []:
                if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in self.agents:
                    a = self.agents[c["tool_use_id"]]
                    text = _text_of(c.get("content"))
                    if "Async agent launched" in text or "running in the background" in text:
                        a["async"] = True
                        m = AGENT_ID.search(text)
                        if m:
                            a["agent_id"] = m.group(1)
                    elif a["status"] == "running":
                        a["status"] = "failed" if c.get("is_error") else "done"
                        a["ended"] = ts
        elif e.get("type") == "assistant":
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text" and c.get("text", "").strip():
                    self.convo.append({"role": "claude", "text": _short(c["text"], 600), "ts": ts})
                elif c.get("type") == "tool_use":
                    name, inp = c.get("name", ""), c.get("input") or {}
                    self.tool, self.tool_at = _tool_label(name, inp), ts
                    self.convo.append({"role": "tool", "text": self.tool, "ts": ts})
                    fp = inp.get("file_path") or inp.get("notebook_path")
                    if name in EDIT_TOOLS and fp:
                        if fp in self.files:
                            self.files.remove(fp)
                        self.files.append(fp)
                        del self.files[:-20]
                    if name in AGENT_TOOLS:
                        self.agents[c.get("id", str(ts))] = {
                            "id": c.get("id"), "title": _short(inp.get("description") or inp.get("prompt") or "sub-agent", 60),
                            "type": inp.get("subagent_type") or "general-purpose", "status": "running", "started": ts,
                            "ended": None, "async": bool(inp.get("run_in_background"))}
                        if len(self.agents) > 80:
                            for k in sorted(self.agents, key=lambda k: self.agents[k]["started"])[:20]:
                                self.agents.pop(k)
                    if name == "SendMessage" and inp.get("to"):
                        self.sent.append({"ts": ts, "to": str(inp["to"]), "summary": _short(inp.get("summary") or inp.get("message") or "", 80)})
                        del self.sent[:-30]

    def view(self, now: float) -> dict:
        subs = [a for a in self.agents.values()
                if a["status"] == "running" and now - a["started"] < 3 * 3600 or (a["ended"] and now - a["ended"] < 600)]
        return {"prompt": self.prompt, "prompt_at": self.prompt_at, "tool": self.tool, "tool_at": self.tool_at,
                "files": self.files[-12:], "subagents": sorted(subs, key=lambda a: a["started"]),
                "sent": [m for m in self.sent if now - m["ts"] < 6 * 3600],
                "tokens_today": self.tokens.get(_day(now), 0), "tokens_total": sum(self.tokens.values()),
                "last_at": self.last_at}


_lock = threading.Lock()
_files: dict[str, Transcript] = {}


def get(path: str) -> Transcript:
    with _lock:
        t = _files.get(path)
        if not t:
            t = _files[path] = Transcript(path)
        t.update()
        return t


def find(session_id: str) -> str | None:
    hits = glob.glob(os.path.join(CLAUDE_HOME, "projects", "*", f"{session_id}.jsonl"))
    return max(hits, key=os.path.getmtime) if hits else None


def tokens_today(now: float | None = None) -> int:
    """Every transcript written today, live session or not, sub-agents' included: the farm's tokens for the day."""
    now = now or time.time()
    midnight = time.mktime(time.localtime(now)[:3] + (0, 0, 0, 0, 0, -1))
    total = 0
    for p in _files():
        try:
            if os.path.getmtime(p) < midnight:
                continue
        except OSError:
            continue
        total += get(p).tokens.get(_day(now), 0)
    return total


def burns_since(since: float) -> list[tuple[float, str, int]]:
    """Every local (ts, model family, tokens) since `since`, across all transcripts, sub-agents' included: they spend
    the same limit."""
    out = []
    for p in _files():
        try:
            if os.path.getmtime(p) < since:
                continue
        except OSError:
            continue
        out += [b for b in get(p).burns.values() if b[0] >= since and b[1] and b[2]]
    return sorted(out)


_listing: tuple[float, list[str]] = (0.0, [])


def _files() -> list[str]:
    """Every transcript, the sessions' and their sub-agents' (they spend the same tokens), listed at most every 5 s."""
    global _listing
    if time.time() - _listing[0] > 5:
        _listing = (time.time(), glob.glob(os.path.join(CLAUDE_HOME, "projects", "*", "*.jsonl")) +
                    glob.glob(os.path.join(CLAUDE_HOME, "projects", "*", "*", "subagents", "*.jsonl")))
    return _listing[1]
