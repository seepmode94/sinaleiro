import http.client
import json
import os
import threading
import time

import pytest

from sinaleiro import server

TOKEN = "t" * 32
LAN = "192.168.1.143"


class PhoneHandler(server.Handler):
    """Requests with X-Test-Phone come 'from another device' (in tests everything is loopback)."""

    def _remote(self):
        return self.headers.get("X-Test-Phone") == "1"


@pytest.fixture(autouse=True)
def own_db(tmp_path, monkeypatch):
    monkeypatch.setattr(server.store, "DB_PATH", str(tmp_path / "state.db"))  # phones' sessions: never the real db


def auth():
    a = server.Auth([("wlan0", LAN)], 7777)
    a.token = TOKEN
    return a


@pytest.fixture
def farm():
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), PhoneHandler)
    srv.auth, srv.show_convo, srv.chat = auth(), False, False
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def call(port, method, path, host=f"{LAN}:7777", phone=True, body=None, **headers):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h = {"Host": host, **({"X-Test-Phone": "1"} if phone else {}), **headers}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["Content-Type"] = "application/json"
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    return r.status, r.read(), dict(r.getheaders())


def login(port, token=TOKEN):
    return call(port, "POST", "/api/login", body={"token": token}, **{"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"})


def cookie(port):
    return login(port)[2]["Set-Cookie"].split(";")[0]


def test_the_pc_on_localhost_needs_no_token(farm):
    assert call(farm, "GET", "/sinaleiro.css", host="localhost:7777", phone=False)[0] == 200


def test_a_phone_without_the_token_only_gets_the_way_in(farm):
    st, body, _ = call(farm, "GET", "/")
    assert st == 200 and b"login.js" in body  # the login page, not the farm
    assert call(farm, "GET", "/login.js")[0] == 200
    assert call(farm, "GET", "/sinaleiro.css")[0] == 401
    assert call(farm, "GET", "/api/state")[0] == 401


def test_a_host_that_isnt_ours_is_refused(farm):
    assert call(farm, "GET", "/", host="evil.example:7777")[0] == 403
    assert call(farm, "GET", "/sinaleiro.css", host="evil.example", phone=False)[0] == 403  # DNS rebinding


def test_login_sets_a_cookie_that_opens_the_farm(farm):
    st, _, h = login(farm)
    assert st == 200
    ck = h["Set-Cookie"]
    assert "HttpOnly" in ck and "SameSite=Strict" in ck
    assert TOKEN not in ck  # the cookie is a session of its own, not the link's token
    assert call(farm, "GET", "/sinaleiro.css", Cookie=ck.split(";")[0])[0] == 200


def test_the_link_works_once(farm):
    assert login(farm)[0] == 200
    assert login(farm)[0] == 403  # the QR in a photo or a scrollback is worthless now


def test_an_old_link_is_refused(farm, monkeypatch):
    monkeypatch.setattr(server, "TOKEN_TTL", 0)
    time.sleep(0.01)
    assert login(farm)[0] == 403


def test_a_phone_thrown_out_is_out(farm):
    ck = cookie(farm)
    server.store.phones_forget(server.store.connect())
    assert call(farm, "GET", "/sinaleiro.css", Cookie=ck)[0] == 401


def test_bad_requests_are_refused_not_crashed(farm):
    hdr = {"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"}
    assert login(farm, token="é" * 32)[0] == 403  # not ASCII: no TypeError
    assert call(farm, "POST", "/api/login", body=["not", "an", "object"], **hdr)[0] == 400
    assert call(farm, "GET", "/sinaleiro.css", Cookie="sinaleiro=é")[0] == 401
    c = http.client.HTTPConnection("127.0.0.1", farm, timeout=5)
    c.putrequest("POST", "/api/login", skip_host=True)
    for k, v in {"Host": f"{LAN}:7777", "X-Test-Phone": "1", "Content-Length": "-1", **hdr}.items():
        c.putheader(k, v)
    c.endheaders()
    assert c.getresponse().status == 400


def test_only_private_addresses_for_the_phone():
    assert server._private("192.168.1.143") and server._private("10.0.0.2")
    assert not server._private("8.8.8.8") and not server._private("0.0.0.0") and not server._private("127.0.0.1")
    assert not server._private("evil.example")


def test_a_wrong_token_or_cookie_is_refused(farm):
    assert call(farm, "POST", "/api/login", body={"token": "nope"}, **{"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"})[0] == 403
    assert call(farm, "GET", "/sinaleiro.css", Cookie=f"sinaleiro={'x' * 32}")[0] == 401


