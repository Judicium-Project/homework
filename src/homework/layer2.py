"""``homework review`` orchestration: trusted spec + diff -> reviewers -> review.json + fix-round.md."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any, TextIO

from . import __version__, trust
from .gitdiff import _DIFF_OPTS, git
from .models import ToolError
from .redact import looks_secret
from .report import clean_text
from .review import MAX_DIFF_BYTES, Reviewer, ReviewResult, build_prompt, merge, run_reviewers

EXIT_CODES = {"pass": 0, "fail": 1, "error": 2, "pass-partial": 3}
LAYER2_HEADING = "## Fix round (homework review, layer 2)"


def collect_diff(
    root: Path, base: str, head: str | None, *, allow_secrets_risk: bool = False, log: TextIO | None = None
) -> str:
    """Unified diff base..head (or base..working tree, including untracked files).

    The list of files about to be sent is printed to ``log`` (stderr). Untracked files are not
    covered by .gitignore review the way commits are, so one that looks like it holds a secret
    stops the run unless ``allow_secrets_risk`` is set; so does a secret-looking name or added line
    of a tracked file.
    """
    log = log if log is not None else sys.stderr
    revs = [base] if head is None else [base, head]
    git(root, "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}")
    if head is not None:
        git(root, "rev-parse", "--verify", "--quiet", f"{head}^{{commit}}")
    parts = [git(root, "diff", *_DIFF_OPTS, *revs)]
    changed = [os.fsdecode(n) for n in git(root, "diff", "-z", "--name-only", *revs).split(b"\0") if n]
    untracked: list[str] = []
    if head is None:
        others = git(root, "ls-files", "-z", "--others", "--exclude-standard").split(b"\0")
        untracked = [n for n in (os.fsdecode(o) for o in others if o) if not n.endswith("/") and (root / n).is_file()]
    print(f"homework review: sending the diff of {len(changed) + len(untracked)} file(s) to the reviewers:", file=log)
    for name in changed:
        print(f"  {clean_text(name)}", file=log)
    for name in untracked:
        print(f"  {clean_text(name)} (untracked)", file=log)
    risky = []
    # Every file sent is checked, not only untracked ones: a secret committed by the agent (or sitting
    # in a modified tracked file) reaches the reviewers just the same. Tracked files are judged by
    # their added lines only, so removing a secret does not block the review of that removal.
    kept = {os.fsdecode(n) for n in git(root, "diff", "-z", "--name-only", "--diff-filter=d", *revs).split(b"\0") if n}
    tracked_added = _added_lines(parts[0])
    for name in changed:
        if name in kept and (why := looks_secret(name, "")):
            risky.append(f"{clean_text(name)} ({why})")
    for path, text in tracked_added.items():
        if why := looks_secret("", text):
            risky.append(f"{clean_text(path)} ({why})")
    for name in untracked:
        why = looks_secret(name, (root / name).read_bytes()[:1_000_000].decode("utf-8", "replace"))
        if why:
            risky.append(f"{clean_text(name)} ({why})")
    if risky and not allow_secrets_risk:
        raise ToolError(
            "file(s) in the diff look like they hold a secret and would be sent to third-party reviewers: "
            + "; ".join(risky)
            + ". Remove or ignore them, or pass --allow-secrets-risk"
        )
    if head is None:
        for name in untracked:
            # --no-index exits 1 when the files differ, which is always the case here.
            part = git(
                root, "diff", "--no-index", "--no-ext-diff", "--text", "--no-textconv", "--", "/dev/null", name,
                check=False,
            )  # fmt: skip
            if not part:
                raise ToolError(f"could not diff untracked file {name!r}")
            parts.append(part)
    diff = b"".join(parts)
    if len(diff) > MAX_DIFF_BYTES:
        raise ToolError(
            f"diff is {len(diff)} bytes, over the {MAX_DIFF_BYTES}-byte review limit; split the task or review by path"
        )
    return clean_text(os.fsdecode(diff))


def _added_lines(diff: bytes) -> dict[str, str]:
    """Added lines of a unified diff, grouped by the post-image path ("+++ b/<path>")."""
    added: dict[str, list[str]] = {}
    current: list[str] = []
    for raw in diff.split(b"\n"):
        line = raw.decode("utf-8", "replace")
        if line.startswith("+++ "):
            # Quoted (escaped) paths stay as git printed them; they only label the finding.
            path = line[4:].rstrip("\t")
            current = added.setdefault(path[2:] if path.startswith("b/") else path, [])
        elif line.startswith("+"):
            current.append(line[1:])
    return {k: "\n".join(v) for k, v in added.items()}


def build_spec(
    root: Path, base: str, head: str | None, contract: Path, task: Path | None, trust_worktree: bool
) -> tuple[str, list[str]]:
    """Task + contract text from a source the agent cannot have edited, plus tamper warnings."""
    warnings: list[str] = []
    parts: list[str] = []
    files: list[tuple[str, trust.TrustedFile, Path]] = []
    if task is not None:
        files.append(("task", trust.load(root, base, head, task, "task", trust_worktree), task))
    files.append(("contract", trust.load(root, base, head, contract, "contract", trust_worktree), contract))
    for kind, tf, path in files:
        if tf.modified and tf.repo_path:
            warnings.append(f"{kind} '{tf.repo_path}' was modified by the agent; the base version was reviewed")
        parts.append(f"=== {kind}: {tf.repo_path or path.name} ===\n{tf.text.rstrip()}\n")
    return "\n".join(parts), warnings


def _layer2_section(status: str, results: Sequence[ReviewResult]) -> str:
    """Instructions for the agent. Reviewer text is already redacted (see ``review_one``)."""
    lines = [LAYER2_HEADING, ""]
    answered = [r for r in results if r.answer]
    failing = [r for r in answered if r.status in ("incomplete", "wrong")]
    problems = [(r.reviewer, f) for r in failing for f in r.answer["findings"] if f["severity"] != "info"]  # type: ignore[index]
    items = [
        (r.reviewer, i)
        for r in failing
        for i in r.answer["items"]  # type: ignore[index]
        if i["status"] in ("missing", "partial", "wrong")
    ]
    # On a pass, warnings (e.g. scope creep the task may have accepted) still go to the human.
    warnings = [
        (r.reviewer, f)
        for r in answered
        if r.status not in ("incomplete", "wrong")
        for f in r.answer["findings"]  # type: ignore[index]
        if f["severity"] == "warning"
    ]
    errored = [r for r in results if r.status == "error"]
    steered = [r for r in results if r.status in ("invalid", "suspicious")]
    unverified = [r for r in results if r.status == "unverified"]

    def where(f: dict[str, object]) -> str:
        w = str(f["file"] or "(repository)")
        return w + (f":{f['line']}" if f["line"] else "")

    if status in ("pass", "pass-partial") and not problems:
        if warnings:
            n = len(warnings)
            lines.append(f"Result: {status}, {n} warning{'s' if n != 1 else ''} (for the human reviewer, not to fix).")
            for k, (who, f) in enumerate(warnings, 1):
                lines.append(f"W{k:03d}. [{who}] {f['kind']} (warning) {where(f)}")
                lines.append(f"   {f['message']}")
        else:
            lines.append("Independent reviewers found nothing to fix.")
    else:
        lines += [
            "Independent reviewers compared your diff with the task. Fix every item below, then stop.",
            "Change only what an item asks for; do not add features the task does not ask for.",
            "",
        ]
        n = 0
        for who, i in items:
            n += 1
            ev = f" ({i['evidence']})" if i["evidence"] else ""
            lines.append(f"R{n:03d}. [{who}] criterion {i['status']}: {i['criterion']}{ev}")
            lines.append(f"   {i['note']}")
        for who, f in problems:
            n += 1
            lines.append(f"R{n:03d}. [{who}] {f['kind']} ({f['severity']}) {where(f)}")
            lines.append(f"   {f['message']}")
    if steered:
        lines.append("")
        lines.append(
            "WARNING: possible prompt injection. These reviewers gave no valid answer or used tools, "
            "which a plain review never needs: " + ", ".join(r.reviewer for r in steered) + "."
        )
        lines.append("Do not put instructions for reviewers into code, comments or files. A human must check this run.")
    if unverified:
        lines.append("")
        lines.append(
            "Reviewer(s) that could verify no criterion from the diff (human check needed): "
            + ", ".join(r.reviewer for r in unverified)
        )
    if errored:
        lines.append("")
        lines.append("Reviewer(s) that failed to run: " + ", ".join(r.reviewer for r in errored))
    return clean_text("\n".join(lines)) + "\n"


def write_fix_round(out: Path, section: str) -> None:
    """Replace the layer-2 section of fix-round.md, keeping the layer-1 part written by ``check``."""
    path = out / "fix-round.md"
    existing = path.read_text(encoding="utf-8") if path.is_file() else ""
    idx = existing.find(LAYER2_HEADING)
    if idx != -1:
        existing = existing[:idx]
    existing = existing.rstrip("\n")
    path.write_text((existing + "\n\n" if existing else "") + section, encoding="utf-8")


def run_review(
    *,
    repo: Path,
    base: str,
    head: str | None,
    contract: Path,
    task: Path | None,
    out: Path | None,
    reviewers: Sequence[Reviewer],
    timeout: float,
    trust_worktree_contract: bool = False,
    raw_dir: Path | None = None,
    attempts: int = 2,
    allow_secrets_risk: bool = False,
) -> tuple[int, dict[str, Any]]:
    root = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip())
    if out is None:
        out = Path(git(root, "rev-parse", "--absolute-git-dir").decode().strip()) / "homework"
    out.mkdir(parents=True, exist_ok=True)
    # A stale verdict must not survive a run that errors out.
    (out / "review.json").unlink(missing_ok=True)
    spec, warnings = build_spec(root, base, head, contract, task, trust_worktree_contract)
    diff = collect_diff(root, base, head, allow_secrets_risk=allow_secrets_risk)
    if not diff.strip():
        raise ToolError("empty diff: nothing to review")
    prompt = build_prompt(spec, diff)
    results = run_reviewers(reviewers, prompt, timeout, attempts)
    status = merge(results)
    base_sha = git(root, "rev-parse", f"{base}^{{commit}}").decode().strip()
    report: dict[str, Any] = {
        "schema_version": 1,
        "tool": {"name": "homework", "version": __version__},
        "layer": 2,
        "status": status,
        "base": base,
        "base_sha": base_sha,
        "head": head,
        "warnings": warnings,
        "reviewers": [r.to_json() for r in results],
    }
    (out / "review.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_fix_round(out, _layer2_section(status, results))
    if raw_dir is not None:
        raw_dir.mkdir(parents=True, exist_ok=True)
        for r in results:
            for n, text in enumerate(r.raw, 1):
                (raw_dir / f"{r.reviewer}-{n}.txt").write_text(text, encoding="utf-8")
    return EXIT_CODES[status], report
