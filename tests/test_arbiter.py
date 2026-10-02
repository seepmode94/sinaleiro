import os

import pytest

from sinaleiro.arbiter import Grant, Touch, component_of, decide, repo_root, target_path

NOW = 10_000.0


@pytest.fixture
def repo(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "lib" / "auth").mkdir(parents=True)
    (tmp_path / "lib" / "ui").mkdir(parents=True)
    return str(tmp_path)


def t(repo, session, rel, kind, ago=30):
    p = os.path.join(repo, rel)
    return Touch(session, p, kind, NOW - ago, repo, component_of(p, repo))


def f(repo, rel):
    return os.path.join(repo, rel)


def test_repo_root_and_component(repo):
    p = f(repo, "lib/auth/login.dart")
    assert repo_root(p) == repo
    assert component_of(p, repo) == "lib/auth"
    assert component_of(f(repo, "README.md"), repo) == "."


def test_alone_is_green(repo):
    v = decide("A", f(repo, "lib/auth/login.dart"), "edit", [t(repo, "A", "lib/auth/login.dart", "edit")], [], {"A"}, NOW)
    assert v.light == "green"


def test_someone_editing_the_same_file_is_red_for_an_edit(repo):
    ts = [t(repo, "B", "lib/auth/login.dart", "edit")]
    v = decide("A", f(repo, "lib/auth/login.dart"), "edit", ts, [], {"A", "B"}, NOW, names={"B": "luxury-1e"})
    assert v.light == "red" and v.holder == "B"
    assert "SendMessage" in v.reason and "luxury-1e" in v.reason


def test_reads_are_never_refused(repo):
    ts = [t(repo, "B", "lib/auth/login.dart", "edit")]
    v = decide("A", f(repo, "lib/auth/login.dart"), "read", ts, [], {"A", "B"}, NOW)
    assert v.light == "yellow" and "may change" in v.reason


def test_same_component_is_yellow(repo):
    ts = [t(repo, "B", "lib/auth/session.dart", "edit")]
    v = decide("A", f(repo, "lib/auth/login.dart"), "edit", ts, [], {"A", "B"}, NOW)
    assert v.light == "yellow" and v.others == ["B"]


def test_someone_reading_what_i_edit_is_yellow(repo):
    ts = [t(repo, "B", "lib/auth/login.dart", "read")]
    assert decide("A", f(repo, "lib/auth/login.dart"), "edit", ts, [], {"A", "B"}, NOW).light == "yellow"


def test_other_component_is_green(repo):
    ts = [t(repo, "B", "lib/ui/button.dart", "edit")]
    assert decide("A", f(repo, "lib/auth/login.dart"), "edit", ts, [], {"A", "B"}, NOW).light == "green"


def test_dead_sessions_and_stale_claims_dont_count(repo):
    ts = [t(repo, "B", "lib/auth/login.dart", "edit"), t(repo, "C", "lib/auth/login.dart", "edit", ago=3600)]
    assert decide("A", f(repo, "lib/auth/login.dart"), "edit", ts, [], {"A", "C"}, NOW).light == "green"


def test_a_grant_after_the_last_edit_lets_me_in(repo):
    p = f(repo, "lib/auth/login.dart")
    ts = [t(repo, "B", "lib/auth/login.dart", "edit", ago=60)]
    v = decide("A", p, "edit", ts, [Grant(p, "B", "A", NOW - 10)], {"A", "B"}, NOW)
    assert v.light == "yellow"  # still a neighbour, but no longer in the way


def test_a_grant_to_someone_else_doesnt(repo):
    p = f(repo, "lib/auth/login.dart")
    ts = [t(repo, "B", "lib/auth/login.dart", "edit", ago=60)]
    assert decide("A", p, "edit", ts, [Grant(p, "B", "C", NOW - 10)], {"A", "B"}, NOW).light == "red"


def test_release_lets_anyone_in(repo):
    p = f(repo, "lib/auth/login.dart")
    ts = [t(repo, "B", "lib/auth/login.dart", "edit", ago=60)]
    assert decide("A", p, "edit", ts, [Grant(p, "B", "*", NOW - 10)], {"A", "B"}, NOW).light == "yellow"


def test_editing_again_after_a_grant_takes_it_back(repo):
    p = f(repo, "lib/auth/login.dart")
    ts = [t(repo, "B", "lib/auth/login.dart", "edit", ago=5)]  # B edited after handing it over
    assert decide("A", p, "edit", ts, [Grant(p, "B", "A", NOW - 60)], {"A", "B"}, NOW).light == "red"


def test_target_path():
    assert target_path({"file_path": "/x/y.py"}) == "/x/y.py"
    assert target_path({"notebook_path": "/x/n.ipynb"}) == "/x/n.ipynb"
    assert target_path({"command": "ls"}) is None
