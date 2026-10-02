import json

import pytest

from sinaleiro import cli, store
from sinaleiro.limits import PER, WINDOW, Sample, family, from_statusline, rates, steps, summary, windows

RESET = 100_000.0
START = RESET - WINDOW


def s(min_after_start, pct, reset=RESET):
    return Sample(START + min_after_start * 60, pct, reset)


def b(min_after_start, fam, n):
    return (START + min_after_start * 60 - 1, fam, n)  # the response lands just before its statusline reading


def test_family():
    assert family("claude-opus-5-5") == "opus"
    assert family("claude-fable-5-1") == "fable"
    assert family("claude-haiku-4-5-20251001") == "haiku"
    assert family("<synthetic>") is None
    assert family(None) is None


def test_windows_split_on_reset():
    ws = windows([s(1, 5), s(2, 7), Sample(START + 400 * 60, 2, RESET + WINDOW)])
    assert [len(w) for w in ws] == [2, 1]


def test_steps_merge_small_rises():
    st = steps([s(0, 10), s(1, 10.3), s(2, 10.6), s(3, 11.2), s(4, 13)])
    assert st[0][2] == pytest.approx(1.2)  # 10 -> 11.2, merged until it rose 1 %
    assert st[-1][2] == pytest.approx(1.8)


def test_learns_a_rate_per_family():
    # opus alone: 100K tokens -> 2 %; fable alone: 100K tokens -> 5 %
    samples = [s(0, 0), s(10, 2), s(20, 4), s(30, 9), s(40, 14)]
    burns = [b(10, "opus", 100_000), b(20, "opus", 100_000), b(30, "fable", 100_000), b(40, "fable", 100_000)]
    r = rates(samples, burns)
    assert r["opus"] * PER == pytest.approx(2)
    assert r["fable"] * PER == pytest.approx(5)


def test_outside_is_the_rise_local_tokens_dont_explain():
    samples = [s(0, 0), s(10, 2), s(20, 4), s(30, 6), s(40, 14)]
    burns = [b(10, "opus", 100_000), b(20, "opus", 100_000), b(30, "opus", 100_000), b(40, "opus", 100_000)]
    out = summary(samples, burns, now=START + 41 * 60)
    assert out["pct"] == 14
    assert out["here"] == pytest.approx(8)  # 4 steps x 2 %
    assert out["outside"] == pytest.approx(6)  # the jump to 14 % was 8 %, only 2 % of it from here
    assert not out["learning"]
    assert out["outside_at"] == pytest.approx(START + 40 * 60)  # the neighbour: spent outside at minute 40
    assert out["outside_recent"] == pytest.approx(6)
    later = summary(samples, burns, now=START + 80 * 60)
    assert later["outside_recent"] == 0 and later["outside_at"] == pytest.approx(START + 40 * 60)  # gone quiet


def test_unknown_family_counts_as_local_while_learning():
    samples = [s(0, 0), s(10, 3)]
    burns = [b(10, "fable", 60_000), b(10, "opus", 50_000)]  # mixed: no family alone, nothing learned
    out = summary(samples, burns, now=START + 11 * 60)
    assert out["here"] == pytest.approx(3) and out["outside"] == 0 and out["learning"]


def test_rise_with_nothing_running_here_is_outside():
    samples = [s(30, 12)]  # first reading already at 12 %, and nothing ran here since the window opened
    out = summary(samples, [], now=START + 31 * 60)
    assert out["outside"] == pytest.approx(12) and out["here"] == 0


def test_pace_and_eta():
    samples = [s(0, 0), s(60, 40), s(90, 60)]
    out = summary(samples, [b(60, "opus", 1), b(90, "opus", 1)], now=START + 90 * 60)
    assert out["per_hour"] == pytest.approx(40)  # 40 % -> 60 % in the last half hour
    assert out["eta"] == pytest.approx(START + 150 * 60)  # 40 % left at 40 %/h: an hour, well before the reset
    slow = summary([s(0, 0), s(60, 10)], [b(60, "opus", 1)], now=START + 60 * 60)
    assert slow["eta"] is None  # at 10 %/h the reset comes first


def test_window_over_starts_at_zero():
    out = summary([s(10, 40)], [], now=RESET + 1)
    assert out["available"] and out["pct"] == 0 and out["resets_at"] is None


def test_no_readings():
    assert summary([], [], now=START) == {"available": False}


