"""sinaleiro: a traffic cop for the Claude Code sessions on this machine.

  sinaleiro hook                     PreToolUse hook (reads the call on stdin); installed by `sinaleiro install`
  sinaleiro serve [--port 7777]      the farm UI at http://localhost:7777
        [--lan [--host IP]]          ...and on the home network, for your phone (a token, by QR code)
        [--new-token] [--show-convo] a new phone link (the old one dies); show conversations on the phone too
        [--chat]                     a chat that types into the sessions running in tmux (from the farm/phone)
  sinaleiro status                   live sessions, who holds what, the last calls the cop made
  sinaleiro grant <file> <session>   hand a file you're editing to another session
  sinaleiro release [file ...]       you're done with these files (no file: everything you hold)
  sinaleiro statusline               statusline command (reads Claude Code's status on stdin): keeps the 5-hour
                                     limit readings, then shows your previous statusline, if you had one
  sinaleiro install | uninstall      add / remove the hook and the statusline in ~/.claude/settings.json
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

from . import arbiter, limits, sessions, store, transcripts
from .arbiter import Touch

TTL = float(os.environ.get("SINALEIRO_TTL", arbiter.DEFAULT_TTL))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(HERE, "bin", "sinaleiro")
MATCHER = "Read|Edit|Write|MultiEdit|NotebookEdit"
PREV_STATUSLINE = os.path.join(os.path.dirname(store.DB_PATH), "statusline.json")  # yours, from before install


def _names() -> tuple[dict[str, str], dict[str, str]]:
    reg = sessions.registry()
    return {s["id"]: s["name"] for s in reg}, {s["name"]: s["id"] for s in reg}


def hook() -> int:
    """Never breaks a session: any trouble here and the call goes ahead as if the cop weren't there."""
    try:
        call = json.load(sys.stdin)
        out = _hook(call)
    except Exception as e:  # noqa: BLE001
        print(f"sinaleiro: {e}", file=sys.stderr)
        return 0
    if out:
        print(json.dumps(out))
    return 0


def _hook(call: dict) -> dict | None:
    tool, me = call.get("tool_name", ""), call.get("session_id", "")
    kind, path = arbiter.kind_of(tool), arbiter.target_path(call.get("tool_input"))
    if not (kind and path and me):
        return None
    names, _ = _names()
    alive = set(names) | {me}
    now = time.time()
    db = store.connect()
    v = arbiter.decide(me, path, kind, store.touches(db, now - TTL), store.grants(db, now - TTL), alive, now, TTL, names)
    if v.light == "red":
        store.event(db, "red", me, v.others, path, tool)
        reason = v.reason
        kept = [d for d in store.decisions(db, now - TTL) if d["path"] == path and d["holder"] == v.holder and d["choice"] == "keep"]
        if kept:  # the person already decided this one
            reason = (f"SINALEIRO 🔴 Your person decided that '{names.get(v.holder, v.holder[:8])}' keeps "
                      f"{os.path.basename(path)} for now. Don't edit it and don't wait for it: do your part elsewhere, or "
                      f"tell your person what you'd need in this file.")
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                       "permissionDecisionReason": reason}}
    repo = arbiter.repo_root(path)
    store.touch(db, arbiter.Touch(me, path, kind, now, repo, arbiter.component_of(path, repo)))
    if int(now) % 50 == 0:
        store.prune(db)
    if v.light == "yellow":
        key = f"{repo}|{arbiter.component_of(path, repo)}|{','.join(v.others)}|{kind}"
        if store.warn_once(db, me, key, TTL):
            store.event(db, "yellow", me, v.others, path, tool)
            # no permissionDecision: the session's own permission rules still decide; we only add context
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": v.reason}}
    return None


def _me(args: list[str]) -> tuple[str, list[str]]:
    if "--as" in args:
        i = args.index("--as")
        who = args[i + 1]
        _, ids = _names()
        return ids.get(who, who), args[:i] + args[i + 2:]
    s = sessions.session_of_pid()
    if not s:
        sys.exit("sinaleiro: not inside a Claude Code session; say which one with --as <session name>")
    return s["id"], args


def grant(args: list[str]) -> int:
    me, args = _me(args)
    if len(args) != 2:
        sys.exit("usage: sinaleiro grant <file> <session name>")
    path, to = os.path.abspath(args[0]), args[1]
    names, ids = _names()
    if to not in ids and to not in names:
        sys.exit(f"sinaleiro: no live session '{to}'. Live: {', '.join(ids) or 'none'}")
    db = store.connect()
    store.grant(db, path, me, ids.get(to, to))
    store.event(db, "grant", me, [ids.get(to, to)], path, "grant")
    print(f"{os.path.basename(path)} is now {to}'s to edit.")
    return 0


