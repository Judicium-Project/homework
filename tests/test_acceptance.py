"""Acceptance runner: G45-3 (cache hit) and KABUL A4 (no-cache evidence in the log)."""

from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

import pytest

from conftest import FIXTURES, commit_all, init_repo
from helpers import check, findings
from homework.adapters.acceptance import force_no_cache, parse_command
from homework.models import ToolError


def _contract(tmp: Path, acceptance: list[str], generated_by: str = "") -> Path:
    body = 'version = 1\nallowed_paths = ["**"]\n'
    body += f"generated_by = {generated_by!r}\n" if generated_by else ""
    body += "acceptance = [" + ", ".join(repr(a) for a in acceptance) + "]\n"
    path = tmp / "contract.toml"
    path.write_text(body)
    return path


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "repo")
    (repo / "README").write_text("x\n")
    commit_all(repo)
    return repo


def _fake_bin(tmp: Path, name: str, script: str) -> Path:
    bindir = tmp / "bin"
    bindir.mkdir(exist_ok=True)
    exe = bindir / name
    exe.write_text("#!/bin/sh\n" + script + "\n")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return bindir


def test_g45_3_cache_hit_in_synthetic_moon_log(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    log = tmp_path / "run-cached.log"
    shutil.copy(FIXTURES / "g45" / "run-cached.log", log)
    code, report = check(repo, _contract(tmp_path, [f"cat {log}"]), tmp_path / "out", run=True)
    assert code == 1
    assert findings(report, "acceptance-cache-hit")
    assert report["acceptance_runs"][0]["cache_hit"] is True


def test_g45_3_uncached_output_is_clean(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    log = tmp_path / "run-fresh.log"
    log.write_text(
        "\n".join(
            line for line in (FIXTURES / "g45" / "run-cached.log").read_text().splitlines() if "cached" not in line
        )
        + "\nTasks: 9 completed\n"
    )
    code, report = check(repo, _contract(tmp_path, [f"cat {log}"]), tmp_path / "out", run=True)
    assert report["findings"] == []
    assert code == 0


def test_a4_log_shows_force_and_count(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path)
    echo = 'echo "$0 $*"; echo "MOON_CACHE=$MOON_CACHE TURBO_FORCE=$TURBO_FORCE GOFLAGS=$GOFLAGS"'
    for tool in ("moon", "turbo", "go"):
        bindir = _fake_bin(tmp_path, tool, echo)
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.delenv("GOFLAGS", raising=False)
    contract = _contract(tmp_path, ["moon run :lint :test", "turbo run build -- --x", "go test ./..."])
    code, report = check(repo, contract, tmp_path / "out", run=True)
    assert code == 0, report["findings"]
    text = (tmp_path / "out" / "acceptance.log").read_text()
    assert "# argv: moon run :lint :test --force" in text
    assert "# argv: turbo run build --force -- --x" in text
    assert "# argv: go test -count=1 ./..." in text
    assert "MOON_CACHE=off TURBO_FORCE=true GOFLAGS=-count=1" in text  # env reached the process


def test_failed_command_is_a_finding(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    code, report = check(repo, _contract(tmp_path, ["false", "true"]), tmp_path / "out", run=True)
    assert code == 1
    assert [f["evidence"] is not None for f in findings(report, "acceptance-failed")] == [True]


def test_cd_and_chain(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "sub").mkdir()
    (repo / "sub" / "f.txt").write_text("hello\n")
    code, _ = check(
        repo, _contract(tmp_path, ["cd sub && cat f.txt && grep -q hello f.txt"]), tmp_path / "out", run=True
    )
    assert code == 0


def test_no_run_skips(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    code, report = check(repo, _contract(tmp_path, ["false"]), tmp_path / "out", run=False)
    assert code == 3
    assert {a["name"]: a["status"] for a in report["adapters"]}["acceptance"] == "skipped"


def test_generated_drift(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path)
    bindir = _fake_bin(tmp_path, "gen", "echo regenerated > out.gen.ts")
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    code, report = check(repo, _contract(tmp_path, [], generated_by="gen"), tmp_path / "out", run=True)
    assert code == 1
    assert "out.gen.ts" in findings(report, "generated-drift")[0]["evidence"]


def test_missing_executable_is_tool_error(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    with pytest.raises(ToolError, match="executable missing"):
        check(repo, _contract(tmp_path, ["definitely-not-a-real-binary-xyz"]), tmp_path / "out", run=True)


@pytest.mark.parametrize(
    "cmd", ["a | b", "a; b", "a > f", "a || b", "a & b", "$(a)", "a `b`", "echo $HOME", "echo ${X}", "a &&"]
)
def test_shell_syntax_rejected(cmd: str) -> None:
    with pytest.raises(ToolError):
        parse_command(cmd)


def test_parse_env_prefix_and_cd() -> None:
    steps = parse_command('cd services/x && FOO=1 go test ./... && grep -n "a b" f')
    assert steps[0].cd == "services/x"
    assert steps[1].env == {"FOO": "1"} and steps[1].argv == ["go", "test", "./..."]
    assert steps[2].argv == ["grep", "-n", "a b", "f"]


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["pnpm", "turbo", "run", "lint"], ["pnpm", "turbo", "run", "lint", "--force"]),
        (["moon", "run", ":test", "--force"], ["moon", "run", ":test", "--force"]),
        (["go", "test", "-count=3", "./..."], ["go", "test", "-count=3", "./..."]),
        (["go", "build", "./..."], ["go", "build", "./..."]),
        (["pnpm", "test"], ["pnpm", "test"]),
    ],
)
def test_force_no_cache(argv: list[str], expected: list[str]) -> None:
    assert force_no_cache(argv) == expected
