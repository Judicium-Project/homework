"""State shared by all adapters for one ``check`` invocation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .contract import Contract
from .gitdiff import ChangeSet


@dataclass
class CheckContext:
    changes: ChangeSet
    contract: Contract
    out_dir: Path
    run_acceptance: bool = True
    timeout: float = 1800.0
    # Acceptance commands get an empty temporary HOME (agent code cannot read ~/.ssh, ~/.npmrc, ...).
    isolate_home: bool = False
    # Set when the contract/task changed under the agent: acceptance commands must not run at all.
    acceptance_blocked: str | None = None

    @property
    def root(self) -> Path:
        return self.changes.root
