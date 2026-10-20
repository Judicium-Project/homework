from __future__ import annotations

from pathlib import Path

import pytest

from conftest import commit_all, init_repo
from helpers import check, findings

CONTRACT = 'version = 1\nallowed_paths = ["**"]\n[tests]\nexempt = ["legacy/**"]\n'
BASE_TEST = """import { it, expect } from "vitest";
it("a", () => {
  expect(add(1, 2)).toBe(3);
  expect(add(2, 2)).toBe(4);
});
"""


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "src").mkdir()
    (repo / "legacy").mkdir()
    (repo / "src/a.test.ts").write_text(BASE_TEST)
    (repo / "src/b.test.ts").write_text(BASE_TEST)
    (repo / "legacy/c.test.ts").write_text(BASE_TEST)
    (repo / "x_test.go").write_text("package x\n")
    commit_all(repo)
    (tmp / "c.toml").write_text(CONTRACT)
    return repo


def test_delete_skip_only_trivial_and_weakening(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "src/b.test.ts").unlink()
    (repo / "legacy/c.test.ts").unlink()  # exempt by contract
    (repo / "src/a.test.ts").write_text(
        'import { it, expect } from "vitest";\nit.only("a", () => {\n  expect(true).toBe(true);\n});\n'
        'describe.skip("b", () => {});\n'
    )
    (repo / "x_test.go").write_text('package x\nfunc TestX(t *testing.T) { t.Skip("later") }\n')
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert code == 1
    assert [f["file"] for f in findings(report, "test-deleted")] == ["src/b.test.ts"]
    assert [f["line"] for f in findings(report, "test-only")] == [2]
    assert sorted((f["file"], f["line"]) for f in findings(report, "test-skip")) == [
        ("src/a.test.ts", 5),
        ("x_test.go", 2),
    ]
    assert [f["line"] for f in findings(report, "assertion-trivial")] == [3]
    assert findings(report, "assertions-reduced")[0]["evidence"] == "-2 +1"


def test_adding_assertions_is_clean(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "src/a.test.ts").write_text(BASE_TEST.replace("});\n", "  expect(add(0, 0)).toBe(0);\n});\n", 1))
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert report["findings"] == [] and code == 3


def test_skip_marker_aliases_and_fail(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "src/a.test.ts").write_text(
        BASE_TEST
        + "const later = test.skip;\n"
        + "test.fail('x', () => {});\n"
        + "const { skip } = it; it['skip']('y', () => {});\n"
        + "test.describe.skip('z', () => {});\n"
        + "test.describe.only('w', () => {});\n"
        + "it.skip.each([1])('v', () => {});\n"
    )
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert sorted(f["line"] for f in findings(report, "test-skip")) == [6, 7, 8, 9, 11]
    assert [f["line"] for f in findings(report, "test-only")] == [10]


@pytest.mark.parametrize(
    ("path", "line", "rule"),
    [
        ("src/a.test.ts", "it.each([1, 2]).skip('v', () => {});", "test-skip"),
        ("src/a.test.ts", "test.describe.parallel.skip('z', () => {});", "test-skip"),
        ("src/a.test.ts", "test.describe.parallel.only('z', () => {});", "test-only"),
        ("test_x.py", "pytestmark = pytest.mark.skip", "test-skip"),
        ("test_x.py", "pytestmark = [pytest.mark.skipif(True, reason='x')]", "test-skip"),
        ("src/a.test.ts", "it('t', () => { expect (true).toBe(true); });", "assertion-trivial"),
    ],
)
def test_more_skip_and_trivial_forms(tmp_path: Path, path: str, line: str, rule: str) -> None:
    repo = _repo(tmp_path)
    target = repo / path
    target.write_text((target.read_text() if target.exists() else "") + line + "\n")
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert findings(report, rule), report["findings"]
