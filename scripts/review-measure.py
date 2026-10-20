"""A3 measurement: run the real reviewers on corpus fixtures and keep raw answers.

Usage: uv run python scripts/review-measure.py [--only codex|agy] [--no-retry] [--tag T] <fixture> ...
Writes measurements/<fixture>[-T]/{review.json,<reviewer>-<n>.txt}. Costs model quota.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

from conftest import FIXTURES, commit_all, init_repo, sh  # noqa: E402
from homework.layer2 import run_review  # noqa: E402
from homework.review import REVIEWERS  # noqa: E402


def build(name: str, tmp: Path) -> Path:
    import shutil

    repo = init_repo(tmp / name)
    base = FIXTURES / name / "base"
    if base.is_dir():
        shutil.copytree(base, repo, dirs_exist_ok=True)
    commit_all(repo)
    sh(repo, "git", "apply", "--whitespace=nowarn", str(FIXTURES / name / "change.diff"))
    return repo


def main(names: list[str], who: list[str], attempts: int, tag: str) -> None:
    for name in names:
        dest = ROOT / "measurements" / (f"{name}-{tag}" if tag else name)
        with tempfile.TemporaryDirectory() as tmp:
            repo = build(name, Path(tmp))
            code, report = run_review(
                repo=repo,
                base="HEAD",
                head=None,
                contract=FIXTURES / name / "contract.toml",
                task=FIXTURES / name / "task.md",
                out=Path(tmp) / "out",
                reviewers=[REVIEWERS[w]() for w in who],
                attempts=attempts,
                timeout=900,
                raw_dir=dest,
            )
            (dest / "review.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
            (dest / "fix-round.md").write_text((Path(tmp) / "out" / "fix-round.md").read_text())
        print(name, code, [(r["reviewer"], r["status"], r["calls"], r["error"]) for r in report["reviewers"]])


if __name__ == "__main__":
    # --only codex / --no-retry keep real calls inside a fixed quota budget.
    args = sys.argv[1:]
    who = ["codex", "agy"]
    if "--only" in args:
        i = args.index("--only")
        who = [args[i + 1]]
        del args[i : i + 2]
    attempts = 2
    if "--no-retry" in args:
        args.remove("--no-retry")
        attempts = 1
    tag = ""
    if "--tag" in args:
        i = args.index("--tag")
        tag = args[i + 1]
        del args[i : i + 2]
    main(args, who, attempts, tag)
