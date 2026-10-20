"""Robustness against hostile or malformed input (review finding C): never crash, never leave stale output."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

import homework.cli as cli
from conftest import GIT_ID, commit_all, init_repo, sh
from helpers import check, findings
from homework.cli import app
from homework.models import ToolError

runner = CliRunner()


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    return repo


def test_unexpected_exception_is_exit_2_with_traceback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**_: object) -> None:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(cli, "run_check", boom)
    result = runner.invoke(app, ["check", "--repo", str(_repo(tmp_path)), "--base", "HEAD"])
    assert result.exit_code == 2
    assert "Traceback" in result.output and "kaboom" in result.output


def test_stale_outputs_removed_at_start(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    out = tmp_path / "o"
    out.mkdir()
    for name in ("report.json", "fix-round.md", "acceptance.log"):
        (out / name).write_text('{"status": "pass"}')
    (tmp_path / "bad.toml").write_text("version = 1\nnope = 1\n")
    result = runner.invoke(
        app,
        ["check", "--repo", str(repo), "--base", "HEAD", "--contract", str(tmp_path / "bad.toml"), "--out", str(out)],
    )
    assert result.exit_code == 2
    assert not any((out / n).exists() for n in ("report.json", "fix-round.md", "acceptance.log"))


@pytest.mark.parametrize("deps", [5, ["left-pad"], "x", None, {"a": 1}])
def test_package_json_wrong_types_do_not_crash(tmp_path: Path, deps: object) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "package.json").write_text(json.dumps({"name": "x", "dependencies": {"a": "1"}}))
    commit_all(repo)
    (repo / "package.json").write_text(json.dumps({"name": "x", "dependencies": deps, "devDependencies": 3}))
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert code == 1
    if not isinstance(deps, dict):
        assert findings(report, "package-json-invalid")


def test_package_json_not_an_object(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "package.json").write_text("{}")
    commit_all(repo)
    (repo / "package.json").write_text("[1, 2]")
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert code == 1 and findings(report, "package-json-invalid")


@pytest.mark.parametrize("glob", ["src/[z-a]", "src/[]x"])
def test_bad_glob_is_tool_error(tmp_path: Path, glob: str) -> None:
    repo = _repo(tmp_path)
    (repo / "a.txt").write_text("b\n")
    (tmp_path / "c.toml").write_text(f"version = 1\nallowed_paths = [{json.dumps(glob)}]\n")
    with pytest.raises(ToolError, match="glob"):
        check(repo, tmp_path / "c.toml", tmp_path / "out")


def _commit_tree(repo: Path, entries: list[tuple[bytes, bytes]], parent: str | None) -> str:
    lines = b""
    for name, content in entries:
        blob = subprocess.run(
            ["git", "hash-object", "-w", "--stdin"], cwd=repo, input=content, capture_output=True, check=True
        ).stdout.strip()
        lines += b"100644 blob " + blob + b"\t" + name + b"\0"
    tree = subprocess.run(["git", "mktree", "-z"], cwd=repo, input=lines, capture_output=True, check=True)
    args = ["git", *GIT_ID, "commit-tree", tree.stdout.decode().strip(), "-m", "x"]
    if parent:
        args += ["-p", parent]
    return sh(repo, *args).strip()


def test_non_utf8_path_is_handled(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    base = _commit_tree(repo, [(b"a.txt", b"a\n")], None)
    head = _commit_tree(repo, [(b"a.txt", b"a\n"), (b"bad-\xff\xfe.txt", b"hello\nworld\n")], base)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["a.txt"]\n')
    out = tmp_path / "out"
    result = runner.invoke(
        app,
        [
            "check",
            "--repo",
            str(repo),
            "--base",
            base,
            "--head",
            head,
            "--contract",
            str(tmp_path / "c.toml"),
            "--out",
            str(out),
        ],
    )
    assert result.exit_code == 1, result.output
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    oos = findings(report, "out-of-scope")
    assert len(oos) == 1 and oos[0]["file"].startswith("bad-")
