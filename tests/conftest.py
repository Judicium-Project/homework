"""Shared fixtures: rebuild a fixture's before/after tree in a throwaway git repo.

The base tree is fixtures/<name>/base/ (only the files change.diff touches, extracted by
scripts/fixtures-snapshot.sh), so tests never need the original source repository.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"
GIT_ID = ["-c", "user.name=homework-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"]


def sh(cwd: Path, *args: str) -> str:
    return subprocess.run(list(args), cwd=cwd, check=True, capture_output=True, text=True).stdout


def init_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    sh(path, "git", "init", "-q", "-b", "main")
    return path


def commit_all(repo: Path, msg: str = "base") -> str:
    sh(repo, "git", "add", "-A")
    sh(repo, "git", *GIT_ID, "commit", "-q", "--allow-empty", "-m", msg)
    return sh(repo, "git", "rev-parse", "HEAD").strip()


@pytest.fixture
def fixture_repo(tmp_path: Path) -> Callable[[str], Path]:
    def build(name: str) -> Path:
        repo = init_repo(tmp_path / name)
        base = FIXTURES / name / "base"
        if base.is_dir():
            shutil.copytree(base, repo, dirs_exist_ok=True)
        commit_all(repo)
        sh(repo, "git", "apply", "--whitespace=nowarn", str(FIXTURES / name / "change.diff"))
        return repo

    return build


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--live", action="store_true", help="run tests that call real model CLIs (costs quota)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--live"):
        return
    skip = pytest.mark.skip(reason="live model call; run with --live")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)
