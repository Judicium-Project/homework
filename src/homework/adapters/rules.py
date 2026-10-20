"""Rule-pack adapter: ast-grep rules (rules/*.yml) plus a few regex rules for non-TS files.

Only matches whose line range contains an added line are reported: untouched pre-existing
violations are not the agent's doing and would drown the fix round in noise.
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from ..context import CheckContext
from ..globmatch import match_any
from ..models import AdapterResult, Finding, Severity, ToolError
from .tests_guard import TEST_GLOBS

NAME = "rules"
AST_GREP_VERSION = "0.51.0"

# ts and tsx are separate tree-sitter grammars; feeding a .ts file to the tsx parser can fail
# silently (0 matches, exit 0), so each rule only ever sees files of its own language.
# The javascript grammar parses JSX too, so .js/.jsx share one rule variant.
LANG_EXT = {"ts": (".ts", ".mts", ".cts"), "tsx": (".tsx",), "javascript": (".js", ".jsx", ".mjs", ".cjs")}

CSS_EXT = (".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte")
_CSS_UPPER = re.compile(r"text-transform\s*:\s*uppercase", re.I)

# Duplicate magic numbers inside one file's added lines (G45-4a: the same limit defined twice).
DUP_EXT = (".tsp", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".go", ".py", ".proto")
GENERATED_GLOBS = ("**/*.gen.*", "**/gen/**", "**/generated/**", "**/out/**", "**/*_generated.*")
_NUMBER = re.compile(r"(?<![\w.#-])(\d{4,})(?![\w.%])")
_POW10 = re.compile(r"^10+$")
_DUP_IGNORE = re.compile(r"^\s*(?://|#|/?\*)")


@dataclass(frozen=True)
class Rule:
    id: str
    language: str
    path: Path
    message: str
    scope: str  # "all" | "e2e"


def find_ast_grep() -> str:
    candidates = [Path(sys.executable).parent / "ast-grep"]
    which = shutil.which("ast-grep")
    if which:
        candidates.append(Path(which))
    for cand in candidates:
        if cand.is_file():
            out = subprocess.run([str(cand), "--version"], capture_output=True, text=True, check=False)
            version = out.stdout.strip().split()[-1] if out.stdout.strip() else ""
            if version != AST_GREP_VERSION:
                raise ToolError(f"ast-grep {AST_GREP_VERSION} required, found '{out.stdout.strip()}' at {cand}")
            return str(cand)
    raise ToolError(
        f"ast-grep {AST_GREP_VERSION} not found (looked next to the Python interpreter and on PATH); "
        "run 'uv sync' in the homework project"
    )


def load_rules() -> list[Rule]:
    rules: list[Rule] = []
    root = resources.files("homework") / "rules"
    for entry in sorted(root.iterdir(), key=lambda e: e.name):
        if not entry.name.endswith(".yml"):
            continue
        data = yaml.safe_load(entry.read_text(encoding="utf-8"))
        meta = data.get("metadata") or {}
        rules.append(
            Rule(data["id"], data["language"], Path(str(entry)), data.get("message", ""), str(meta.get("scope", "all")))
        )
    if not rules:
        raise ToolError("no ast-grep rules packaged with homework")
    return rules


def _scan(sg: str, rule: Rule, workdir: Path, files: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(files), 200):
        chunk = files[i : i + 200]
        proc = subprocess.run(
            [sg, "scan", "-r", str(rule.path), "--json=stream", *chunk],
            cwd=workdir,
            capture_output=True,
            text=True,
            check=False,
        )
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        # Exit 1 is "error-level matches found"; anything else, or exit 1 without matches, means
        # the rule or a file failed to load - never treat that as a clean result.
        if proc.returncode not in (0, 1) or (proc.returncode == 1 and not lines):
            raise ToolError(f"ast-grep failed on rule {rule.path.name}: {proc.stderr.strip()[:500]}")
        out.extend(json.loads(ln) for ln in lines)
    return out


def _ast_grep(ctx: CheckContext, res: AdapterResult) -> None:
    rules = [r for r in load_rules() if r.id not in ctx.contract.disabled_rules]
    by_path = ctx.changes.by_path()
    targets = [f for f in ctx.changes.files if not f.deleted and not f.is_symlink and f.added]
    if not targets:
        return
    sg = find_ast_grep()
    with tempfile.TemporaryDirectory(prefix="homework-sg-") as tmp:
        work = Path(tmp)
        written: set[str] = set()
        for fc in targets:
            if not fc.path.endswith(tuple(e for exts in LANG_EXT.values() for e in exts)):
                continue
            data = ctx.changes.read_head(fc.path)
            if data is None:
                continue
            dest = work / fc.path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            written.add(fc.path)
        for rule in rules:
            files = sorted(p for p in written if p.endswith(LANG_EXT.get(rule.language, ())))
            if rule.scope == "e2e":
                files = [p for p in files if match_any(ctx.contract.e2e_paths, p)]
            if not files:
                continue
            for m in _scan(sg, rule, work, files):
                path = str(m["file"])
                changed = by_path.get(path)
                if changed is None:
                    continue
                # ast-grep lines are 0-based. Any added line inside the match counts: editing the
                # inside of a multi-line construct (a style object, an assignment) re-authors it.
                start, end = int(m["range"]["start"]["line"]) + 1, int(m["range"]["end"]["line"]) + 1
                line = next((n for n in range(start, end + 1) if n in changed.added), None)
                if line is None:
                    continue
                res.findings.append(
                    Finding(
                        rule.id,
                        Severity.ERROR,
                        rule.message,
                        file=path,
                        line=line,
                        evidence=str(m.get("lines", "")).strip().splitlines()[0][:200] if m.get("lines") else None,
                        adapter=NAME,
                    )
                )


def _regex_rules(ctx: CheckContext, res: AdapterResult) -> None:
    disabled = set(ctx.contract.disabled_rules)
    for fc in ctx.changes.files:
        if fc.deleted or fc.is_symlink:
            continue
        lower = fc.path.lower()
        if lower.endswith(CSS_EXT) and "text-transform-uppercase" not in disabled:
            for line, text in sorted(fc.added.items()):
                if _CSS_UPPER.search(text):
                    res.findings.append(
                        Finding(
                            "text-transform-uppercase",
                            Severity.ERROR,
                            "text-transform: uppercase breaks Turkish casing (i/I); remove it.",
                            file=fc.path,
                            line=line,
                            evidence=text.strip()[:200],
                            adapter=NAME,
                        )
                    )
        if (
            "duplicate-literal" not in disabled
            and lower.endswith(DUP_EXT)
            and not match_any(TEST_GLOBS, fc.path)
            and not match_any(GENERATED_GLOBS, fc.path)
            and posixpath.basename(lower) not in ("package.json",)
        ):
            seen: dict[str, list[int]] = {}
            for line, text in sorted(fc.added.items()):
                if _DUP_IGNORE.match(text):
                    continue
                for num in set(_NUMBER.findall(text)):
                    if _POW10.match(num):
                        continue  # 1000/10000 are unit conversions far more often than shared limits
                    seen.setdefault(num, []).append(line)
            for num, lines in seen.items():
                if len(lines) > 1:
                    res.findings.append(
                        Finding(
                            "duplicate-literal",
                            Severity.ERROR,
                            f"The literal {num} is written {len(lines)} times in added code; define it once "
                            "(single source of truth) and reference it.",
                            file=fc.path,
                            line=lines[1],
                            evidence=f"lines {', '.join(map(str, lines))}",
                            adapter=NAME,
                        )
                    )


def run(ctx: CheckContext) -> AdapterResult:
    res = AdapterResult(NAME, "ran")
    _ast_grep(ctx, res)
    _regex_rules(ctx, res)
    return res
