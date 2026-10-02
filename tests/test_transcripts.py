import json

from sinaleiro.transcripts import Transcript


def line(mid, out, ts="2026-10-02T10:00:00Z", model="claude-opus-5-5", side=False):
    return json.dumps({"type": "assistant", "timestamp": ts, "isSidechain": side, "message": {
        "id": mid, "model": model, "content": [],
        "usage": {"input_tokens": 10, "output_tokens": out, "cache_creation_input_tokens": 100, "cache_read_input_tokens": 9999}}})


def test_a_reply_counts_its_final_output_once(tmp_path):
    p = tmp_path / "s.jsonl"
    # the same reply on three lines (one per content block): the first two with a provisional output count
    p.write_text("\n".join([line("m1", 1), line("m1", 1), line("m1", 429), line("m2", 5)]) + "\n")
    t = Transcript(str(p))
    t.update()
    assert sum(t.tokens.values()) == (10 + 429 + 100) + (10 + 5 + 100)  # cache reads don't count
    assert sorted(b[2] for b in t.burns.values()) == [115, 539]
    assert {b[1] for b in t.burns.values()} == {"opus"}


def test_a_later_line_of_the_same_reply_in_the_next_read(tmp_path):
    p = tmp_path / "s.jsonl"
    p.write_text(line("m1", 1) + "\n")
    t = Transcript(str(p))
    t.update()
    with open(p, "a") as f:
        f.write(line("m1", 300) + "\n")
    t.update()
    assert sum(t.tokens.values()) == 410 and len(t.burns) == 1


def test_sub_agents_lines_count_too(tmp_path):
    p = tmp_path / "agent.jsonl"
    p.write_text(line("m1", 50, side=True, model="claude-fable-5-1") + "\n")
    t = Transcript(str(p))
    t.update()
    assert list(t.burns.values())[0][1:] == ("fable", 160)
