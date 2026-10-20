"""Dependency adapter: package.json / go.mod additions, removals and key reordering (G46-2)."""

from __future__ import annotations

import json
import posixpath
import re
from typing import Any

from ..context import CheckContext
from ..gitdiff import FileChange
from ..models import AdapterResult, Finding, Severity

NAME = "deps"
DEP_SECTIONS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def _line_of(text: str, key: str) -> int | None:
    needle = json.dumps(key) + ":"
    for i, line in enumerate(text.split("\n"), 1):
        if needle in line.replace('": ', '":'):
            return i
    return None


def _moved_keys(base: list[str], head: list[str]) -> list[str]:
    """Keys outside the longest common subsequence: the minimal set that actually moved."""
    n, m = len(base), len(head)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if base[i] == head[j] else max(dp[i + 1][j], dp[i][j + 1])
    keep: set[str] = set()
    i = j = 0
    while i < n and j < m:
        if base[i] == head[j]:
            keep.add(base[i])
            i, j = i + 1, j + 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return [k for k in head if k not in keep]


def _order_changes(base: Any, head: Any, path: str) -> list[tuple[str, list[str]]]:
    """Objects whose shared keys appear in a different relative order. Additions are free."""
    out: list[tuple[str, list[str]]] = []
    if isinstance(base, dict) and isinstance(head, dict):
        shared = set(base) & set(head)
        b = [k for k in base if k in shared]
        h = [k for k in head if k in shared]
        if b != h:
            out.append((path or "<root>", _moved_keys(b, h)))
        for k in b:
            out.extend(_order_changes(base[k], head[k], f"{path}.{k}" if path else k))
    return out


_NON_REGISTRY = re.compile(
    r"^\s*(?:git\+|git:|github:|gitlab:|bitbucket:|gist:|https?:|file:|link:|portal:|\.{0,2}/|~/)", re.I
)


_PROTOCOL = re.compile(r"^\s*([a-z][a-z0-9+.-]*):", re.I)


def _registry_spec(spec: Any) -> bool:
    if not isinstance(spec, str):
        return False
    # npm also reads "user/repo" (no protocol) as a GitHub shorthand.
    if re.match(r"^[\w.-]+/[\w.-]+(?:#.*)?$", spec.strip()) and not spec.startswith("@"):
        return False
    if _NON_REGISTRY.match(spec):
        return False
    # Any other "<protocol>:" (npm: aliases, jsr:, patch:, exec:, ...) installs something other than
    # the named registry package; only workspace: links stay inside the monorepo.
    proto = _PROTOCOL.match(spec)
    return proto is None or proto.group(1).lower() == "workspace"


def _invalid(path: str, why: str) -> Finding:
    return Finding("package-json-invalid", Severity.ERROR, f"{why}; fix package.json.", file=path, adapter=NAME)


def _package_json(ctx: CheckContext, fc: FileChange, res: AdapterResult) -> None:
    add = res.findings.append
    allowed = set(ctx.contract.allowed_dependencies)
    head_raw = ctx.changes.read_head(fc.path)
    if head_raw is None:
        return
    head_text = head_raw.decode(errors="replace")
    base_raw = ctx.changes.read_base(fc.old_path or fc.path) if fc.status != "A" else None
    try:
        head = json.loads(head_text)
        base = json.loads(base_raw) if base_raw else {}
    except json.JSONDecodeError as exc:
        add(
            Finding(
                "package-json-invalid",
                Severity.ERROR,
                f"package.json is not valid JSON: {exc}",
                file=fc.path,
                adapter=NAME,
            )
        )
        return
    if not isinstance(base, dict):
        base = {}
    if not isinstance(head, dict):
        add(_invalid(fc.path, "package.json must be a JSON object"))
        return
    for section in DEP_SECTIONS:
        b = base.get(section) or {}
        h = head.get(section) or {}
        if not isinstance(b, dict):
            b = {}
        # The agent controls head; a non-object section must not crash or bypass the check.
        if not isinstance(h, dict):
            add(_invalid(fc.path, f"'{section}' must be an object of name -> version, got {type(h).__name__}"))
            continue
        for name in h:
            if (name not in b or b[name] != h[name]) and not _registry_spec(h[name]):
                # Even an allowed package name can point anywhere: a git/URL/file source bypasses
                # the registry, the lockfile integrity hash and every review of the version.
                add(
                    Finding(
                        "dependency-source",
                        Severity.ERROR,
                        f"Dependency '{name}' in {section} is installed from a non-registry source; "
                        "use a registry version range.",
                        file=fc.path,
                        line=_line_of(head_text, name),
                        evidence=f'"{name}": {json.dumps(h[name])}',
                        adapter=NAME,
                    )
                )
            if name not in b and name not in allowed:
                add(
                    Finding(
                        "dependency-not-allowed",
                        Severity.ERROR,
                        f"New dependency '{name}' in {section} is not in allowed_dependencies; remove it.",
                        file=fc.path,
                        line=_line_of(head_text, name),
                        evidence=f'"{name}": "{h[name]}"',
                        adapter=NAME,
                    )
                )
            elif name in b and b[name] != h[name]:
                add(
                    Finding(
                        "dependency-changed",
                        Severity.WARNING,
                        f"Version of '{name}' in {section} changed ({b[name]} -> {h[name]}); "
                        "restore the original version.",
                        file=fc.path,
                        line=_line_of(head_text, name),
                        adapter=NAME,
                    )
                )
        for name in b:
            if name not in h:
                add(
                    Finding(
                        "dependency-removed",
                        Severity.WARNING,
                        f"Dependency '{name}' was removed from {section}; restore it.",
                        file=fc.path,
                        adapter=NAME,
                    )
                )
    for where, moved in _order_changes(base, head, ""):
        names = ", ".join(moved)
        add(
            Finding(
                "package-json-reorder",
                Severity.ERROR,
                f"Key order in package.json '{where}' changed; moved: {names}. Put these keys back in "
                "their original position; only adding the allowed lines is permitted.",
                file=fc.path,
                line=_line_of(head_text, moved[0]),
                evidence=f"{where}: {names}",
                adapter=NAME,
            )
        )
    # Anything else (scripts, fields) must be untouched; the contract only grants dependency lines.
    stripped_head = {k: v for k, v in head.items() if k not in DEP_SECTIONS}
    stripped_base = {k: v for k, v in base.items() if k not in DEP_SECTIONS}
    if base and stripped_head != stripped_base:
        changed = sorted(
            k for k in set(stripped_head) | set(stripped_base) if stripped_head.get(k) != stripped_base.get(k)
        )
        add(
            Finding(
                "package-json-changed",
                Severity.WARNING,
                f"Non-dependency package.json fields changed: {', '.join(changed)}; revert them.",
                file=fc.path,
                adapter=NAME,
            )
        )


