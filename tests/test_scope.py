from __future__ import annotations

import os
from pathlib import Path

from conftest import GIT_ID, commit_all, init_repo, sh
from helpers import check, findings, rules_of

CONTRACT = """
version = 1
allowed_paths = ["apps/web/**", "contract.toml"]
required_paths = ["apps/web/src/main.ts"]
[forbidden]
paths = ["apps/web/e2e/**"]
paths_except = ["apps/web/e2e/new.spec.ts"]
patterns = [{ regex = 'text-transform:\\s*(?!none)\\S', globs = ["**/*.css"] }]
"""


def _repo(tmp: Path) -> Path:
    repo = init_repo(tmp / "r")
    (repo / "apps/web/src").mkdir(parents=True)
    (repo / "apps/web/src/main.ts").write_text("export const a = 1;\n")
    (repo / "secret.txt").write_text("s\n")
    commit_all(repo)
    (tmp / "c.toml").write_text(CONTRACT)
    return repo


def test_untracked_out_of_scope_file(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "apps/web2").mkdir()
    (repo / "apps/web2/x.ts").write_text("x\n")
    (repo / "apps/web/src/main.ts").write_text("export const a = 2;\n")
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert code == 1
    assert [f["file"] for f in findings(report, "out-of-scope")] == ["apps/web2/x.ts"]


def test_required_untouched_and_forbidden(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "apps/web/e2e").mkdir()
    (repo / "apps/web/e2e/old.spec.ts").write_text("x\n")
    (repo / "apps/web/e2e/new.spec.ts").write_text("x\n")
    (repo / "apps/web/a.css").write_text(".a { text-transform: none; }\n.b { text-transform: uppercase; }\n")
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert code == 1
    assert [f["file"] for f in findings(report, "forbidden-path")] == ["apps/web/e2e/old.spec.ts"]
    assert [f["line"] for f in findings(report, "forbidden-pattern")] == [2]
    assert [f["file"] for f in findings(report, "required-untouched")] == ["apps/web/src/main.ts"]


def test_symlink_escape(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "apps/web/src/main.ts").write_text("export const a = 2;\n")
    os.symlink("../../secret.txt", repo / "apps/web/link")
    os.symlink("src/main.ts", repo / "apps/web/ok-link")
    _, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    assert [f["file"] for f in findings(report, "symlink-escape")] == ["apps/web/link"]


def test_contract_inside_repo_modified(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "contract.toml").write_text(CONTRACT)
    commit_all(repo, "add contract")
    base = "HEAD"
    (repo / "apps/web/src/main.ts").write_text("export const a = 2;\n")
    (repo / "contract.toml").write_text(CONTRACT.replace('"apps/web/**"', '"**"'))
    code, report = check(repo, repo / "contract.toml", tmp_path / "out", base=base)
    assert code == 1
    assert "contract-modified" in rules_of(report)


def test_head_revision_mode(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "outside.txt").write_text("x\n")
    (repo / "apps/web/src/main.ts").write_text("export const a = 2;\n")
    commit_all(repo, "agent")
    (repo / "untracked-later.txt").write_text("ignored: not part of HEAD\n")
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out", base="HEAD~1", head="HEAD")
    assert [f["file"] for f in findings(report, "out-of-scope")] == ["outside.txt"]
    assert code == 1


ALL = 'version = 1\nallowed_paths = ["**"]\n'


def test_untracked_nested_repo_is_an_error(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    sub = init_repo(repo / "vendor" / "sub")
    (sub / "evil.ts").write_text("export const x = 1;\n")
    commit_all(sub)
    (tmp_path / "c.toml").write_text(ALL)
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out")
    [hit] = findings(report, "nested-repo")
    assert hit["file"] == "vendor/sub" and hit["severity"] == "error" and code == 1


def _gitlink(repo: Path, path: str, sha: str, msg: str) -> str:
    # Staged directly: "git add -A" in commit_all would drop a gitlink whose directory is absent.
    sh(repo, "git", "update-index", "--add", "--cacheinfo", f"160000,{sha},{path}")
    sh(repo, "git", *GIT_ID, "commit", "-q", "-m", msg)
    return sh(repo, "git", "rev-parse", "HEAD").strip()


def test_submodule_added_and_changed_are_errors(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    base = commit_all(repo)
    added = _gitlink(repo, "lib", "1" * 40, "agent adds gitlink")
    (tmp_path / "c.toml").write_text(ALL)
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out", base=base, head=added)
    assert [f["file"] for f in findings(report, "submodule-changed")] == ["lib"] and code == 1
    moved = _gitlink(repo, "lib", "2" * 40, "agent moves gitlink")
    code, report = check(repo, tmp_path / "c.toml", tmp_path / "out", base=added, head=moved)
    assert [f["file"] for f in findings(report, "submodule-changed")] == ["lib"] and code == 1