def release(args: list[str]) -> int:
    me, args = _me(args)
    db = store.connect()
    paths = [os.path.abspath(a) for a in args] or [t.path for t in store.touches(db, time.time() - TTL)
                                                    if t.session == me and t.kind == "edit"]
    for p in paths:
        store.grant(db, p, me, "*")
        store.event(db, "grant", me, ["*"], p, "release")
    print(f"released {len(paths)} file(s)." if paths else "you hold no files.")
    return 0


def state() -> dict:
    """Everything the UI and `status` show."""
    now = time.time()
    db = store.connect()
    live = sessions.registry()
    alive = {s["id"] for s in live}
    names = {s["id"]: s["name"] for s in live}
    by_name = {s["name"]: s["id"] for s in live}
    looks = store.looks(db)
    for s in live:
        tp = transcripts.find(s["id"])
        s.update(transcripts.get(tp).view(now) if tp else {})
        s["age"] = now - s["started"]
        s["look"] = looks.get(s["cwd"])
        # SendMessage by name (or id) to another live session: the farm flies a letter between them
        s["sent"] = [{**m, "to_id": by_name.get(m["to"], m["to"] if m["to"] in alive else None)} for m in s.get("sent", [])]
    ts = [t for t in store.touches(db, now - TTL) if t.session in alive]
    gs = store.grants(db, now - TTL)
    holds = []  # (session, path) a fresh edit nobody was handed
    for t in ts:
        if t.kind == "edit" and not any(g.path == t.path and g.frm == t.session and g.ts >= t.ts for g in gs):
            holds.append({"session": t.session, "path": t.path, "repo": t.repo, "component": t.component, "ts": t.ts})
    evs = store.events(db, now - 6 * 3600)
    recent_red = [e for e in evs if e["light"] == "red" and now - e["ts"] < 300]
    # live conflicts: two sessions in the same component right now
    zones: dict[tuple[str, str], set[str]] = {}
    for t in ts:
        zones.setdefault((t.repo, t.component), set()).add(t.session)
    conflicts = []
    for (repo, comp), who in zones.items():
        if len(who) < 2:
            continue
        files = {}
        for t in ts:
            if t.repo == repo and t.component == comp:
                files.setdefault(t.path, set()).add(t.session)
        # red: two sessions hold the same file, or the cop refused an edit there and nobody has handed it over since
        stopped = {e["path"] for e in recent_red
                   if e["path"] in files and not any(g.path == e["path"] and g.ts >= e["ts"] for g in gs)}
        red = any(sum(h["path"] == p for h in holds) > 1 for p in files) or bool(stopped)
        conflicts.append({"repo": repo, "component": comp, "sessions": sorted(who),
                          "light": "red" if red else "yellow",
                          "files": sorted({p for p, w in files.items() if len(w) > 1} | stopped)})
    # decisions waiting for the person: a red stop whose holder still holds the file, and nobody has settled since
    decs = store.decisions(db, now - 3600)
    pending, seen_stop = [], set()
    for e in evs:  # newest first
        if e["light"] != "red" or not e["others"] or now - e["ts"] > 1800:
            continue
        holder, key = e["others"][0], (e["path"], e["session"])
        if key in seen_stop or e["session"] not in alive or holder not in alive:
            continue
        seen_stop.add(key)
        h = next((x for x in holds if x["path"] == e["path"] and x["session"] == holder), None)
        # settled: decided since this stop, or already decided "keep" for this pair (it holds while the holder does)
        settled = any(d["path"] == e["path"] and (d["ts"] >= e["ts"] or (
            d["choice"] == "keep" and d["requester"] == e["session"] and d["holder"] == holder and d["ts"] >= h["ts"] - TTL))
            for d in decs) if h else True
        settled = settled or any(
            g.path == e["path"] and g.frm == holder and g.ts >= e["ts"] for g in gs)
        if h and not settled:
            pending.append({"path": e["path"], "rel": os.path.relpath(e["path"], h["repo"]), "repo": h["repo"],
                            "requester": e["session"], "holder": holder, "ts": e["ts"], "held_since": h["ts"]})
    # a decision waiting is a red crossing, even when the stopped session hasn't touched anything there since
    for d in pending:
        comp = arbiter.component_of(d["path"], d["repo"])
        c = next((c for c in conflicts if c["repo"] == d["repo"] and c["component"] == comp), None)
        if c:
            c["light"] = "red"
            c["sessions"] = sorted(set(c["sessions"]) | {d["requester"], d["holder"]})
            if d["path"] not in c["files"]:
                c["files"] = sorted(c["files"] + [d["path"]])
        else:
            conflicts.append({"repo": d["repo"], "component": comp, "sessions": sorted({d["requester"], d["holder"]}),
                              "light": "red", "files": [d["path"]]})
    hot = {f for c in conflicts for f in c["files"]}
    for c in conflicts:
        c["files"] = [os.path.relpath(p, c["repo"]) for p in c["files"]]
    for s in live:
        mine: dict[str, Touch] = {}
        for t in sorted((t for t in ts if t.session == s["id"]), key=lambda t: t.ts):
            if t.path not in mine or t.kind == "edit" or mine[t.path].kind != "edit":
                mine[t.path] = t
        recent = sorted(mine.values(), key=lambda t: t.ts)[-10:]
        # the session stands in the field of the repo it last touched (else the one it was started in)
        s["field"] = recent[-1].repo if recent else (arbiter.repo_root(os.path.join(s["cwd"], "x")) if s["cwd"] else "")
        s["touching"] = [{"rel": os.path.relpath(t.path, t.repo), "kind": t.kind, "ts": t.ts, "hot": t.path in hot}
                         for t in recent]
    return {"now": now, "ttl": TTL, "sessions": live, "holds": holds, "conflicts": conflicts,
            "tokens_today": transcripts.tokens_today(now), "decisions": pending, "limit": limit_state(db, now),
            "events": [{**e, "session_name": names.get(e["session"], e["session"][:8]),
                        "other_names": [names.get(o, "anyone" if o == "*" else o[:8]) for o in e["others"]]}
                       for e in evs]}


