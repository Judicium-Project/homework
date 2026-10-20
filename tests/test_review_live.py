"""Real reviewer calls (quota!). Run explicitly: uv run pytest --live -m live."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from conftest import FIXTURES
from homework.layer2 import run_review
from homework.review import REVIEWERS


@pytest.mark.live
@pytest.mark.parametrize("name", ["codex", "agy"])
def test_live_g45(name: str, fixture_repo: Callable[[str], Path], tmp_path: Path) -> None:
    repo = fixture_repo("g45")
    code, report = run_review(
        repo=repo,
        base="HEAD",
        head=None,
        contract=FIXTURES / "g45" / "contract.toml",
        task=FIXTURES / "g45" / "task.md",
        out=tmp_path / "out",
        reviewers=[REVIEWERS[name]()],
        timeout=900,
    )
    assert report["reviewers"][0]["status"] in ("incomplete", "wrong")
    assert code == 1
