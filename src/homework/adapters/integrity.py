"""Git-level ways to hide a change from the diff: attributes, index flags, ignored files."""

from __future__ import annotations

import os
import posixpath

from ..context import CheckContext
from ..gitdiff import git
from ..models import AdapterResult, Finding, Severity

NAME = "integrity"
MAX_LISTED = 20


def _index_flags(ctx: CheckContext) -> list[str]:
    # "git ls-files -v": lowercase tag = assume-unchanged, "S" = skip-worktree. Either makes git
    # stop looking at the working-tree file, so edits to it never reach the diff.
    out = git(ctx.root, "ls-files", "-v", "-z")
    hidden: list[str] = []
    for entry in filter(None, out.split(b"\0")):
        tag, name = entry[:1].decode("ascii", "replace"), os.fsdecode(entry[2:])
        if tag == "S" or tag.islower():
            hidden.append(name)
    return hidden


def _ignored(ctx: CheckContext) -> list[str]:
    out = git(ctx.root, "status", "--porcelain=v1", "-z", "--ignored=traditional", "--untracked-files=normal")
    return [os.fsdecode(e[3:]) for e in out.split(b"\0") if e.startswith(b"!! ")]


def run(ctx: CheckContext) -> AdapterResult:
    res = AdapterResult(NAME, "ran")
    add = res.findings.append
    for fc in ctx.changes.files:
        for p in filter(None, (fc.path, fc.old_path)):
            if posixpath.basename(p) == ".gitattributes":
                add(
                    Finding(
                        "gitattributes-modified",
                        Severity.ERROR,
                        f"'{p}' was changed; attributes alter how git diffs files. Revert it.",
                        file=p,
                        adapter=NAME,
                    )
                )
    if ctx.changes.head is not None:
        return res
    for name in _index_flags(ctx):
        add(
            Finding(
                "index-flag-hidden",
                Severity.ERROR,
                f"'{name}' is marked assume-unchanged/skip-worktree, which hides its edits from git diff. "
                f"Clear the flag (git update-index --no-assume-unchanged --no-skip-worktree).",
                file=name,
                adapter=NAME,
            )
        )
    ignored = _ignored(ctx)
    if ignored:
        shown = ignored[:MAX_LISTED]
        more = f" (+{len(ignored) - MAX_LISTED} more)" if len(ignored) > MAX_LISTED else ""
        add(
            Finding(
                "ignored-files",
                Severity.INFO,
                "Git-ignored files/directories exist in the working tree; they are not checked. "
                "Make sure none of them is part of the change.",
                adapter=NAME,
                evidence=", ".join(shown) + more,
            )
        )
    return res