_REQ_LINE = re.compile(r"^\s*([^\s()/]+(?:/[^\s()]+)*)\s+v\S+")
_REPLACE_LINE = re.compile(r"^\S.*=>\s*\S")


def _go_directive(text: str, keyword: str) -> list[str]:
    """Entries of a go.mod/go.work directive, single-line or block form, whitespace-normalised.

    Only "\n" ends a line for the Go parser (str.splitlines() would also split on \x1c, U+2028 ...),
    and any whitespace - a tab included - separates the keyword from "(" or its argument.
    """
    out: list[str] = []
    in_block = False
    for raw in text.split("\n"):
        words = raw.split("//")[0].split()
        if not words:
            continue
        if in_block:
            if words == [")"]:
                in_block = False
            else:
                out.append(" ".join(words))
        elif words[0] == keyword:
            rest = words[1:]
            if rest == ["("]:
                in_block = True
            elif rest:
                out.append(" ".join(rest))
        elif words[0] == keyword + "(":
            in_block = True
    return out


def _go_requires(text: str) -> set[str]:
    return {m.group(1) for e in _go_directive(text, "require") if (m := _REQ_LINE.match(e))}


def _go_replaces(text: str) -> set[str]:
    return {e for e in _go_directive(text, "replace") if _REPLACE_LINE.match(e)}


def _replace_findings(fc: FileChange, res: AdapterResult, head: str, base: str) -> None:
    for rep in sorted(_go_replaces(head) - _go_replaces(base)):
        res.findings.append(
            Finding(
                "go-mod-replace",
                Severity.ERROR,
                f"New {posixpath.basename(fc.path)} 'replace' directive redirects a module to another source; "
                "remove it.",
                file=fc.path,
                line=next((n for n, t in fc.added.items() if rep.split()[0] in t and "=>" in t), None),
                evidence=rep,
                adapter=NAME,
            )
        )


def _go_mod(ctx: CheckContext, fc: FileChange, res: AdapterResult) -> None:
    head = (ctx.changes.read_head(fc.path) or b"").decode(errors="replace")
    base = (ctx.changes.read_base(fc.old_path or fc.path) or b"").decode(errors="replace") if fc.status != "A" else ""
    _replace_findings(fc, res, head, base)
    new = _go_requires(head) - _go_requires(base)
    for mod in sorted(new - set(ctx.contract.allowed_dependencies)):
        line = next((n for n, t in fc.added.items() if mod in t), None)
        res.findings.append(
            Finding(
                "dependency-not-allowed",
                Severity.ERROR,
                f"New Go module '{mod}' is not in allowed_dependencies; remove it.",
                file=fc.path,
                line=line,
                adapter=NAME,
            )
        )


def _go_work(ctx: CheckContext, fc: FileChange, res: AdapterResult) -> None:
    head = (ctx.changes.read_head(fc.path) or b"").decode(errors="replace")
    base = (ctx.changes.read_base(fc.old_path or fc.path) or b"").decode(errors="replace") if fc.status != "A" else ""
    _replace_findings(fc, res, head, base)
    for use in sorted(set(_go_directive(head, "use")) - set(_go_directive(base, "use"))):
        # A workspace "use" swaps a module for a local directory, exactly like a replace directive.
        res.findings.append(
            Finding(
                "go-work-use",
                Severity.ERROR,
                "New go.work 'use' directive adds a module from a local directory; remove it.",
                file=fc.path,
                line=next((n for n, t in fc.added.items() if use in t), None),
                evidence=use,
                adapter=NAME,
            )
        )


def run(ctx: CheckContext) -> AdapterResult:
    res = AdapterResult(NAME, "ran")
    for fc in ctx.changes.files:
        if fc.deleted:
            continue
        base = posixpath.basename(fc.path)
        if base == "package.json":
            _package_json(ctx, fc, res)
        elif base == "go.mod":
            _go_mod(ctx, fc, res)
        elif base == "go.work":
            _go_work(ctx, fc, res)
    return res
