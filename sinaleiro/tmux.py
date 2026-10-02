"""The farm's chat: a session that runs inside tmux can be read and typed into from the farm (`serve --chat`).

A Claude in a plain terminal can't be reached from outside (the kernel no longer lets one process type into another's
terminal), but inside tmux it's a pane: `capture-pane` shows its screen, `paste-buffer` + Enter types a prompt, exactly
as if it came from the keyboard. We find the pane by the tty the session's process is on."""

from __future__ import annotations

import os
import shutil
import subprocess
import time

KEYS = {"1", "2", "3", "Enter", "Escape", "Up", "Down", "Tab"}  # what the chat's buttons may press
MAX_TEXT = 8000
_panes: tuple[float, dict[str, str]] = (0.0, {})


def _tmux(*args: str, data: bytes | None = None) -> subprocess.CompletedProcess | None:
    exe = shutil.which("tmux")
    if not exe:
        return None
    try:
        return subprocess.run([exe, *args], input=data, capture_output=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None


def _tty_of(pid: int) -> str | None:
    """/dev/pts/N for the process, from its controlling terminal number in /proc."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            tty_nr = int(f.read().rsplit(")", 1)[1].split()[4])
    except (OSError, IndexError, ValueError):
        return None
    major, minor = (tty_nr >> 8) & 0xFFF, (tty_nr & 0xFF) | ((tty_nr >> 12) & 0xFFF00)
    return f"/dev/pts/{minor}" if 136 <= major <= 143 else None


def panes() -> dict[str, str]:
    """{tty: pane id} of every tmux pane on this machine (cached for 2 s; empty without tmux)."""
    global _panes
    if time.time() - _panes[0] < 2:
        return _panes[1]
    r = _tmux("list-panes", "-a", "-F", "#{pane_tty}\t#{pane_id}")
    out = {}
    if r and r.returncode == 0:
        for line in r.stdout.decode(errors="replace").splitlines():
            tty, _, pane = line.partition("\t")
            if tty and pane:
                out[tty] = pane
    _panes = (time.time(), out)
    return out


def pane_of(pid: int) -> str | None:
    tty = _tty_of(pid)
    return panes().get(tty) if tty else None


def screen(pane: str, lines: int = 40) -> str:
    """What the pane shows now (the last `lines` lines, trailing blanks dropped): the permission prompts live here."""
    r = _tmux("capture-pane", "-p", "-J", "-t", pane, "-S", f"-{lines}")
    if not r or r.returncode:
        return ""
    return "\n".join(r.stdout.decode(errors="replace").rstrip().splitlines()[-lines:])


def say(pane: str, text: str) -> bool:
    """Type `text` into the pane as one paste (several lines stay one prompt) and press Enter."""
    text = text.replace("\r\n", "\n").strip()
    if not text or len(text) > MAX_TEXT:
        return False
    buf = f"sinaleiro-{os.getpid()}"
    r = _tmux("load-buffer", "-b", buf, "-", data=text.encode())
    if not r or r.returncode:
        return False
    r = _tmux("paste-buffer", "-d", "-p", "-b", buf, "-t", pane)
    if not r or r.returncode:
        return False
    time.sleep(0.15)  # let the paste land before the Enter
    return press(pane, "Enter")


def spawn(cwd: str) -> str | None:
    """A new Claude in its own detached tmux session, in `cwd` (a folder under your home): the tmux session's name."""
    home = os.path.realpath(os.path.expanduser("~"))
    cwd = os.path.realpath(os.path.expanduser(cwd))
    if not os.path.isdir(cwd) or not (cwd + os.sep).startswith(home + os.sep):
        return None
    name = f"claude-{os.path.basename(cwd) or 'home'}-{int(time.time()) % 100000}"
    r = _tmux("new-session", "-d", "-s", name, "-c", cwd, "claude")
    return name if r and r.returncode == 0 else None


def press(pane: str, key: str) -> bool:
    if key not in KEYS:
        return False
    r = _tmux("send-keys", "-t", pane, key)
    return bool(r and r.returncode == 0)