def test_actions_need_the_header_and_our_origin(farm):
    ck = cookie(farm)
    body = {"session": "nobody"}
    assert call(farm, "POST", "/api/release", body=body, Cookie=ck, Origin=f"http://{LAN}:7777")[0] == 403  # no header
    assert call(farm, "POST", "/api/release", body=body, Cookie=ck, **{"X-Sinaleiro": "1"})[0] == 403  # no Origin
    assert call(farm, "POST", "/api/release", body=body, Cookie=ck, **{"X-Sinaleiro": "1", "Origin": "http://evil.example"})[0] == 403
    assert call(farm, "POST", "/api/release", body=body, **{"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"})[0] == 403  # no cookie


def test_the_farm_on_the_pc_shows_the_phone_link_and_its_qr(farm):
    st, body, _ = call(farm, "GET", "/api/phone", host="localhost:7777", phone=False)
    d = json.loads(body)
    assert st == 200 and d["lan"] and d["links"][0]["url"].endswith(f"#t={TOKEN}")
    assert d["qr"] is None or d["qr"].startswith("data:image/svg+xml;base64,")


def test_the_phone_never_gets_the_link_back(farm):
    assert call(farm, "GET", "/api/phone", Cookie=cookie(farm))[0] == 403


def test_the_pc_gets_a_fresh_link_once_the_last_was_used(farm):
    login(farm)
    d = json.loads(call(farm, "GET", "/api/phone", host="localhost:7777", phone=False)[1])
    assert not d["links"][0]["url"].endswith(f"#t={TOKEN}")


def test_without_lan_there_is_no_way_in_from_the_phone(farm):
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), PhoneHandler)
    srv.auth, srv.show_convo, srv.chat = None, False, False
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        assert call(port, "GET", "/")[0] == 403  # our LAN address isn't even a known host
        assert call(port, "POST", "/api/login", host="localhost:7777", body={"token": ""}, **{"X-Sinaleiro": "1", "Origin": "http://localhost:7777"})[0] == 403
    finally:
        srv.shutdown()


@pytest.fixture
def chat_farm(monkeypatch):
    from sinaleiro import sessions, tmux
    typed = []
    monkeypatch.setattr(sessions, "registry", lambda: [{"id": "s1", "pid": 11, "name": "um", "cwd": "/tmp"},
                                                         {"id": "s2", "pid": 22, "name": "dois", "cwd": "/tmp"}])
    monkeypatch.setattr(tmux, "pane_of", lambda pid: {11: "%1"}.get(pid))  # only s1 runs in tmux
    monkeypatch.setattr(tmux, "say", lambda pane, text: typed.append((pane, text)) or True)
    monkeypatch.setattr(tmux, "press", lambda pane, key: key in tmux.KEYS and (typed.append((pane, key)) or True))
    monkeypatch.setattr(tmux, "screen", lambda pane: "Do you want to proceed?\n❯ 1. Yes")
    monkeypatch.setattr(server.store, "event", lambda *a, **k: None)
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), PhoneHandler)
    srv.auth, srv.show_convo, srv.chat = auth(), True, True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, typed
    srv.shutdown()


def post_local(port, path, body):
    return call(port, "POST", path, host="localhost:7777", phone=False, body=body,
                **{"X-Sinaleiro": "1", "Origin": "http://localhost:7777"})


def test_the_chat_types_into_the_session_in_tmux(chat_farm):
    srv, typed = chat_farm
    st, body, _ = post_local(srv.server_address[1], "/api/say", {"session": "s1", "text": "faz os testes"})
    assert st == 200 and json.loads(body)["sent"] == ["s1"] and typed == [("%1", "faz os testes")]


def test_the_chat_answers_prompts_only_with_its_keys(chat_farm):
    srv, typed = chat_farm
    port = srv.server_address[1]
    assert post_local(port, "/api/say", {"session": "s1", "key": "1"})[0] == 200
    assert post_local(port, "/api/say", {"session": "s1", "key": "C-c"})[0] == 404
    assert typed == [("%1", "1")]
    st, body, _ = call(port, "GET", "/api/screen?id=s1", host="localhost:7777", phone=False)
    assert st == 200 and "proceed" in json.loads(body)["screen"]


def test_a_session_outside_tmux_and_everyone_at_once(chat_farm):
    srv, typed = chat_farm
    port = srv.server_address[1]
    assert post_local(port, "/api/say", {"session": "s2", "text": "olá"})[0] == 404
    st, body, _ = post_local(port, "/api/say", {"session": "*", "text": "parem"})
    assert st == 200 and json.loads(body)["sent"] == ["s1"]


