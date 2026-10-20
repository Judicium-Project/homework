"""KABUL A1/A2 regressions on the measured corpus (fixtures/)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from conftest import FIXTURES, commit_all, init_repo, sh
from helpers import check, findings, rules_of

Build = Callable[[str], Path]


def _run(build: Build, name: str, tmp_path: Path) -> tuple[int, dict[str, object]]:
    repo = build(name)
    return check(repo, FIXTURES / name / "contract.toml", tmp_path / "out")


# --- A1 ---------------------------------------------------------------------------------------


def test_a1_g45_1_required_path_untouched(tmp_path: Path) -> None:
    """G45-1 (K16): the agent's diff without the Composer change leaves a required path untouched."""
    repo = init_repo(tmp_path / "g45")
    import shutil

    shutil.copytree(FIXTURES / "g45" / "base", repo, dirs_exist_ok=True)
    commit_all(repo)
    sh(
        repo,
        "git",
        "apply",
        "--whitespace=nowarn",
        "--exclude=apps/web/src/features/chat/Composer.tsx",
        str(FIXTURES / "g45" / "change.diff"),
    )
    code, report = check(repo, FIXTURES / "g45" / "contract.toml", tmp_path / "out")
    assert code == 1
    hits = findings(report, "required-untouched")
    assert [h["file"] for h in hits] == ["apps/web/src/features/chat/Composer.tsx"]


@pytest.mark.xfail(
    strict=True,
    reason="G45-1 in the real diff: Composer.tsx IS touched; the missing send "
    "step is semantic and only layer 2 (review) can see it. Known layer-1 limit.",
)
def test_a1_g45_1_real_diff_semantic_half_done(fixture_repo: Build, tmp_path: Path) -> None:
    _, report = _run(fixture_repo, "g45", tmp_path)
    assert findings(report, "required-untouched")


def test_a1_g45_4a_duplicate_limit(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g45", tmp_path)
    assert code == 1
    dup = findings(report, "duplicate-literal")
    assert any(f["file"] == "contracts/src/limits.tsp" for f in dup)


def test_a1_g45_4b_inline_style(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g45", tmp_path)
    assert code == 1
    hits = findings(report, "inline-style-static")
    assert ("apps/web/src/features/chat/MessageItem.tsx", 283) in [(f["file"], f["line"]) for f in hits]


def test_a1_g46_1_fake_e2e(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g46", tmp_path)
    assert code == 1
    for rule in ("e2e-setcontent", "e2e-external-url"):
        assert any(f["file"] == "apps/web/e2e/konumlama.spec.ts" for f in findings(report, rule)), rule


def test_a1_g46_2_package_json_order(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g46", tmp_path)
    assert code == 1
    hits = findings(report, "package-json-reorder")
    assert len(hits) == 1
    assert hits[0]["file"] == "apps/web/package.json"
    assert "@chatapp/api-types" in hits[0]["evidence"] and "@chatapp/tokens" in hits[0]["evidence"]
    # The allowed dependency itself is not a finding.
    assert not findings(report, "dependency-not-allowed")


def test_a1_g46_5_menu_inline_style(fixture_repo: Build, tmp_path: Path) -> None:
    _, report = _run(fixture_repo, "g46", tmp_path)
    assert ("apps/web/src/ui/Menu.tsx", 210) in [
        (f["file"], f["line"]) for f in findings(report, "inline-style-static")
    ]


def test_a1_g46t1_1_window_dunder(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g46-tur1", tmp_path)
    assert code == 1
    hits = findings(report, "window-dunder-assign")
    assert [(f["file"], f["line"]) for f in hits] == [("apps/web/src/ui/Menu.tsx", 224)]


def test_a1_g46t1_2_e2e_dom_injection(fixture_repo: Build, tmp_path: Path) -> None:
    code, report = _run(fixture_repo, "g46-tur1", tmp_path)
    assert code == 1
    hits = findings(report, "e2e-dom-injection")
    assert hits and all(f["file"] == "apps/web/e2e/konumlama.spec.ts" for f in hits)


# --- A2 ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["clean-1", "clean-2"])
def test_a2_clean_no_false_alarm(fixture_repo: Build, tmp_path: Path, name: str) -> None:
    code, report = _run(fixture_repo, name, tmp_path)
    assert rules_of(report) == []
    assert code == 3
    assert report["status"] == "pass-partial"  # acceptance not run


def test_a2_clean2_important_is_not_flagged(fixture_repo: Build, tmp_path: Path) -> None:
    """clean-2 adds two `!important` declarations; they are legitimate and must stay silent."""
    repo = fixture_repo("clean-2")
    css = (repo / "apps/web/src/features/shell/shell.module.css").read_text(encoding="utf-8")
    assert css.count("!important") >= 2
    code, _ = check(repo, FIXTURES / "clean-2" / "contract.toml", tmp_path / "out")
    assert code == 3
