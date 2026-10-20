"""Rule-pack self tests: every rule must fire on a positive sample and stay silent on a negative one.

ast-grep reports 0 matches (exit 0) when a grammar cannot parse a file, so a rule that silently
stopped working would look exactly like clean code without these tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from conftest import commit_all, init_repo
from helpers import check, findings
from homework.adapters import rules as rules_mod
from homework.models import ToolError

CONTRACT = 'version = 1\nallowed_paths = ["**"]\n'

CASES: list[tuple[str, str, str, str]] = [
    # (rule, path, positive, negative)
    (
        "window-dunder-assign",
        "src/m.tsx",
        "(window as unknown as { __hook?: unknown }).__hook = { a: 1 };\n",
        "window.title = 'x';\nconst o = { __proto: 1 };\n",
    ),
    ("window-dunder-assign", "src/m.ts", "(window as any).__x = 1;\n", "(window as any).x = 1;\n"),
    ("e2e-setcontent", "apps/web/e2e/a.spec.ts", "await page.setContent('<p>');\n", "await page.goto('/');\n"),
    (
        "e2e-external-url",
        "apps/web/e2e/a.spec.ts",
        "const u = 'https://cdn.jsdelivr.net/x.js';\n",
        "const u = 'http://localhost:5410/';\n",
    ),
    (
        "e2e-dom-injection",
        "apps/web/e2e/a.spec.ts",
        "await page.evaluate(() => { document.body.appendChild(document.createElement('b')); });\n",
        "await page.getByRole('button').click();\n",
    ),
    (
        "inline-style-static",
        "src/c.tsx",
        "export const C = () => <div style={{ display: 'flex' }} />;\n",
        "export const C = ({ w }: { w: number }) => <div style={{ width: w }} />;\n",
    ),
    (
        "text-transform-uppercase",
        "src/s.tsx",
        "const s = { textTransform: 'uppercase' };\n",
        "const s = { textTransform: 'none' };\n",
    ),
    ("text-transform-uppercase", "src/s.css", ".a { text-transform: uppercase; }\n", ".a { text-transform: none; }\n"),
    (
        "commented-out-code",
        "src/x.ts",
        "// const old = compute(1);\n// setOpen(false);\n",
        "// If the user returns early we keep the draft.\n// TODO: handle errors\n// x = 5 means five;\n"
        "// Retry (twice);\n",
    ),
    # JavaScript variants (.js/.jsx/.mjs/.cjs use the javascript grammar, JSX included).
    ("window-dunder-assign", "src/m.js", "window.__hook = { a: 1 };\n", "window.title = 'x';\n"),
    ("window-dunder-assign", "src/m.cjs", "window.__x = 1;\n", "window.x = 1;\n"),
    ("e2e-setcontent", "apps/web/e2e/a.spec.js", "await page.setContent('<p>');\n", "await page.goto('/');\n"),
    ("e2e-setcontent", "apps/web/e2e/a.spec.mjs", "await page.setContent('<p>');\n", "await page.goto('/');\n"),
    (
        "e2e-external-url",
        "apps/web/e2e/a.spec.js",
        "const u = 'https://cdn.jsdelivr.net/x.js';\n",
        "const u = 'http://localhost:5410/';\n",
    ),
    (
        "inline-style-static",
        "src/c.jsx",
        "export const C = () => <div style={{ display: 'flex' }} />;\n",
        "export const C = ({ w }) => <div style={{ width: w }} />;\n",
    ),
    (
        "inline-style-static",
        "src/c.js",
        "export const C = () => <div style={{ display: 'flex' }} />;\n",
        "export const C = ({ w }) => <div style={{ width: w }} />;\n",
    ),
    (
        "e2e-dom-injection",
        "apps/web/e2e/a.spec.js",
        "await page.evaluate(() => { document.body.appendChild(document.createElement('b')); });\n",
        "await page.getByRole('button').click();\n",
    ),
    (
        "e2e-dom-injection",
        "apps/web/e2e/a.spec.jsx",
        "await page.evaluate(() => { document.body.innerHTML = '<b/>'; });\n",
        "await page.getByText('x').click();\n",
    ),
    (
        "text-transform-uppercase",
        "src/s.js",
        "const s = { textTransform: 'uppercase' };\n",
        "const s = { textTransform: 'none' };\n",
    ),
    (
        "text-transform-uppercase",
        "src/s.jsx",
        "export const C = () => <b style={{ textTransform: 'uppercase' }} />;\n",
        "export const C = () => <b style={{ textTransform: 'none' }} />;\n",
    ),
    (
        "commented-out-code",
        "src/x.js",
        "// const old = compute(1);\n// setOpen(false);\n",
        "// x = 5 means five;\n// Retry (twice);\n// If the user returns early we keep the draft.\n",
    ),
    (
        "commented-out-code",
        "src/x.jsx",
        "// <Old prop={1} />\n// state.count = next + 1;\n",
        "// x = 5 means five;\n// Retry (twice);\n",
    ),
    (
        "commented-out-code",
        "src/x.tsx",
        "// const y = await load(id);\n// a.b = c ? d : e;\n",
        "// x = 5 means five;\n// Retry (twice);\n",
    ),
    ("text-transform-uppercase", "src/s.ts", "const s = { textTransform: 'uppercase' };\n", "const s = {};\n"),
    ("e2e-setcontent", "apps/web/e2e/a.spec.tsx", "await page.setContent('<p>');\n", "await page.goto('/');\n"),
    (
        "e2e-external-url",
        "apps/web/e2e/a.spec.tsx",
        "const u = 'https://cdn.jsdelivr.net/x.js';\n",
        "const u = 'http://localhost:5410/';\n",
    ),
    (
        "e2e-dom-injection",
        "apps/web/e2e/a.spec.tsx",
        "await page.evaluate(() => { document.body.appendChild(document.createElement('b')); });\n",
        "await page.getByRole('button').click();\n",
    ),
    (
        "duplicate-literal",
        "contracts/src/limits.tsp",
        "const MAX = 4000;\nenum L { MAX: 4000 }\n",
        "const MAX = 4000;\nconst MS = 1000;\nconst K = 1000;\n",
    ),
]


def _run(tmp: Path, path: str, content: str) -> dict[str, object]:
    repo = init_repo(tmp / "r")
    commit_all(repo)
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    (tmp / "c.toml").write_text(CONTRACT)
    _, report = check(repo, tmp / "c.toml", tmp / "out")
    return report


@pytest.mark.parametrize(("rule", "path", "positive", "negative"), CASES)
def test_rule_positive(tmp_path: Path, rule: str, path: str, positive: str, negative: str) -> None:
    assert findings(_run(tmp_path, path, positive), rule), f"{rule} missed {positive!r}"


@pytest.mark.parametrize(("rule", "path", "positive", "negative"), CASES)
def test_rule_negative(tmp_path: Path, rule: str, path: str, positive: str, negative: str) -> None:
    assert findings(_run(tmp_path, path, negative), rule) == []


def test_e2e_rules_ignore_app_code(tmp_path: Path) -> None:
    assert findings(_run(tmp_path, "src/a.ts", "await page.setContent('<p>');\n"), "e2e-setcontent") == []


def test_preexisting_violation_not_reported(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "c.tsx").write_text("export const C = () => <div style={{ display: 'flex' }} />;\n")
    commit_all(repo)
    (repo / "c.tsx").write_text("export const C = () => <div style={{ display: 'flex' }} />;\nexport const D = 1;\n")
    (tmp_path / "c.toml").write_text(CONTRACT)
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert report["findings"] == []


def test_every_packaged_rule_has_a_case() -> None:
    # Per (rule, language): a rule variant whose grammar silently stopped matching must not hide
    # behind a passing case for another language.
    ext_lang = {e: lang for lang, exts in rules_mod.LANG_EXT.items() for e in exts}
    covered = {(rule, ext_lang.get(Path(path).suffix)) for rule, path, _, _ in CASES}
    variants = {(r.id, r.language) for r in rules_mod.load_rules()}
    assert variants - covered == set()


def test_missing_ast_grep_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "executable", str(tmp_path / "nowhere" / "python"))
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(ToolError, match="ast-grep"):
        rules_mod.find_ast_grep()


def test_wrong_ast_grep_version_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = tmp_path / "ast-grep"
    fake.write_text("#!/bin/sh\necho 'ast-grep 0.1.0'\n")
    fake.chmod(0o755)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "python"))
    with pytest.raises(ToolError, match=r"0\.51\.0"):
        rules_mod.find_ast_grep()


def test_match_reported_when_added_line_is_inside_the_range(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "c.tsx").write_text("export const C = () => <div style={{\n  display: 'block',\n}} />;\n")
    commit_all(repo)
    (repo / "c.tsx").write_text("export const C = () => <div style={{\n  display: 'flex',\n}} />;\n")
    (tmp_path / "c.toml").write_text(CONTRACT)
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert [f["line"] for f in findings(report, "inline-style-static")] == [2]
