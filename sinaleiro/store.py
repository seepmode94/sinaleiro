"""The arbiter's memory: who touched which file when, hand-overs, and what the cop did. One SQLite file (WAL), so
every hook process and the UI server can use it at once."""

from __future__ import annotations

import json
import os
import sqlite3
import time

from .arbiter import Grant, Touch

DB_PATH = os.environ.get("SINALEIRO_DB") or os.path.expanduser("~/.claude/sinaleiro/state.db")
KEEP = 24 * 3600  # rows older than this are dropped

SCHEMA = """
CREATE TABLE IF NOT EXISTS touches (session TEXT, path TEXT, kind TEXT, ts REAL, repo TEXT, component TEXT,
                                    PRIMARY KEY (session, path, kind));
CREATE TABLE IF NOT EXISTS grants (path TEXT, frm TEXT, too TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS events (ts REAL, light TEXT, session TEXT, others TEXT, path TEXT, tool TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS warned (session TEXT, key TEXT, ts REAL, PRIMARY KEY (session, key));
CREATE TABLE IF NOT EXISTS decisions (path TEXT, requester TEXT, holder TEXT, choice TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS looks (key TEXT PRIMARY KEY, look TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS limits (ts REAL, five REAL, five_reset REAL, week REAL, week_reset REAL);
CREATE INDEX IF NOT EXISTS limits_ts ON limits (ts);
CREATE TABLE IF NOT EXISTS phones (hash TEXT PRIMARY KEY, created REAL, seen REAL, expires REAL, agent TEXT);
CREATE INDEX IF NOT EXISTS touches_ts ON touches (ts);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
"""


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db = sqlite3.connect(path, timeout=2.0, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript(SCHEMA)
    return db


def touch(db, t: Touch):
    db.execute("INSERT INTO touches VALUES (?,?,?,?,?,?) ON CONFLICT (session, path, kind) DO UPDATE SET ts=excluded.ts",
               (t.session, t.path, t.kind, t.ts, t.repo, t.component))


def touches(db, since: float) -> list[Touch]:
    return [Touch(*r) for r in db.execute(
        "SELECT session, path, kind, ts, repo, component FROM touches WHERE ts >= ?", (since,))]


def grant(db, path: str, frm: str, to: str, ts: float | None = None):
    db.execute("INSERT INTO grants VALUES (?,?,?,?)", (path, frm, to, ts or time.time()))


def grants(db, since: float) -> list[Grant]:
    return [Grant(*r) for r in db.execute("SELECT path, frm, too, ts FROM grants WHERE ts >= ?", (since,))]


def event(db, light: str, session: str, others: list[str], path: str, tool: str, note: str = ""):
    db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?)",
               (time.time(), light, session, json.dumps(others), path, tool, note))


def events(db, since: float, limit: int = 60) -> list[dict]:
    rows = db.execute("SELECT ts, light, session, others, path, tool, note FROM events WHERE ts >= ? "
                      "ORDER BY ts DESC LIMIT ?", (since, limit))
    return [{"ts": r[0], "light": r[1], "session": r[2], "others": json.loads(r[3] or "[]"), "path": r[4],
             "tool": r[5], "note": r[6]} for r in rows]


def warn_once(db, session: str, key: str, ttl: float) -> bool:
    """True the first time `session` is warned about `key` within `ttl` (the cop doesn't nag on every call)."""
    now = time.time()
    row = db.execute("SELECT ts FROM warned WHERE session=? AND key=?", (session, key)).fetchone()
    if row and now - row[0] < ttl:
        return False
    db.execute("INSERT OR REPLACE INTO warned VALUES (?,?,?)", (session, key, now))
    return True


def prune(db):
    cut = time.time() - KEEP
    for table in ("touches", "grants", "events", "warned", "decisions", "limits"):  # looks are kept
        db.execute(f"DELETE FROM {table} WHERE ts < ?", (cut,))


LOOK_KEYS = {"hat", "colors", "accessory"}


def set_look(db, key: str, look: dict):
    """A session's look is kept per project folder, so the next session there wears it too."""
    clean = {k: v for k, v in (look or {}).items() if k in LOOK_KEYS}
    db.execute("INSERT OR REPLACE INTO looks VALUES (?,?,?)", (key, json.dumps(clean), time.time()))


def looks(db) -> dict[str, dict]:
    return {k: json.loads(v) for k, v in db.execute("SELECT key, look FROM looks")}


def decide(db, path: str, requester: str, holder: str, choice: str):
    """The person's call on a red stop: give (the file to the requester), keep (it with the holder), release (to all)."""
    db.execute("INSERT INTO decisions VALUES (?,?,?,?,?)", (path, requester, holder, choice, time.time()))


def decisions(db, since: float) -> list[dict]:
    return [{"path": r[0], "requester": r[1], "holder": r[2], "choice": r[3], "ts": r[4]} for r in db.execute(
        "SELECT path, requester, holder, choice, ts FROM decisions WHERE ts >= ? ORDER BY ts", (since,))]


def limit(db, five: float, five_reset: float, week: float | None, week_reset: float | None, ts: float | None = None,
          every: float = 120.0) -> bool:
    """One reading of the account's limits, from the statusline. Every session's statusline calls this often, so a
    reading is kept only when it moved, or when the last one is `every` seconds old."""
    ts = ts or time.time()
    row = db.execute("SELECT ts, five, five_reset FROM limits ORDER BY ts DESC LIMIT 1").fetchone()
    if row and abs(row[1] - five) < 0.01 and abs(row[2] - five_reset) < 90 and ts - row[0] < every:
        return False
    db.execute("INSERT INTO limits VALUES (?,?,?,?,?)", (ts, five, five_reset, week, week_reset))
    return True


def limits(db, since: float) -> list[tuple[float, float, float, float | None, float | None]]:
    return list(db.execute("SELECT ts, five, five_reset, week, week_reset FROM limits WHERE ts >= ? ORDER BY ts",
                           (since,)))


def phone_add(db, h: str, expires: float, agent: str = ""):
    """A phone that traded the one-use link for a session: only the hash of its cookie is kept."""
    now = time.time()
    db.execute("INSERT OR REPLACE INTO phones VALUES (?,?,?,?,?)", (h, now, now, expires, agent))


def phone_ok(db, h: str, now: float) -> bool:
    row = db.execute("SELECT expires FROM phones WHERE hash=?", (h,)).fetchone()
    if not row or row[0] < now:
        return False
    db.execute("UPDATE phones SET seen=? WHERE hash=?", (now, h))
    return True


def phones(db) -> list[dict]:
    return [{"created": r[0], "seen": r[1], "expires": r[2], "agent": r[3]} for r in db.execute(
        "SELECT created, seen, expires, agent FROM phones WHERE expires >= ? ORDER BY seen DESC", (time.time(),))]


def phones_forget(db) -> int:
    return db.execute("DELETE FROM phones").rowcount
