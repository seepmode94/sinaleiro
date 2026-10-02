"""The farm UI and its feed. By default on 127.0.0.1 only: the page shows your prompts, so it never leaves this machine.

With --lan it also listens on this machine's home-network addresses, for your phone. The QR code (in the terminal,
or on the PC's farm: TELEMÓVEL) opens /#t=<link token>; the page trades it for a session cookie, and from then on that
phone is in for SESSION_TTL. The link token works once and for TOKEN_TTL, so a QR left in a scrollback or a photo is
worthless; the PC only keeps a hash of each phone's cookie (store.phones), and `--new-token` throws every phone out.
The conversations stay on the PC (the phone sees prompts, tools, tokens and the decisions), unless `--show-convo`.

With --chat the farm also talks to the sessions that run inside tmux: it shows their conversation and their screen,
and what you write in the chat is typed into their terminal (see tmux.py). Whoever has the token then commands them.

Actions (POST) need the X-Sinaleiro header and an Origin equal to the Host, so no other web page can make them for you;
a Host that isn't one of our own addresses is refused outright (DNS rebinding). It's plain HTTP: a home network only,
and no tunnel or proxy on this machine in front of it (a request arriving from 127.0.0.1 counts as the PC itself)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import store, tmux

UI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui")
HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
OLD_TOKEN_PATH = os.path.join(os.path.dirname(store.DB_PATH), "token")  # the long-lived token of before: removed
COOKIE = "sinaleiro"
TOKEN_TTL = 15 * 60  # the link in the QR: once, and for this long
SESSION_TTL = 30 * 86400  # a phone that came in stays in for this long
MAX_FAILS = 10  # wrong links per minute before the door closes for a minute
OPEN = {"/login.js"}  # what a phone without the token may load: the page that trades the token for the cookie
SKIP_IFACES = ("lo", "docker", "br-", "virbr", "veth")
mimetypes.add_type("font/ttf", ".ttf")


def _hash(cookie: str) -> str:
    return hashlib.sha256(cookie.encode("utf-8", "replace")).hexdigest()


class Auth:
    """Who may come in from another device: the one-use link token, and the phones that already traded one for a
    session. One per `serve`, shared by the listeners on every address."""

    def __init__(self, lan: list[tuple[str, str]], port: int):
        self.lan, self.port, self.ips = lan, port, {ip for _, ip in lan}
        self.lock, self.fails = threading.Lock(), []
        self._new()

    def _new(self):
        self.token, self.made = secrets.token_urlsafe(24), time.time()

    def link_token(self) -> str:
        """The token to show now (a fresh one when the last is too old or was used)."""
        with self.lock:
            if time.time() - self.made > TOKEN_TTL:
                self._new()
            return self.token

    def links(self) -> list[tuple[str, str]]:
        t = self.link_token()
        return [(iface, f"http://{ip}:{self.port}/#t={t}") for iface, ip in self.lan]

    def trade(self, given: str, agent: str = "") -> str | None:
        """A session cookie for the right link token (which then dies), None otherwise."""
        now = time.time()
        with self.lock:
            self.fails = [t for t in self.fails if now - t < 60]
            ok = len(self.fails) < MAX_FAILS and now - self.made <= TOKEN_TTL and \
                hmac.compare_digest(given.encode("utf-8", "replace"), self.token.encode())
            if not ok:
                self.fails.append(now)
                return None
            self._new()  # one use
        sid = secrets.token_urlsafe(32)
        store.phone_add(store.connect(), _hash(sid), now + SESSION_TTL, agent[:160])
        return sid

    def known(self, cookie: str | None) -> bool:
        return bool(cookie) and store.phone_ok(store.connect(), _hash(cookie), time.time())


def lan_ips() -> list[tuple[str, str]]:
    """(interface, address) for this machine's private IPv4 addresses, Wi-Fi first; no Docker or VM bridges."""
    out = []
    try:
        lines = subprocess.run(["ip", "-4", "-o", "addr", "show"], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        lines = ""
    for line in lines.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[1].startswith(SKIP_IFACES):
            continue
        ip = parts[3].split("/")[0]
        if ipaddress.ip_address(ip).is_private:
            out.append((parts[1], ip))
    return sorted(out, key=lambda x: not x[0].startswith("wl"))


class Handler(BaseHTTPRequestHandler):
    # the server it runs under carries: auth (None when the farm is local only), show_convo, chat
    timeout = 20  # a connection that sends nothing for this long is dropped (no slow-loris on the home network)

    def log_message(self, *a):
        pass

    def _send(self, code: int, body: bytes, ctype: str, headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200, headers: dict | None = None):
        self._send(code, json.dumps(obj).encode(), "application/json", headers)

    def _hostname(self) -> str:
        h = self.headers.get("Host") or ""
        return h[1:h.index("]")] if h.startswith("[") and "]" in h else h.rsplit(":", 1)[0]

    def _remote(self) -> bool:
        """The request comes from another device (the phone), not from this machine."""
        return not ipaddress.ip_address(self.client_address[0]).is_loopback

    def _known_host(self) -> bool:
        """The Host is one of our own addresses (a page on another site pointed at us by DNS rebinding: no)."""
        h, auth = self._hostname(), getattr(self.server, "auth", None)
        return h in HOSTS or bool(auth and h in auth.ips)

    def _authed(self) -> bool:
        if not self._known_host():
            return False
        if not self._remote() and self._hostname() in HOSTS:
            return True  # the PC itself, on localhost
        auth = getattr(self.server, "auth", None)
        try:
            c = SimpleCookie(self.headers.get("Cookie") or "").get(COOKIE)
        except Exception:  # noqa: BLE001 - a cookie header we can't parse is no cookie
            c = None
        return bool(auth and c and auth.known(c.value))

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:  # curl and friends on this machine (sinaleiro's own CLI never posts)
            return not self._remote() and self._hostname() in HOSTS
        return urlparse(origin).netloc == (self.headers.get("Host") or "")

    def _file(self, name: str):
        if "\0" in name:
            return self._send(404, b"not found", "text/plain")
        full = os.path.realpath(os.path.join(UI, name))
        if not full.startswith(UI + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        with open(full, "rb") as f:
            self._send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    def do_GET(self):
        if not self._known_host():
            return self._send(403, b"forbidden", "text/plain")
        u = urlparse(self.path)
        if not self._authed():
            if u.path in OPEN:
                return self._file(u.path.lstrip("/"))
            if u.path in ("/", ""):
                return self._file("login.html")
            return self._send(401, b"sem acesso: le o QR code do terminal", "text/plain; charset=utf-8")
        from . import cli
        if u.path == "/api/state":
            st = cli.state()
            chat = bool(getattr(self.server, "chat", False))
            st["viewer"] = {"remote": self._remote(), "chat": chat,
                            "convo": not self._remote() or bool(getattr(self.server, "show_convo", False))}
            for s in st["sessions"]:
                s["chat"] = bool(chat and tmux.pane_of(s.get("pid") or 0))
            return self._json(st)
        if u.path == "/api/screen":
            pane = self._pane((parse_qs(u.query).get("id") or [""])[0])
            return self._json({"screen": tmux.screen(pane)}) if pane else self._json({"error": "sem chat"}, 404)
        if u.path == "/api/dirs":
            # the folders to walk to a new Claude's: only with the chat on (they're folder names, for the phone too)
            if not getattr(self.server, "chat", False):
                return self._json({"error": "o chat está desligado"}, 403)
            f = tmux.folders((parse_qs(u.query).get("path") or [""])[0])
            return self._json({**f, "root": tmux.browse_root()}) if f else self._json({"error": "pasta fora de alcance"}, 404)
        if u.path == "/api/session":
            sid = (parse_qs(u.query).get("id") or [""])[0]
            d = cli.detail(sid)
            if d and self._remote() and not getattr(self.server, "show_convo", False):
                d["convo"], d["convo_hidden"] = [], True  # the conversation stays on the PC
            return self._json(d) if d else self._json({"error": "no such session"}, 404)
        if u.path == "/api/phone":
            if self._remote():  # the link carries the token: only the PC shows it
                return self._json({"error": "forbidden"}, 403)
            auth = getattr(self.server, "auth", None)
            links = auth.links() if auth else []
            return self._json({"lan": bool(links), "links": [{"iface": i, "url": l} for i, l in links],
                               "qr": _qr_svg(links[0][1]) if links else None, "once": True,
                               "minutes": TOKEN_TTL // 60})
        return self._file("index.html" if u.path in ("/", "", "/login.html") else u.path.lstrip("/"))

    def _pane(self, sid: str) -> str | None:
        """The tmux pane of a live session, when the chat is on (None otherwise)."""
        if not getattr(self.server, "chat", False):
            return None
        from . import sessions
        s = next((x for x in sessions.registry() if x["id"] == sid), None)
        return tmux.pane_of(s["pid"]) if s else None

    def do_POST(self):
        if not self._known_host() or self.headers.get("X-Sinaleiro") != "1" or not self._same_origin():
            return self._json({"error": "forbidden"}, 403)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 <= n <= 65536:
                raise ValueError
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json({"error": "bad request"}, 400)
        if self.path == "/api/login":
            auth = getattr(self.server, "auth", None)
            sid = auth.trade(str(body.get("token") or ""), self.headers.get("User-Agent") or "") if auth else None
            if not sid:
                time.sleep(1)  # no hurry for wrong guesses
                return self._json({"error": "link inválido ou já usado"}, 403)
            return self._json({"ok": True}, headers={
                "Set-Cookie": f"{COOKIE}={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}"})
        if not self._authed():
            return self._json({"error": "forbidden"}, 403)
        from . import sessions
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
                        {"give": "grant", "release": "release", "keep": "keep"}[choice],
                        "decided on the phone" if self._remote() else "decided on the farm")
            return self._json({"ok": True})
        if self.path == "/api/say":
            # to one session, or "*" for every one in the chat; text is a prompt, key one of the prompt buttons
            text, key = str(body.get("text") or ""), str(body.get("key") or "")
            targets = [x for x in live if self._pane(x)] if sid == "*" else [sid]
            sent = []
            for t in targets:
                pane = self._pane(t)
                if pane and (tmux.say(pane, text) if text else tmux.press(pane, key)):
                    sent.append(t)
                    store.event(db, "say", t, [], "", "say" if text else "key",
                                (text[:200] if text else key) + (" · do telemóvel" if self._remote() else ""))
            if not sent:
                return self._json({"error": "nenhuma sessão recebeu (está no tmux? o chat está ligado?)"}, 404)
            return self._json({"ok": True, "sent": sent})
        if self.path == "/api/spawn":
            if not getattr(self.server, "chat", False):
                return self._json({"error": "o chat está desligado"}, 403)
            name = tmux.spawn(str(body.get("cwd") or ""))
            if not name:
                return self._json({"error": "não consegui abrir um Claude nessa pasta"}, 400)
            store.event(db, "say", "", [], os.path.realpath(os.path.expanduser(body["cwd"])), "spawn",
                        name + (" · do telemóvel" if self._remote() else ""))
            # a terminal window on the PC's screen too, when asked from the PC (never from the phone)
            win = bool(body.get("window")) and not self._remote() and tmux.window(name)
            return self._json({"ok": True, "tmux": name, "window": win})
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
        if self.path == "/api/close":
            # only the pane of a live session in the registry: never a pane named by the request
            pane = self._pane(sid) if sid in live else None
            if not pane:
                return self._json({"error": "essa sessão não está no tmux (ou o chat está desligado)"}, 404)
            if not tmux.close(pane):
                return self._json({"error": "não consegui fechar o terminal"}, 500)
            store.event(db, "say", sid, [], live[sid]["cwd"], "close",
                        live[sid]["name"] + (" · do telemóvel" if self._remote() else ""))
            return self._json({"ok": True})
        return self._json({"error": "not found"}, 404)


def _private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private and not ip.is_loopback and not ip.is_unspecified


def _qr(text: str) -> str:
    """The link as a QR code for the terminal, if this machine can draw one (qrencode, or python's qrcode)."""
    if shutil.which("qrencode"):
        try:
            return subprocess.run(["qrencode", "-t", "ANSIUTF8", "-m", "2", text], capture_output=True, text=True,
                                  timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        import io

        import qrcode  # type: ignore
        q, buf = qrcode.QRCode(border=2), io.StringIO()
        q.add_data(text)
        q.print_ascii(out=buf, invert=True)
        return buf.getvalue()
    except Exception:  # noqa: BLE001 - no QR, the link is printed anyway
        return ""


def _qr_svg(text: str) -> str | None:
    """The link as a QR code for the farm page (a data: URI of an SVG), if this machine can draw one."""
    svg = b""
    if shutil.which("qrencode"):
        try:
            svg = subprocess.run(["qrencode", "-t", "SVG", "-m", "2", "-o", "-", text], capture_output=True,
                                 timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            pass
    if not svg:
        try:
            import io

            import qrcode  # type: ignore
            import qrcode.image.svg  # type: ignore
            buf = io.BytesIO()
            qrcode.make(text, image_factory=qrcode.image.svg.SvgPathFillImage, border=2).save(buf)
            svg = buf.getvalue()
        except Exception:  # noqa: BLE001 - no QR, the page shows the link anyway
            return None
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode()


def _server(addr: str, port: int, auth: Auth | None, show_convo: bool, chat: bool = False) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer((addr, port), Handler)
    srv.auth, srv.show_convo, srv.chat = auth, show_convo or chat, chat
    return srv


def serve(port: int = 7777, lan: bool = False, host: str | None = None, new_token: bool = False,
          show_convo: bool = False, chat: bool = False) -> int:
    ips: list[tuple[str, str]] = []
    if lan:
        if host and not _private(host):
            print(f"sinaleiro: {host} isn't a private home-network address; the farm only goes on those.")
            return 2
        ips = [("", host)] if host else lan_ips()
        if not ips:
            print("sinaleiro: no home-network address found; the farm stays on this machine.")
    if os.path.exists(OLD_TOKEN_PATH):
        os.remove(OLD_TOKEN_PATH)  # the old long-lived token: its link must stop working
    if new_token:
        n = store.phones_forget(store.connect())
        print(f"sinaleiro: {n} phone(s) thrown out; they need a new QR code.")
    auth = Auth(ips, port) if ips else None
    links = auth.links() if auth else []
    servers = [_server(a, port, auth, show_convo, chat) for a in ["127.0.0.1", *(ip for _, ip in ips)]]
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"sinaleiro: the farm is at http://localhost:{port}")
    if ips:
        first = links[0][1]
        print(f"\nOn your phone (same Wi-Fi), read the QR code (here, or on the farm: TELEMÓVEL) or open:\n  {first}")
        for iface, link in links[1:]:
            print(f"  or, on {iface}: {link}")
        qr = _qr(first)
        if qr:
            print(qr)
        print(f"This link works once, for {TOKEN_TTL // 60} min: a fresh one any time on the farm here (TELEMÓVEL)."
              f"\nA phone that came in stays in for {SESSION_TTL // 86400} days. Throw every phone out:"
              "\n  sinaleiro serve --lan --new-token")
        print("Conversations stay on this PC." if not (show_convo or chat) else "Conversations are shown on the phone too.")
    if chat:
        print("CHAT ON: whoever has the farm's link can type into every Claude that runs in tmux (and answer its"
              " permission prompts)." + ("" if shutil.which("tmux") else "\n  ...but tmux isn't installed."))
    sys.stdout.flush()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
