"""Scope adapter: allowed/forbidden paths, forbidden patterns, required paths (K16), contract tampering."""

from __future__ import annotations

import posixpath
from pathlib import Path

from ..context import CheckContext
from ..globmatch import match_any, normalize
from ..models import AdapterResult, Finding, Severity

NAME = "scope"
MAX_LINE = 10_000
WINDOW = 4096
OVERLAP = 512  # a forbidden match up to this long cannot fall between two windows


def _windows(text: str) -> list[str]:
    if len(text) <= MAX_LINE:
        return [text]
    step = WINDOW - OVERLAP
    return [text[i : i + WINDOW] for i in range(0, max(len(text) - OVERLAP, 1), step)]


def _contract_repo_path(ctx: CheckContext) -> str | None:
    path = ctx.contract.path
    if path is None:
        return None
    try:
        rel = Path(path).resolve().relative_to(ctx.root.resolve())
    except ValueError:
        return None  # contract kept outside the repo: the agent cannot touch it
    return rel.as_posix()


def run(ctx: CheckContext) -> AdapterResult:
    c = ctx.contract
    res = AdapterResult(NAME, "ran")
    add = res.findings.append
    contract_rel = _contract_repo_path(ctx)

    for fc in ctx.changes.files:
        paths = [fc.path] + ([fc.old_path] if fc.old_path else [])
        if contract_rel is not None and contract_rel in paths:
            continue  # reported by the trust check (contract-modified), not as scope creep
        for p in paths:
            if not match_any(c.allowed_paths, p):
                add(
                    Finding(
                        "out-of-scope",
                        Severity.ERROR,
                        f"'{p}' is outside allowed_paths; revert this change.",
                        file=p,
                        adapter=NAME,
                        evidence=f"status {fc.status}",
                    )
                )
            if match_any(c.forbidden_paths, p) and not match_any(c.forbidden_paths_except, p):
                add(
                    Finding(
                        "forbidden-path",
                        Severity.ERROR,
                        f"'{p}' matches a forbidden path; revert this change.",
                        file=p,
                        adapter=NAME,
                        evidence=f"status {fc.status}",
                    )
                )
        if fc.is_gitlink:
            untracked = fc.nested_repo
            add(
                Finding(
                    "nested-repo" if untracked else "submodule-changed",
                    Severity.ERROR,
                    (
                        f"'{fc.path}' is a nested git repository; its files are not checked. Remove it."
                        if untracked
                        else f"Submodule '{fc.path}' was added, removed or moved to another commit; "
                        "its code is not checked. Revert it."
                    ),
                    file=fc.path,
                    adapter=NAME,
                    evidence=f"mode {fc.old_mode} -> {fc.new_mode}, status {fc.status}",
                )
            )
        if fc.is_symlink and not fc.deleted:
            target = (ctx.changes.read_head(fc.path) or b"").decode(errors="replace").strip()
            joined = target if target.startswith("/") else posixpath.join(posixpath.dirname(fc.path), target)
            resolved = normalize(joined)
            # A symlink is a write-capability into its target; it must stay inside the allowed scope.
            if (
                resolved is None
                or not match_any(c.allowed_paths, resolved)
                or (match_any(c.forbidden_paths, resolved) and not match_any(c.forbidden_paths_except, resolved))
            ):
                add(
                    Finding(
                        "symlink-escape",
                        Severity.ERROR,
                        f"Symlink '{fc.path}' points to '{target}', outside the allowed scope.",
                        file=fc.path,
                        adapter=NAME,
                        evidence=target,
                    )
                )

    for fc in ctx.changes.files:
        if fc.deleted:
            continue
        patterns = [fp for fp in c.forbidden_patterns if match_any(fp.globs, fc.path)]
        long_lines = [n for n, t in fc.added.items() if len(t) > MAX_LINE] if patterns else []
        if long_lines:
            # Python's re has no timeout; a contract regex with nested quantifiers could run for hours
            # on a crafted line. Long lines are scanned in bounded, overlapping windows instead, and
            # their mere presence fails the check: a match longer than OVERLAP can still hide there.
            add(
                Finding(
                    "line-too-long",
                    Severity.WARNING,
                    f"{len(long_lines)} added line(s) longer than {MAX_LINE} characters were only checked "
                    f"against forbidden patterns in {WINDOW}-character windows; split them into normal lines.",
                    file=fc.path,
                    line=long_lines[0],
                    adapter=NAME,
                    evidence=f"lines {', '.join(map(str, sorted(long_lines)[:20]))}",
                )
            )
        for fp in patterns:
            for line, text in sorted(fc.added.items()):
                hit = next((m for w in _windows(text) if (m := fp.regex.search(w))), None)
                if hit:
                    add(
                        Finding(
                            "forbidden-pattern",
                            Severity.ERROR,
                            f"Added line matches forbidden pattern /{fp.regex.pattern}/.",
                            file=fc.path,
                            line=line,
                            evidence=(text if len(text) <= MAX_LINE else hit.group(0)).strip()[:200],
                            adapter=NAME,
                        )
                    )

    touched = [f.path for f in ctx.changes.files if not f.deleted]
    for req in c.required_paths:
        if not any(match_any([req], p) for p in touched):
            add(
                Finding(
                    "required-untouched",
                    Severity.ERROR,
                    f"The task requires changes to '{req}', but the diff does not touch it (work likely unfinished).",
                    file=req,
                    adapter=NAME,
                )
            )
    return res
