"""Regex input limits and assertion counting (review finding K)."""

from __future__ import annotations

from pathlib import Path

from conftest import commit_all, init_repo
from helpers import check, findings


def test_overlong_line_scanned_in_windows_and_warned(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.ts").write_text("x\n")
    commit_all(repo)
    # The pattern sits deep inside a 20k line and straddles a 4096 window boundary.
    long_line = "a" * 4090 + "FORBIDDEN" + "a" * 16_000
    (repo / "a.ts").write_text("x\n" + long_line + "\nFORBIDDEN\n")
    (tmp_path / "c.toml").write_text(
        'version = 1\nallowed_paths = ["**"]\n[forbidden]\npatterns = [{ regex = "FORBIDDEN" }]\n'
    )
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert [f["line"] for f in findings(report, "forbidden-pattern")] == [2, 3]
    warned = findings(report, "line-too-long")
    assert len(warned) == 1 and warned[0]["severity"] == "warning" and warned[0]["line"] == 2
    assert code == 1


def test_overlong_line_without_match_still_fails(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.ts").write_text("x\n")
    commit_all(repo)
    (repo / "a.ts").write_text("x\n" + "b" * 20_000 + "\n")
    (tmp_path / "c.toml").write_text(
        'version = 1\nallowed_paths = ["**"]\n[forbidden]\npatterns = [{ regex = "FORBIDDEN" }]\n'
    )
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert findings(report, "forbidden-pattern") == [] and code == 1


def test_expect_in_comment_or_string_is_not_an_assertion(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.test.ts").write_text("it('x', () => {\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n")
    commit_all(repo)
    (repo / "a.test.ts").write_text(
        "it('x', () => {\n  foo(); // expect(a).toBe(1);\n  log(\"expect(b).toBe(2)\"); /* assert(x) */\n});\n"
    )
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    red = findings(report, "assertions-reduced")
    assert len(red) == 1 and red[0]["evidence"] == "-2 +0"