def test_the_phone_needs_the_token_to_chat(chat_farm):
    srv, typed = chat_farm
    port = srv.server_address[1]
    hdr = {"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"}
    assert call(port, "POST", "/api/say", body={"session": "s1", "text": "rm -rf"}, **hdr)[0] == 403
    assert call(port, "POST", "/api/say", body={"session": "s1", "text": "olá"}, Cookie=cookie(port), **hdr)[0] == 200
    assert typed == [("%1", "olá")]


def test_without_chat_nothing_is_typed(farm):
    st, _, _ = post_local(farm, "/api/say", {"session": "s1", "text": "olá"})
    assert st == 404


def test_spawn_only_under_home(tmp_path, monkeypatch):
    from sinaleiro import tmux
    monkeypatch.setattr(tmux, "_tmux", lambda *a, **k: type("R", (), {"returncode": 0})())
    assert tmux.spawn("/etc") is None
    assert tmux.spawn("~") is not None


def test_spawn_names_a_tmux_session_tmux_accepts(tmp_path, monkeypatch):
    from sinaleiro import tmux
    monkeypatch.setattr(tmux.os.path, "expanduser", lambda p: p.replace("~", str(tmp_path), 1))
    monkeypatch.setattr(tmux, "_tmux", lambda *a, **k: type("R", (), {"returncode": 0})())
    (tmp_path / "um.repo: dois").mkdir()
    name = tmux.spawn(str(tmp_path / "um.repo: dois"))
    assert name.startswith("claude-um-repo-dois-") and "." not in name and ":" not in name


@pytest.fixture
def docs(tmp_path, monkeypatch):
    """A home with Documentos (two folders, a hidden one, a file and a symlink out of it) and a folder outside it."""
    from sinaleiro import tmux
    monkeypatch.setattr(tmux.os.path, "expanduser", lambda p: p.replace("~", str(tmp_path), 1))
    d = tmp_path / "Documentos"
    for p in ("Projects/sinaleiro", "work", ".escondida"):
        (d / p).mkdir(parents=True)
    (d / "nota.md").write_text("x")
    (tmp_path / "fora").mkdir()
    (d / "atalho").symlink_to(tmp_path / "fora")
    return d


def test_folders_start_at_documentos_and_never_leave_it(docs):
    from sinaleiro import tmux
    f = tmux.folders()
    assert f["path"] == str(docs) and f["parent"] is None
    assert f["dirs"] == ["atalho", "Projects", "work"]  # folders only, no hidden ones, no files
    assert tmux.folders(str(docs / "Projects"))["parent"] == str(docs)
    assert tmux.folders(str(docs / "..")) is None
    assert tmux.folders(str(docs / "atalho")) is None  # a symlink out of Documentos stays out
    assert tmux.folders("/etc") is None


def test_the_farm_lists_folders_only_with_the_chat_and_the_token(chat_farm, docs, farm):
    srv, _ = chat_farm
    port = srv.server_address[1]
    st, body, _ = call(port, "GET", "/api/dirs?path=" + str(docs / "Projects"), host="localhost:7777", phone=False)
    assert st == 200 and json.loads(body)["dirs"] == ["sinaleiro"]
    assert call(port, "GET", "/api/dirs?path=/etc", host="localhost:7777", phone=False)[0] == 404
    assert call(port, "GET", "/api/dirs")[0] == 401  # the phone, without the token
    assert call(port, "GET", "/api/dirs", Cookie=cookie(port))[0] == 200
    assert call(farm, "GET", "/api/dirs", host="localhost:7777", phone=False)[0] == 403  # no --chat, no folders


def test_a_terminal_window_only_when_asked_from_the_pc(chat_farm, docs, monkeypatch):
    from sinaleiro import tmux
    srv, _ = chat_farm
    port, wins = srv.server_address[1], []
    monkeypatch.setattr(tmux, "spawn", lambda cwd: "claude-x-1")
    monkeypatch.setattr(tmux, "window", lambda name: wins.append(name) or True)
    st, body, _ = post_local(port, "/api/spawn", {"cwd": str(docs), "window": True})
    assert st == 200 and json.loads(body)["window"] is True and wins == ["claude-x-1"]
    hdr = {"X-Sinaleiro": "1", "Origin": f"http://{LAN}:7777"}
    st, body, _ = call(port, "POST", "/api/spawn", body={"cwd": str(docs), "window": True}, Cookie=cookie(port), **hdr)
    assert st == 200 and json.loads(body)["window"] is False and wins == ["claude-x-1"]  # not from the phone


def test_tty_of_this_process_or_none():
    from sinaleiro import tmux
    t = tmux._tty_of(os.getpid())
    assert t is None or t.startswith("/dev/pts/")