def limit_state(db, now: float) -> dict:
    """The 5-hour window from the statusline readings, split into this machine vs outside; plus the week."""
    rows = store.limits(db, now - 24 * 3600)
    samples = [limits.Sample(r[0], r[1], r[2]) for r in rows]
    out = limits.summary(samples, transcripts.burns_since(now - 24 * 3600 - limits.WINDOW), now)
    if rows and rows[-1][3] is not None and (rows[-1][4] or 0) > now:
        out["week"] = {"pct": rows[-1][3], "resets_at": rows[-1][4]}
    return out


def detail(session_id: str) -> dict:
    """One session's card: its state plus the tail of its conversation."""
    st = state()
    s = next((x for x in st["sessions"] if x["id"] == session_id), None)
    if not s:
        return {}
    tp = transcripts.find(session_id)
    s["convo"] = list(transcripts.get(tp).convo)[-40:] if tp else []
    s["holds"] = [{"path": h["path"], "rel": os.path.relpath(h["path"], h["repo"])}
                  for h in st["holds"] if h["session"] == session_id]
    s["resume"] = f"cd {s['cwd']} && claude --resume {session_id}"
    return s


def status() -> int:
    st = state()
    nm = {s["id"]: s["name"] for s in st["sessions"]}
    lim = st["limit"]
    if lim.get("available") and lim.get("resets_at"):
        reset = time.strftime("%H:%M", time.localtime(lim["resets_at"]))
        eta = f", limit at {time.strftime('%H:%M', time.localtime(lim['eta']))} at this pace" if lim.get("eta") else ""
        print(f"⏳ 5h: {lim['pct']:.0f}% (resets {reset}{eta}) · here {lim['here']:.0f}% · outside {lim['outside']:.0f}%"
              + (" · still learning" if lim.get("learning") else ""))
    elif not lim.get("available"):
        print("⏳ 5h: no readings yet (the statusline brings them; restart the sessions after install)")
    print(f"{len(st['sessions'])} live session(s)")
    for s in st["sessions"]:
        print(f"  {'●' if s['status'] == 'busy' else '○'} {s['name']:<22} {s['cwd']}")
        if s.get("prompt"):
            print(f"      ↳ {s['prompt']}")
        if s.get("tool"):
            print(f"      ⚙ {s['tool']}")
    for c in st["conflicts"]:
        dot = "🔴" if c["light"] == "red" else "🟡"
        print(f"{dot} {os.path.basename(c['repo'])}/{c['component']}: {', '.join(nm.get(x, x) for x in c['sessions'])}")
    for h in st["holds"]:
        print(f"  ✎ {nm.get(h['session'], h['session'][:8])} holds {os.path.relpath(h['path'], h['repo'])}")
    return 0


