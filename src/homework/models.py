"""Shared data model for all layer-1 adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"
    # Info findings are reported but never fail the gate (e.g. optional third-party signals).
    INFO = "info"


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: Severity
    message: str
    file: str | None = None
    line: int | None = None
    evidence: str | None = None
    adapter: str = ""
    layer: int = 1
    id: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "rule": self.rule,
            "severity": str(self.severity),
            "adapter": self.adapter,
            "file": self.file,
            "line": self.line,
            "message": self.message,
            "evidence": self.evidence,
            "layer": self.layer,
        }


@dataclass
class AdapterResult:
    name: str
    status: str  # "ran" | "skipped"
    detail: str = ""
    findings: list[Finding] = field(default_factory=list)


class ToolError(Exception):
    """A tool or input problem (exit code 2): the check could not be performed reliably."""
