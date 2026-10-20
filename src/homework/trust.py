"""Load the contract and task file from a source the agent under review cannot have edited.

A contract or task file inside the repository is read from the BASE revision (``git show
<base>:<path>``); the agent's working tree / --head copy is only compared against it. Any
difference is a finding and blocks the acceptance commands, which come from these files and
would otherwise let the agent choose what gets executed. Files outside the repository are read
as-is: keeping them there is the recommended setup.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .contract import DEFAULT_CONTRACT
from .gitdiff import show
from .models import Finding, Severity, ToolError


@dataclass
class TrustedFile:
    text: str
    repo_path: str | None  # repo-relative path if the file lives inside the repository
    modified: bool


def repo_relative(root: Path, path: Path) -> str | None:
    """Repo-relative POSIX path of ``path`` WITHOUT following a final symlink, else None."""
    absolute = Path(os.path.abspath(path))
    # Resolve only the parent: a symlink planted at the contract's own path must not move the
    # file "outside the repo" and turn it into a trusted out-of-repo contract.
    candidates = [absolute, absolute.parent.resolve() / absolute.name]
    for cand in candidates:
        for top in (root, root.resolve()):
            try:
                return cand.relative_to(top).as_posix()
            except ValueError:
                continue
    return None


def _current(root: Path, head: str | None, rel: str) -> bytes | None:
    if head is not None:
        return show(root, head, rel)
    p = root / rel
    if p.is_symlink():
        return b"symlink:" + os.fsencode(os.readlink(p))
    return p.read_bytes() if p.is_file() else None


def load(root: Path, base: str, head: str | None, path: Path, kind: str, trust_worktree: bool) -> TrustedFile:
    rel = repo_relative(root, path)
    if rel is None:
        try:
            return TrustedFile(path.read_text(encoding="utf-8"), None, False)
        except FileNotFoundError as exc:
            raise ToolError(f"{kind} not found: {path}") from exc
    trusted = show(root, base, rel)
    current = _current(root, head, rel)
    if trusted is None:
        if not trust_worktree:
            raise ToolError(
                f"{kind} '{rel}' is not in the base revision {base}, so the agent may have written it. "
                f"Commit it before the agent runs, keep it outside the repository, or pass "
                f"--trust-worktree-contract if you wrote it yourself."
            )
        if current is None:
            raise ToolError(f"{kind} not found: {path}")
        return TrustedFile(current.decode("utf-8", errors="replace"), rel, False)
    return TrustedFile(trusted.decode("utf-8", errors="replace"), rel, current != trusted)


def finding(kind: str, rel: str) -> Finding:
    rule = "contract-modified" if kind == "contract" else "task-modified"
    return Finding(
        rule,
        Severity.ERROR,
        f"The {kind} file '{rel}' differs from the base revision; the agent must not edit its own {kind}. "
        "Restore it. The base version was used and acceptance commands were not run.",
        file=rel,
        adapter="trust",
    )


def resolve_contract(contract: str | None, root: Path, base: str) -> Path:
    if contract:
        return Path(contract).expanduser()
    default = root / DEFAULT_CONTRACT
    # The base copy counts too: deleting the contract from the working tree must not disable it.
    if not default.is_file() and not default.is_symlink() and show(root, base, DEFAULT_CONTRACT) is None:
        raise ToolError(f"no --contract given and {DEFAULT_CONTRACT} not found in {root}")
    return default
