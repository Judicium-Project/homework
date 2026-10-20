"""Optional agentdiff signal (``--with-agentdiff``, off by default; K17).

agentdiff knows nothing about allowed_dependencies and flags any 50+ line deletion, so its
findings are reported as ``info`` and never fail the gate on their own.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..context import CheckContext
from ..models import AdapterResult, Finding, Severity, ToolError

NAME = "agentdiff"
IGNORED_RULES = {"deletion"}


def _find() -> str:
    local = Path(sys.executable).parent / "agentdiff"
    if local.is_file():
        return str(local)
    found = shutil.which("agentdiff")
    if not found:
        raise ToolError("--with-agentdiff given but agentdiff is not installed (uv sync --extra agentdiff)")
    return found


def _items(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in ("findings", "issues", "results"):
            if isinstance(data.get(key), list):
                return [d for d in data[key] if isinstance(d, dict)]
    return []


def run(ctx: CheckContext) -> AdapterResult:
    if ctx.changes.head is not None:
        raise ToolError("--with-agentdiff only works on the working tree (agentdiff reads it directly)")
    cmd = [_find(), "review", "--project", str(ctx.root), "--json"]
    for glob in ctx.contract.allowed_paths:
        cmd += ["--scope", glob]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    try:
        data = json.loads(proc.stdout or "null")
    except json.JSONDecodeError as exc:
        raise ToolError(f"agentdiff produced invalid JSON (exit {proc.returncode})") from exc
    res = AdapterResult(NAME, "ran")
    for item in _items(data):
        rule = str(item.get("rule") or item.get("category") or item.get("type") or "agentdiff")
        if rule in IGNORED_RULES:
            continue
        line = item.get("line")
        res.findings.append(
            Finding(
                f"agentdiff-{rule}",
                Severity.INFO,
                str(item.get("message") or item.get("reason") or item.get("title") or rule),
                file=str(item["file"]) if item.get("file") else None,
                line=line if isinstance(line, int) else None,
                evidence=str(item.get("severity", "")) or None,
                adapter=NAME,
            )
        )
    return res
