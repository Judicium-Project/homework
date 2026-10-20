from __future__ import annotations

import json
import subprocess
from pathlib import Path

import jsonschema
from typer.testing import CliRunner

from conftest import ROOT, commit_all, init_repo
from homework.cli import app

runner = CliRunner()


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "src").mkdir()
    (repo / "src/a.ts").write_text("export const a = 1;\n")
    commit_all(repo)
    return repo


def _invoke(*args: str) -> tuple[int, str]:
    result = runner.invoke(app, ["check", *args])
    return result.exit_code, result.output


def test_exit_3_pass_partial_and_schema_valid(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["src/**"]\n')
    (repo / "src/a.ts").write_text("export const a = 2;\n")
    code, out = _invoke(
        "--repo",
        str(repo),
        "--base",
        "HEAD",
        "--contract",
        str(tmp_path / "c.toml"),
        "--out",
        str(tmp_path / "o"),
        "--no-run",
    )
    assert code == 3, out
    report = json.loads((tmp_path / "o/report.json").read_text())
    schema = json.loads((ROOT / "schemas/report.schema.json").read_text())
    jsonschema.validate(report, schema)
    assert report["status"] == "pass-partial"  # --no-run
    assert "Nothing to fix" in (tmp_path / "o/fix-round.md").read_text()


def test_exit_1_findings_and_fix_round(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["src/**"]\n')
    (repo / "other.ts").write_text("x\n")
    code, out = _invoke(
        "--repo",
        str(repo),
        "--base",
        "HEAD",
        "--contract",
        str(tmp_path / "c.toml"),
        "--out",
        str(tmp_path / "o"),
        "--no-run",
    )
    assert code == 1
    assert "out-of-scope" in out
    report = json.loads((tmp_path / "o/report.json").read_text())
    jsonschema.validate(report, json.loads((ROOT / "schemas/report.schema.json").read_text()))
    md = (tmp_path / "o/fix-round.md").read_text()
    assert "F001. [out-of-scope] other.ts" in md and "revert" in md


def test_default_out_dir_is_inside_git_dir(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / ".homework.toml").write_text('version = 1\nallowed_paths = ["src/**", ".homework.toml"]\n')
    commit_all(repo, "contract")
    code, _ = _invoke("--repo", str(repo), "--base", "HEAD", "--no-run")
    assert code == 3
    assert (repo / ".git/homework/report.json").is_file()


def test_exit_2_input_errors(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    code, out = _invoke("--repo", str(repo), "--base", "HEAD", "--no-run")
    assert code == 2 and "not found" in out
    (tmp_path / "bad.toml").write_text('version = 1\nallowed_path = ["typo"]\n')
    code, out = _invoke("--repo", str(repo), "--base", "HEAD", "--contract", str(tmp_path / "bad.toml"), "--no-run")
    assert code == 2 and "unknown key" in out
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    code, out = _invoke("--repo", str(repo), "--base", "nope", "--contract", str(tmp_path / "c.toml"), "--no-run")
    assert code == 2


def test_task_frontmatter_extends_contract(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["src/**"]\n')
    (tmp_path / "task.md").write_text("---\nfiles: [docs/**]\nallowed_deps: [left-pad]\n---\n# Task\n")
    (repo / "docs").mkdir()
    (repo / "docs/x.md").write_text("x\n")
    code, out = _invoke(
        "--repo",
        str(repo),
        "--base",
        "HEAD",
        "--contract",
        str(tmp_path / "c.toml"),
        "--task",
        str(tmp_path / "task.md"),
        "--out",
        str(tmp_path / "o"),
        "--no-run",
    )
    assert code == 3, out


def test_exit_0_only_when_acceptance_ran(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["src/**"]\nacceptance = ["true"]\n')
    (repo / "src/a.ts").write_text("export const a = 2;\n")
    args = ["--repo", str(repo), "--base", "HEAD", "--contract", str(tmp_path / "c.toml"), "--out", str(tmp_path / "o")]
    code, out = _invoke(*args)
    assert code == 0, out
    code, out = _invoke(*args, "--isolate-home")
    assert code == 0, out
    code, out = _invoke(*args, "--no-run", "--require-acceptance")
    assert code == 1, out


def test_report_records_resolved_base_sha(tmp_path: Path) -> None:
    from homework.cli import run_check

    repo = _repo(tmp_path)
    (tmp_path / "c.toml").write_text('version = 1\nallowed_paths = ["src/**"]\n')
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    _, report = run_check(
        repo=repo,
        base="HEAD",
        head=None,
        contract=str(tmp_path / "c.toml"),
        task=None,
        out=tmp_path / "o",
        run_acceptance=False,
        with_agentdiff=False,
        timeout=60,
    )
    assert report["base"] == "HEAD" and report["base_sha"] == sha
