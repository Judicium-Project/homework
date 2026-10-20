"""Acceptance process handling: timeouts, process groups, output caps, partial results (review finding I)."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from conftest import commit_all, init_repo
from helpers import findings
from homework.cli import run_check
from homework.models import ToolError


def _setup(tmp: Path, monkeypatch: pytest.MonkeyPatch, script: str, acceptance: str = "agent-test") -> Path:
    bindir = tmp / "bin"
    bindir.mkdir()
    exe = bindir / "agent-test"
    exe.write_text("#!/bin/sh\n" + script + "\n")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    repo = init_repo(tmp / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (repo / "outside.txt").write_text("scope creep\n")
    (tmp / "c.toml").write_text(f'version = 1\nallowed_paths = ["a.txt"]\nacceptance = ["{acceptance}"]\n')
    return repo


def _run(repo: Path, tmp: Path, timeout: float = 60) -> tuple:  # type: ignore[type-arg]
    return run_check(
        repo=repo,
        base="HEAD",
        head=None,
        contract=str(tmp / "c.toml"),
        task=None,
        out=tmp / "out",
        run_acceptance=True,
        with_agentdiff=False,
        timeout=timeout,
    )


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_timeout_is_a_finding_and_kills_the_process_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pidfile = tmp_path / "child.pid"
    repo = _setup(tmp_path, monkeypatch, f"sleep 300 &\necho $! > {pidfile}\necho started\nwait")
    code, report = _run(repo, tmp_path, timeout=1)
    assert code == 1
    assert findings(report, "acceptance-timeout") and findings(report, "out-of-scope")
    assert not _alive(int(pidfile.read_text())), "grandchild survived the timeout"
    log = (tmp_path / "out/acceptance.log").read_text()
    assert "started" in log and "timed out" in log


def test_output_is_capped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _setup(tmp_path, monkeypatch, "head -c 3000000 /dev/zero | tr '\\0' x\necho END")
    code, _ = _run(repo, tmp_path)
    assert code == 1  # outside.txt
    log = (tmp_path / "out/acceptance.log").read_text()
    assert len(log) < 1_200_000 and "END" in log


def test_tool_error_keeps_log_and_earlier_findings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _setup(tmp_path, monkeypatch, "echo first", acceptance="agent-test && no-such-binary-xyz")
    with pytest.raises(ToolError, match="executable missing"):
        _run(repo, tmp_path)
    assert "first" in (tmp_path / "out/acceptance.log").read_text()
    report = json.loads((tmp_path / "out/report.json").read_text())
    assert findings(report, "out-of-scope") and findings(report, "acceptance-error")
    assert report["status"] == "fail"
