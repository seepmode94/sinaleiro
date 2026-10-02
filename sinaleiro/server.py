"""The farm UI and its feed, on 127.0.0.1 only: the page shows your prompts, so it never leaves this machine.

Actions (POST) need the X-Sinaleiro header and a local Origin, so no other web page can make them for you."""

from __future__ import annotations

import json
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

UI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui")
HOSTS = {"localhost", "127.0.0.1", "[::1]"}
mimetypes.add_type("font/ttf", ".ttf")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _local(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return host in HOSTS  # a page on another site pointed at us (DNS rebinding): no

    def do_GET(self):
        if not self._local():
            return self._send(403, b"forbidden", "text/plain")
        u = urlparse(self.path)
        from . import cli
        if u.path == "/api/state":
            return self._json(cli.state())
        if u.path == "/api/session":
            sid = (parse_qs(u.query).get("id") or [""])[0]
            d = cli.detail(sid)
            return self._json(d) if d else self._json({"error": "no such session"}, 404)
        name = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        full = os.path.realpath(os.path.join(UI, name))
        if not full.startswith(UI + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        with open(full, "rb") as f:
            self._send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    def do_POST(self):
        origin = urlparse(self.headers.get("Origin") or "http://localhost").hostname or ""
        if not self._local() or self.headers.get("X-Sinaleiro") != "1" or origin not in {"localhost", "127.0.0.1", "::1"}:
            return self._json({"error": "forbidden"}, 403)
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 65536)) or b"{}")
        except ValueError:
            return self._json({"error": "bad json"}, 400)
        from . import sessions, store
        db = store.connect()
        live = {s["id"]: s for s in sessions.registry()}
        sid = body.get("session", "")
        if self.path == "/api/look":
            s = live.get(sid)
            if not s:
                return self._json({"error": "no such session"}, 404)
            store.set_look(db, s["cwd"], body.get("look") or {})
            return self._json({"ok": True})
        if self.path == "/api/decide":
            path, req, holder, choice = os.path.abspath(body.get("path") or "/"), body.get("requester"), body.get("holder"), body.get("choice")
            if choice not in ("give", "keep", "release") or req not in live or holder not in live:
                return self._json({"error": "bad decision"}, 400)
            store.decide(db, path, req, holder, choice)
            if choice != "keep":
                store.grant(db, path, holder, req if choice == "give" else "*")
            store.event(db, "grant", holder, [req if choice == "give" else "*"], path,
                        {"give": "grant", "release": "release", "keep": "keep"}[choice], "decided on the farm")
            return self._json({"ok": True})
        if self.path in ("/api/release", "/api/grant"):
            if sid not in live:
                return self._json({"error": "no such session"}, 404)
            paths = [os.path.abspath(body["path"])] if body.get("path") else [
                t.path for t in store.touches(db, time.time() - 3600) if t.session == sid and t.kind == "edit"]
            to = body.get("to") if self.path == "/api/grant" else "*"
            if self.path == "/api/grant" and to not in live:
                return self._json({"error": "no such session to hand it to"}, 404)
            for p in paths:
                store.grant(db, p, sid, to)
                store.event(db, "grant", sid, [to], p, "release" if to == "*" else "grant", "from the farm UI")
            return self._json({"ok": True, "n": len(paths)})
        return self._json({"error": "not found"}, 404)


def serve(port: int = 7777) -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"sinaleiro: the farm is at http://localhost:{port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
