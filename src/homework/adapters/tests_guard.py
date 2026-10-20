"""Test-protection adapter (own code instead of dunnit, K17).

Flags deleted test files, newly added skip/only/fixme markers, trivially-true assertions and a
net drop in assertion count inside a modified test file.
"""

from __future__ import annotations

import re

from ..context import CheckContext
from ..globmatch import match_any
from ..models import AdapterResult, Finding, Severity

NAME = "tests"

TEST_GLOBS = (
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.go",
    "**/test_*.py",
    "**/*_test.py",
    "**/__tests__/**",
    "**/e2e/**",
)

_SKIP = re.compile(
    # No "(" required: "const t = test.skip", "test.skip.each(...)" and "test.describe.skip" alias or
    # wrap the marker; bracket access ("it['skip']") and destructuring ("{ skip } = it") hide it.
    # Modifiers may chain ("test.describe.parallel.skip") or follow a table ("it.each([...]).skip").
    r"\b(?:it|test|describe|context|suite|bench)(?:\.describe|\.concurrent|\.serial|\.parallel|\.each\s*\(.*\))*"
    r"(?:\.(?P<kind>skip|only|todo|fixme|fail)\b|\[\s*['\"`](?P<kind2>skip|only|todo|fixme|fail)['\"`]\s*\])"
    r"|\{[^}]*\b(?P<kind3>skip|only|fixme|fail)\b[^}]*\}\s*=\s*(?:it|test|describe)\b"
    r"|\b(?P<x>xit|xtest|xdescribe|fit|fdescribe)\s*\("
    r"|\bt\.(?P<go>Skip|Skipf|SkipNow)\s*\("
    # Without "@" too: "pytestmark = pytest.mark.skip" skips a whole module.
    r"|\bpytest\.mark\.(?P<py>skip|skipif|xfail)\b|\bpytest\.skip\s*\(|@unittest\.skip"
)
_TRIVIAL = re.compile(
    r"\bexpect\s*\(\s*(?:true|false|1|0|null|undefined|['\"][^'\"]*['\"])\s*\)\s*\.\s*to"
    r"|^\s*assert\s+(?:True|1)\s*(?:#.*)?$"
)
_ASSERT = re.compile(r"\bexpect\s*\(|\bassert\w*\b|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\brequire\.\w+\(")


def _is_test(path: str) -> bool:
    return match_any(TEST_GLOBS, path)


# String literals and comments, so "expect(" inside them is not counted as an assertion.
_NOISE = re.compile(
    r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`'
    r"|/\*.*?(?:\*/|$)|//.*$|(?:^|\s)#.*$"
)


def _code_only(line: str) -> str:
    return _NOISE.sub(" ", line)


def _count(lines: list[str]) -> int:
    # Diff lines are not contiguous, so multi-line comment state is unknowable; a line starting with
    # "*" is treated as the inside of a block comment (JSDoc style).
    return sum(len(_ASSERT.findall(_code_only(line))) for line in lines if not line.lstrip().startswith("*"))


def run(ctx: CheckContext) -> AdapterResult:
    res = AdapterResult(NAME, "ran")
    add = res.findings.append
    exempt = ctx.contract.tests_exempt
    for fc in ctx.changes.files:
        origin = fc.old_path or fc.path
        if match_any(exempt, origin) or match_any(exempt, fc.path):
            continue
        if fc.deleted and _is_test(fc.path):
            add(
                Finding(
                    "test-deleted",
                    Severity.ERROR,
                    f"Test file '{fc.path}' was deleted; restore it.",
                    file=fc.path,
                    adapter=NAME,
                )
            )
            continue
        if fc.status == "R" and _is_test(origin) and not _is_test(fc.path):
            add(
                Finding(
                    "test-deleted",
                    Severity.ERROR,
                    f"Test file '{origin}' was renamed to non-test path '{fc.path}'; restore it.",
                    file=fc.path,
                    adapter=NAME,
                )
            )
            continue
        if not _is_test(fc.path) or fc.deleted:
            continue
        for line, text in sorted(fc.added.items()):
            m = _SKIP.search(text)
            if m:
                kind = (
                    m.group("kind")
                    or m.group("kind2")
                    or m.group("kind3")
                    or m.group("x")
                    or m.group("go")
                    or m.group("py")
                    or "skip"
                )
                rule = "test-only" if kind in ("only", "fit", "fdescribe") else "test-skip"
                add(
                    Finding(
                        rule,
                        Severity.ERROR,
                        "Added a focus/skip marker to a test; tests must run in full. Remove it.",
                        file=fc.path,
                        line=line,
                        evidence=text.strip()[:200],
                        adapter=NAME,
                    )
                )
            if _TRIVIAL.search(text):
                add(
                    Finding(
                        "assertion-trivial",
                        Severity.ERROR,
                        "Added an assertion on a constant; it cannot fail. Assert real behaviour.",
                        file=fc.path,
                        line=line,
                        evidence=text.strip()[:200],
                        adapter=NAME,
                    )
                )
        if fc.status != "A":
            removed, added = _count(fc.removed), _count(list(fc.added.values()))
            if removed > added:
                add(
                    Finding(
                        "assertions-reduced",
                        Severity.WARNING,
                        f"Assertion count in '{fc.path}' dropped by {removed - added} "
                        f"({removed} removed, {added} added). Do not weaken existing tests.",
                        file=fc.path,
                        adapter=NAME,
                        evidence=f"-{removed} +{added}",
                    )
                )
    return res