def test_from_statusline():
    data = {"rate_limits": {"five_hour": {"used_percentage": 62.5, "resets_at": 1790000000},
                            "seven_day": {"used_percentage": 30, "resets_at": 1790500000}}}
    assert from_statusline(data) == (62.5, 1790000000.0, 30.0, 1790500000.0)
    assert from_statusline({"rate_limits": None}) is None
    assert from_statusline({}) is None


def test_store_keeps_only_readings_that_moved(tmp_path):
    db = store.connect(str(tmp_path / "s.db"))
    assert store.limit(db, 10, RESET, None, None, ts=1000)
    assert not store.limit(db, 10, RESET, None, None, ts=1010)  # same reading, 10 s later
    assert store.limit(db, 11, RESET, None, None, ts=1020)
    assert store.limit(db, 11, RESET, None, None, ts=1200)  # same, but the last one is 3 min old
    assert [r[1] for r in store.limits(db, 0)] == [10, 11, 11]


# ------------------------------------------------------------ install keeps your statusline
@pytest.fixture
def settings(tmp_path, monkeypatch):
    path = tmp_path / "settings.json"
    monkeypatch.setattr(cli, "SETTINGS", str(path))
    monkeypatch.setattr(cli, "PREV_STATUSLINE", str(tmp_path / "statusline.json"))
    monkeypatch.setattr("os.path.expanduser", lambda p: str(tmp_path / "bin" / "sinaleiro") if p.endswith("bin/sinaleiro") else p)
    return path


def test_install_wraps_your_statusline_and_uninstall_puts_it_back(settings, capsys):
    mine = {"type": "command", "command": "~/my-line.sh", "padding": 1}
    settings.write_text(json.dumps({"statusLine": mine, "theme": "dark"}))
    cli.install()
    cfg = json.loads(settings.read_text())
    assert cfg["statusLine"]["command"].endswith("sinaleiro statusline") and cfg["statusLine"]["padding"] == 1
    assert cfg["theme"] == "dark"
    cli.install()  # twice: still yours saved aside, not ours
    assert cli._prev_statusline() == mine
    cli.install(remove=True)
    cfg = json.loads(settings.read_text())
    assert cfg["statusLine"] == mine and "hooks" not in cfg
    assert "my-line" not in capsys.readouterr().out  # never prints your config


def test_install_without_a_statusline_adds_ours_and_uninstall_removes_it(settings):
    settings.write_text("{}")
    cli.install()
    assert json.loads(settings.read_text())["statusLine"]["command"].endswith("sinaleiro statusline")
    cli.install(remove=True)
    assert json.loads(settings.read_text()) == {}


def test_a_dip_stays_in_its_window_and_isnt_counted_twice():
    samples = [s(0, 0), s(10, 40), s(20, 30), s(30, 45)]  # the server corrected 40 -> 30, then 45
    assert len(windows(samples)) == 1
    out = summary(samples, [], now=START + 31 * 60)
    assert out["here"] + out["outside"] == pytest.approx(45)  # not 40 + 15


def test_a_reset_that_drifts_a_little_is_the_same_window():
    assert len(windows([s(0, 1, RESET), s(1, 2, RESET + 60), s(2, 3, RESET - 60)])) == 1
    assert len(windows([s(0, 1, RESET), s(1, 2, RESET + 3600)])) == 2


def test_two_close_readings_dont_make_a_wild_pace():
    out = summary([s(100, 50), s(100.02, 51)], [b(100, "opus", 1)], now=START + 101 * 60)
    assert out["per_hour"] < 100  # 1 % in 1 s is not 3600 %/h


def test_eta_counts_from_now():
    samples = [s(0, 0), s(60, 40), s(90, 60)]
    out = summary(samples, [b(60, "opus", 1), b(90, "opus", 1)], now=START + 100 * 60)
    assert out["eta"] == pytest.approx(START + 160 * 60)  # 40 % left at 40 %/h, an hour from now (not from 90)


def test_a_long_step_teaches_nothing():
    samples = [s(0, 0), s(120, 50)]  # one reading two hours after the start: too mixed to learn from
    assert rates(samples, [b(120, "opus", 100_000)]) == {}


def test_from_statusline_with_odd_values():
    assert from_statusline({"rate_limits": {"five_hour": {"used_percentage": "x", "resets_at": 5}}}) is None
    assert from_statusline({"rate_limits": "nope"}) is None
    v = from_statusline({"rate_limits": {"five_hour": {"used_percentage": 3, "resets_at": 9}, "seven_day": {"used_percentage": [], "resets_at": 1}}})
    assert v == (3.0, 9.0, None, None)
