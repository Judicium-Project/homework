"""Contract/task trust boundary and acceptance environment (review finding A).

Threat model: the agent under review wrote the working tree (and --head) and tries to slip past
the check, e.g. by widening its own contract or adding acceptance commands.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from conftest import commit_all, init_repo
from helpers import findings, rules_of
from homework.cli import run_check
from homework.models import ToolError

BASE_CONTRACT = 'version = 1\nallowed_paths = ["src/**"]\n'
EVIL_CONTRACT = 'version = 1\nallowed_paths = ["**"]\nacceptance = ["touch pwned"]\n'


def _run(repo: Path, contract: str | None, tmp: Path, **kw: object) -> tuple[int, dict]:  # type: ignore[type-arg]
    args: dict = dict(  # type: ignore[type-arg]
        repo=repo,
        base="HEAD",
        head=None,
        contract=contract,
        task=None,
        out=tmp / "out",
        run_acceptance=True,
        with_agentdiff=False,
        timeout=60,
    )
    args.update(kw)
    return run_check(**args)


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "src").mkdir()
    (repo / "src/a.ts").write_text("export const a = 1;\n")
    (repo / ".homework.toml").write_text(BASE_CONTRACT)
    commit_all(repo)
    return repo


def acceptance_status(report: dict) -> str:  # type: ignore[type-arg]
    return str({a["name"]: a["detail"] for a in report["adapters"]}["acceptance"])


def test_worktree_contract_edit_is_ignored_and_blocks_acceptance(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / ".homework.toml").write_text(EVIL_CONTRACT)
    (repo / "other.txt").write_text("x\n")
    code, report = _run(repo, None, tmp_path)
    assert code == 1
    assert "contract-modified" in rules_of(report)
    assert not (repo / "pwned").exists(), "acceptance from the tampered contract must never run"
    assert "other.txt" in [f["file"] for f in findings(report, "out-of-scope")]  # base contract enforced
    assert "modified" in acceptance_status(report)


def test_contract_replaced_by_symlink_is_modified(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    evil = tmp_path / "evil.toml"
    evil.write_text(EVIL_CONTRACT)
    (repo / ".homework.toml").unlink()
    os.symlink(evil, repo / ".homework.toml")
    code, report = _run(repo, str(repo / ".homework.toml"), tmp_path)
    assert code == 1 and "contract-modified" in rules_of(report)
    assert not (repo / "pwned").exists()


def test_head_contract_edit_is_detected(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / ".homework.toml").write_text(EVIL_CONTRACT)
    (repo / "other.txt").write_text("x\n")
    commit_all(repo, "agent")
    code, report = _run(repo, None, tmp_path, base="HEAD~1", head="HEAD")
    assert code == 1 and "contract-modified" in rules_of(report)
    assert findings(report, "out-of-scope")


def test_task_in_repo_read_from_base(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "task.md").write_text("---\nfiles: [task.md]\n---\n# Task\n")
    commit_all(repo, "task")
    (repo / "task.md").write_text('---\nfiles: ["**"]\naccept: ["touch pwned"]\n---\n# Task\n')
    (repo / "other.txt").write_text("x\n")
    code, report = _run(repo, None, tmp_path, task=repo / "task.md")
    assert code == 1
    assert "task-modified" in rules_of(report)
    assert "other.txt" in [f["file"] for f in findings(report, "out-of-scope")]
    assert not (repo / "pwned").exists()


def test_contract_missing_from_base_is_tool_error(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (repo / ".homework.toml").write_text(EVIL_CONTRACT)
    with pytest.raises(ToolError, match="not in the base revision"):
        _run(repo, None, tmp_path)
    assert not (repo / "pwned").exists()


def test_trust_worktree_contract_flag(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (repo / ".homework.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    code, report = _run(repo, None, tmp_path, trust_worktree_contract=True)
    assert code == 3, report["findings"]


def test_acceptance_env_is_allowlisted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (tmp_path / "c.toml").write_text(
        'version = 1\nallowed_paths = ["**"]\nenv_passthrough = ["KEEP_ME"]\nacceptance = ["env"]\n'
    )
    monkeypatch.setenv("GITHUB_TOKEN", "s3cr3t-token")
    monkeypatch.setenv("KEEP_ME", "kept")
    monkeypatch.setenv("LC_CTYPE", "C")
    code, _ = _run(repo, str(tmp_path / "c.toml"), tmp_path)
    assert code == 0
    log = (tmp_path / "out/acceptance.log").read_text()
    assert "s3cr3t-token" not in log
    assert "KEEP_ME=kept" in log and "LC_CTYPE=C" in log and "PATH=" in log


def test_absolute_contract_outside_repo_is_read_as_is(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    outside = tmp_path / "keep" / "c.toml"
    outside.parent.mkdir()
    outside.write_text(BASE_CONTRACT)
    (repo / "other.txt").write_text("x\n")
    code, report = _run(repo, str(outside), tmp_path)
    assert "contract-modified" not in rules_of(report)
    assert [f["file"] for f in findings(report, "out-of-scope")] == ["other.txt"] and code == 1
    assert report["contract"] == str(outside)


def test_dotdot_contract_path_inside_repo_is_read_from_base(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / ".homework.toml").write_text(EVIL_CONTRACT)
    code, report = _run(repo, str(repo / "src" / ".." / ".homework.toml"), tmp_path)
    assert code == 1 and "contract-modified" in rules_of(report)
    assert not (repo / "pwned").exists()


def test_symlinked_parent_directory_does_not_move_contract_out_of_repo(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "cfg").mkdir()
    (repo / "cfg/c.toml").write_text(BASE_CONTRACT)
    commit_all(repo)
    evil_dir = tmp_path / "evil"
    evil_dir.mkdir()
    (evil_dir / "c.toml").write_text(EVIL_CONTRACT)
    (repo / "cfg/c.toml").unlink()
    (repo / "cfg").rmdir()
    os.symlink(evil_dir, repo / "cfg")
    code, report = _run(repo, str(repo / "cfg" / "c.toml"), tmp_path)
    assert code == 1 and "contract-modified" in rules_of(report)
    assert not (repo / "pwned").exists()


def test_isolate_home_gives_acceptance_a_throwaway_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\nacceptance = ["env"]\n')
    real_home = tmp_path / "realhome"
    real_home.mkdir()
    monkeypatch.setenv("HOME", str(real_home))
    code, report = _run(repo, str(tmp_path / "c.toml"), tmp_path, isolate_home=True)
    assert code == 0, report["findings"]
    homes = [ln for ln in (tmp_path / "out/acceptance.log").read_text().splitlines() if ln.startswith("HOME=")]
    assert len(homes) == 1 and homes[0] != f"HOME={real_home}"
    assert not Path(homes[0].removeprefix("HOME=")).exists(), "throwaway HOME must be removed afterwards"
    code, _ = _run(repo, str(tmp_path / "c.toml"), tmp_path)
    assert f"HOME={real_home}" in (tmp_path / "out/acceptance.log").read_text()