# ---------------------------------------------------------------- statusline
def statusline() -> int:
    """Keeps the account's 5-hour reading, then prints your previous statusline (fed the same input) or a short one.
    Never fails loudly: a broken statusline would only blank the bottom of the terminal."""
    raw = sys.stdin.buffer.read()
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        data = {}
    lim = limits.from_statusline(data)
    if lim:
        try:
            store.limit(store.connect(), *lim)
        except Exception:  # noqa: BLE001 - a locked or broken db must not break the statusline
            pass
    prev = _prev_statusline()
    if prev and prev.get("command"):
        try:
            r = subprocess.run(prev["command"], shell=True, input=raw, capture_output=True, timeout=5)
            sys.stdout.buffer.write(r.stdout)
            return 0
        except (OSError, subprocess.SubprocessError):
            pass
    model = ((data.get("model") or {}).get("display_name") or "").strip()
    bits = [f"🚦 {model}" if model else "🚦"]
    if lim:
        bits.append(f"5h {lim[0]:.0f}% ↺{time.strftime('%H:%M', time.localtime(lim[1]))}")
        if lim[2] is not None:
            bits.append(f"7d {lim[2]:.0f}%")
    print(" · ".join(bits))
    return 0


def _prev_statusline() -> dict | None:
    try:
        with open(PREV_STATUSLINE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- install
SETTINGS = os.path.join(sessions.CLAUDE_HOME, "settings.json")


def _ours(entry: dict) -> bool:
    return any("sinaleiro" in (h.get("command") or "") for h in entry.get("hooks", []))


def _swap_statusline(cfg: dict, remove: bool) -> str:
    """Puts `sinaleiro statusline` in statusLine, keeping yours (saved aside, run by ours with the same input), or
    puts yours back. Returns a line for the person; it never prints what your statusline is."""
    sl = cfg.get("statusLine")
    ours = isinstance(sl, dict) and "sinaleiro" in (sl.get("command") or "")
    if remove:
        if not ours:
            return ""
        prev = _prev_statusline()
        if prev:
            cfg["statusLine"] = prev
        else:
            cfg.pop("statusLine", None)
        if os.path.exists(PREV_STATUSLINE):
            os.remove(PREV_STATUSLINE)
        return "Your previous statusline is back." if prev else "Statusline removed."
    if ours:
        return "Statusline already in place."
    if isinstance(sl, dict) and sl.get("command"):
        os.makedirs(os.path.dirname(PREV_STATUSLINE), exist_ok=True)
        with open(PREV_STATUSLINE, "w") as f:
            json.dump(sl, f)
        cfg["statusLine"] = {**sl, "type": "command", "command": f"{BIN} statusline"}
        return "Statusline: yours stays as it was; sinaleiro reads the 5-hour limit on the way."
    cfg["statusLine"] = {"type": "command", "command": f"{BIN} statusline"}
    return "Statusline added (model · 5-hour limit · week): sinaleiro reads the 5-hour limit from it."


def install(remove: bool = False) -> int:
    """Edits only hooks.PreToolUse and statusLine in settings.json, keeps everything else, and prints none of it."""
    try:
        with open(SETTINGS) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        cfg = {}
    pre = [e for e in cfg.setdefault("hooks", {}).get("PreToolUse", []) if not _ours(e)]
    if not remove:
        pre.append({"matcher": MATCHER, "hooks": [{"type": "command", "command": f"{BIN} hook", "timeout": 5}]})
    if pre:
        cfg["hooks"]["PreToolUse"] = pre
    else:
        cfg["hooks"].pop("PreToolUse", None)
        if not cfg["hooks"]:
            cfg.pop("hooks")
    note = _swap_statusline(cfg, remove)
    tmp = SETTINGS + ".sinaleiro.tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    os.replace(tmp, SETTINGS)
    link = os.path.expanduser("~/.local/bin/sinaleiro")
    if remove:
        if os.path.islink(link):
            os.remove(link)
        print(f"sinaleiro hook removed. Sessions started from now on won't see the cop. {note}")
    else:
        os.makedirs(os.path.dirname(link), exist_ok=True)
        if not os.path.exists(link):
            os.symlink(BIN, link)
        print(f"sinaleiro hook installed ({MATCHER}). {note} New sessions pick it up; restart open ones (or /hooks).")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd, args = (argv[0], argv[1:]) if argv else ("help", [])
    if cmd == "hook":
        return hook()
    if cmd == "serve":
        from .server import serve
        port = int(args[args.index("--port") + 1]) if "--port" in args else 7777
        host = args[args.index("--host") + 1] if "--host" in args else None
        return serve(port, lan="--lan" in args or host is not None, host=host, new_token="--new-token" in args,
                     show_convo="--show-convo" in args, chat="--chat" in args)
    if cmd == "status":
        return status()
    if cmd == "statusline":
        return statusline()
    if cmd == "grant":
        return grant(args)
    if cmd == "release":
        return release(args)
    if cmd in ("install", "uninstall"):
        return install(remove=cmd == "uninstall")
    print(__doc__.strip())
    return 0 if cmd in ("help", "-h", "--help") else 2
