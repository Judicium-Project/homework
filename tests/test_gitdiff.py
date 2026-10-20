"""Diff collection against real git (review findings B, D, G)."""

from __future__ import annotations

from pathlib import Path

import pytest

from conftest import commit_all, init_repo, sh
from helpers import check, findings
from homework.gitdiff import collect

LS = chr(0x2028)  # U+2028 LINE SEPARATOR
NASTY = ['q"uote.ts', "back\\slash.ts", "tab\there.ts", "ünï cödé.ts", "sp ace.ts", 'a/b c/"d" e.ts']


@pytest.mark.parametrize("head_mode", [False, True])
def test_quoted_paths_keep_added_lines(tmp_path: Path, head_mode: bool) -> None:
    repo = init_repo(tmp_path / "r")
    for name in NASTY:
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text("one\n")
    (repo / 'gone "x".ts').write_text("bye\n")
    base = commit_all(repo)
    for name in NASTY:
        (repo / name).write_text("one\nwindow.__x = 1;\n")
    (repo / 'gone "x".ts').unlink()
    head = commit_all(repo, "head") if head_mode else None
    files = collect(repo, base, head).by_path()
    for name in NASTY:
        assert files[name].added == {2: "window.__x = 1;"}, name
    assert files['gone "x".ts'].removed == ["bye"]


def test_quoted_path_rule_finding(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / 'q"t.ts').write_text("export const a = 1;\n")
    commit_all(repo)
    (repo / 'q"t.ts').write_text("export const a = 1;\nwindow.__hook = 1;\n")
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert [f["line"] for f in findings(report, "window-dunder-assign")] == [2]


def test_untracked_lines_split_on_newline_only(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    base = commit_all(repo)
    (repo / "n.ts").write_text(f"a\x0cb{LS}c\rd\nline2\n", newline="")
    assert collect(repo, base, None).by_path()["n.ts"].added == {1: f"a\x0cb{LS}c\rd", 2: "line2"}


def test_binary_looking_file_is_diffed_as_text(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "x.ts").write_bytes(b"\0\n")
    base = commit_all(repo)
    (repo / "x.ts").write_bytes(b"\0\nwindow.__x = 1;\n")
    assert collect(repo, base, None).by_path()["x.ts"].added == {2: "window.__x = 1;"}


def test_textconv_is_ignored(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    sh(repo, "git", "config", "diff.hide.textconv", "true")
    (repo / ".gitattributes").write_text("*.ts diff=hide\n")
    (repo / "x.ts").write_text("a\n")
    base = commit_all(repo)
    (repo / "x.ts").write_text("a\nwindow.__x = 1;\n")
    assert collect(repo, base, None).by_path()["x.ts"].added == {2: "window.__x = 1;"}


def _contract(tmp: Path) -> Path:
    (tmp / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    return tmp / "c.toml"


def test_gitattributes_change_is_a_finding(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (repo / "sub").mkdir()
    (repo / "sub/.gitattributes").write_text("*.ts -diff\n")
    code, report = check(repo, _contract(tmp_path), tmp_path / "out")
    assert code == 1 and [f["file"] for f in findings(report, "gitattributes-modified")] == ["sub/.gitattributes"]


@pytest.mark.parametrize("flag", ["--skip-worktree", "--assume-unchanged"])
def test_hidden_index_flags_are_findings(tmp_path: Path, flag: str) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.ts").write_text("a\n")
    commit_all(repo)
    sh(repo, "git", "update-index", flag, "a.ts")
    (repo / "a.ts").write_text("a\nwindow.__x = 1;\n")
    code, report = check(repo, _contract(tmp_path), tmp_path / "out")
    assert code == 1
    assert [f["file"] for f in findings(report, "index-flag-hidden")] == ["a.ts"]


def test_ignored_new_files_are_listed_as_info(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / ".gitignore").write_text("*.log\n")
    commit_all(repo)
    (repo / "debug.log").write_text("x\n")
    code, report = check(repo, _contract(tmp_path), tmp_path / "out")
    ign = findings(report, "ignored-files")
    assert code == 3 and len(ign) == 1 and ign[0]["severity"] == "info" and "debug.log" in ign[0]["evidence"]


def test_type_change_counts_two_patch_sections(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.ts").write_text("a\n")
    (repo / "b.ts").write_text("b\n")
    base = commit_all(repo)
    (repo / "a.ts").unlink()
    (repo / "a.ts").symlink_to("b.ts")
    (repo / "b.ts").write_text("b\nwindow.__x = 1;\n")
    files = collect(repo, base, None).by_path()
    assert files["a.ts"].status == "T" and files["a.ts"].added == {1: "b.ts"}
    assert files["b.ts"].added == {2: "window.__x = 1;"}
