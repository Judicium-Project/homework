"""Small helpers shared by test modules."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homework.cli import run_check


def check(
    repo: Path,
    contract: Path | str | None,
    out: Path,
    *,
    base: str = "HEAD",
    head: str | None = None,
    run: bool = False,
    task: Path | None = None,
) -> tuple[int, dict[str, Any]]:
    code, report = run_check(
        repo=repo,
        base=base,
        head=head,
        contract=str(contract) if contract else None,
        task=task,
        out=out,
        run_acceptance=run,
        with_agentdiff=False,
        timeout=120,
    )
    return code, report


def rules_of(report: dict[str, Any]) -> list[str]:
    return [f["rule"] for f in report["findings"]]


def findings(report: dict[str, Any], rule: str) -> list[dict[str, Any]]:
    return [f for f in report["findings"] if f["rule"] == rule]
