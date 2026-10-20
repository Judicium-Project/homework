"""Skipped acceptance is not a full pass (review finding H)."""

from __future__ import annotations

from pathlib import Path

import jsonschema
import pytest

from conftest import commit_all, init_repo
from helpers import findings
from homework.cli import run_check
from homework.report import load_schema


def _setup(tmp: Path, acceptance: str) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (tmp / "c.toml").write_text(f'version = 1\nallowed_paths = ["**"]\nacceptance = [{acceptance}]\n')
    return repo


def _run(repo: Path, tmp: Path, *, run: bool = True, head: str | None = None, require: bool = False) -> tuple:  # type: ignore[type-arg]
    return run_check(
        repo=repo,
        base="HEAD" if head is None else "HEAD~1",
        head=head,
        contract=str(tmp / "c.toml"),
        task=None,
        out=tmp / "out",
        run_acceptance=run,
        with_agentdiff=False,
        timeout=60,
        require_acceptance=require,
    )


@pytest.mark.parametrize("case", ["no-run", "head", "empty"])
def test_skipped_acceptance_is_pass_partial(tmp_path: Path, case: str) -> None:
    repo = _setup(tmp_path, "" if case == "empty" else '"true"')
    head = None
    if case == "head":
        (repo / "a.txt").write_text("b\n")
        head = commit_all(repo, "agent")
    code, report = _run(repo, tmp_path, run=case != "no-run", head=head)
    assert code == 3 and report["status"] == "pass-partial"
    jsonschema.validate(report, load_schema())
    code, report = _run(repo, tmp_path, run=case != "no-run", head=head, require=True)
    assert code == 1 and report["status"] == "fail" and findings(report, "acceptance-not-run")


def test_ran_acceptance_is_full_pass(tmp_path: Path) -> None:
    repo = _setup(tmp_path, '"true"')
    code, report = _run(repo, tmp_path, require=True)
    assert code == 0 and report["status"] == "pass"
