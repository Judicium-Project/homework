"""report.json (validated against schemas/report.schema.json) and fix-round.md rendering."""

from __future__ import annotations

import json
from dataclasses import replace
from importlib import resources
from pathlib import Path
from typing import Any

import jsonschema

from . import __version__
from .adapters.acceptance import RunRecord
from .context import CheckContext
from .models import AdapterResult, Finding, Severity, ToolError

_SEV_ORDER = {Severity.ERROR: 0, Severity.WARNING: 1, Severity.INFO: 2}


def load_schema() -> dict[str, Any]:
    # schemas/report.schema.json at the repo root is a symlink to this packaged file.
    data: dict[str, Any] = json.loads((resources.files("homework") / "report.schema.json").read_text(encoding="utf-8"))
    return data


def clean_text(value: str) -> str:
    """Make fsdecoded (surrogateescape) path names printable: invalid bytes become ``\\xNN``."""
    return value.encode("utf-8", "surrogateescape").decode("utf-8", "backslashreplace")


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {clean_text(k): _clean(v) for k, v in value.items()}
    return value


def number(findings: list[Finding]) -> list[Finding]:
    ordered = sorted(findings, key=lambda f: (_SEV_ORDER[f.severity], f.file or "", f.line or 0, f.rule))
    return [replace(f, id=f"F{i:03d}") for i, f in enumerate(ordered, 1)]


def failing(findings: list[Finding]) -> bool:
    return any(f.severity in (Severity.ERROR, Severity.WARNING) for f in findings)


def acceptance_skipped(adapters: list[AdapterResult]) -> bool:
    return any(a.name == "acceptance" and a.status == "skipped" for a in adapters)


def _status(adapters: list[AdapterResult], findings: list[Finding]) -> str:
    if failing(findings):
        return "fail"
    # Static checks alone never prove the change works; say so instead of a plain "pass".
    return "pass-partial" if acceptance_skipped(adapters) else "pass"


def build(
    ctx: CheckContext, adapters: list[AdapterResult], findings: list[Finding], runs: list[RunRecord]
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": 1,
        "tool": {"name": "homework", "version": __version__},
        "layer": 1,
        "status": _status(adapters, findings),
        "base": ctx.changes.base,
        # A branch name moves; the commit id says exactly what the change was compared against.
        "base_sha": ctx.changes.base_sha,
        "head": ctx.changes.head,
        "contract": str(ctx.contract.path) if ctx.contract.path else None,
        "task": ctx.contract.task,
        "summary": {
            "error": sum(f.severity == Severity.ERROR for f in findings),
            "warning": sum(f.severity == Severity.WARNING for f in findings),
            "info": sum(f.severity == Severity.INFO for f in findings),
            "files_changed": len(ctx.changes.files),
        },
        "adapters": [{"name": a.name, "status": a.status, "detail": a.detail} for a in adapters],
        "findings": [f.to_json() for f in findings],
        "acceptance_runs": [
            {"command": r.command, "steps": r.steps, "exit_code": r.exit_code, "cache_hit": r.cache_hit} for r in runs
        ],
    }
    report = _clean(report)
    try:
        jsonschema.validate(report, load_schema())
    except jsonschema.ValidationError as exc:
        raise ToolError(f"internal error: report does not match schema: {exc.message}") from exc
    return report


def fix_round(ctx: CheckContext, findings: list[Finding]) -> str:
    actionable = [f for f in findings if f.severity != Severity.INFO]
    lines = [
        "## Fix round (homework check, layer 1)",
        "",
    ]
    if not actionable:
        lines.append("No layer-1 findings. Nothing to fix.")
        return "\n".join(lines) + "\n"
    lines += [
        f"The automated check found {len(actionable)} problem(s) in your change. Fix every item below, "
        "then stop. Rules for this round:",
        "",
        "- Change only what an item asks for; do not touch any other file.",
        "- Do not edit the contract, delete or skip tests, or weaken assertions to make checks pass.",
        "- Do not claim an item is done unless the change is in the diff.",
        "",
    ]
    for f in actionable:
        where = f.file or "(repository)"
        if f.line:
            where += f":{f.line}"
        lines.append(f"{f.id}. [{f.rule}] {where}")
        lines.append(f"   {f.message}")
        if f.evidence:
            ev = f.evidence.replace("\n", " ")[:200]
            lines.append(f"   Evidence: `{ev}`")
        lines.append("")
    if ctx.contract.acceptance:
        lines.append("When done, these commands must pass without any build cache:")
        lines += [f"- `{cmd}`" for cmd in ctx.contract.acceptance]
        lines.append("")
    return "\n".join(lines)


def write(out_dir: Path, report: dict[str, Any], fix_round_text: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / "fix-round.md").write_text(clean_text(fix_round_text), encoding="utf-8")
