"""Command-line interface."""

from __future__ import annotations

import sys
import traceback
from pathlib import Path
from typing import Annotated, Any

import typer

from . import __version__, trust
from .adapters import acceptance, agentdiff, deps, integrity, rules, scope, tests_guard
from .adapters.acceptance import RunRecord
from .context import CheckContext
from .contract import DEFAULT_CONTRACT, load_contract_text, merge_frontmatter, parse_frontmatter
from .gitdiff import collect, git
from .models import AdapterResult, Finding, Severity, ToolError
from .report import build, clean_text, failing, fix_round, number, write

app = typer.Typer(
    add_completion=False, no_args_is_help=True, help="Verify AI-agent code changes against a task contract."
)

# 3 = no findings but acceptance was skipped ("pass-partial"): a pipeline that only tests "== 0"
# must not mistake static-only checks for a verified change.
EXIT_CLEAN, EXIT_FINDINGS, EXIT_ERROR, EXIT_PARTIAL = 0, 1, 2, 3
OUTPUT_FILES = ("report.json", "fix-round.md", "acceptance.log")


def _clear_outputs(out: Path) -> None:
    # A stale "pass" report from an earlier run must never survive a run that errors out.
    for name in OUTPUT_FILES:
        (out / name).unlink(missing_ok=True)


@app.callback()
def main() -> None:
    """homework: don't let the agent grade its own homework."""


def run_check(
    *,
    repo: Path,
    base: str,
    head: str | None,
    contract: str | None,
    task: Path | None,
    out: Path | None,
    run_acceptance: bool,
    with_agentdiff: bool,
    timeout: float,
    trust_worktree_contract: bool = False,
    require_acceptance: bool = False,
    isolate_home: bool = False,
) -> tuple[int, dict[str, Any]]:
    if out is not None:
        _clear_outputs(out)
    root = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip())
    if out is None:
        # Inside .git so report files never show up as untracked changes in the next check.
        git_dir = Path(git(root, "rev-parse", "--absolute-git-dir").decode().strip())
        out = git_dir / "homework"
        _clear_outputs(out)
    changes = collect(root, base, head)  # also verifies that base/head exist
    trust_res = AdapterResult("trust", "ran")
    cpath = trust.resolve_contract(contract, root, base)
    cfile = trust.load(root, base, head, cpath, "contract", trust_worktree_contract)
    c = load_contract_text(cfile.text, cpath)
    tampered = []
    if cfile.modified and cfile.repo_path:
        tampered.append(cfile.repo_path)
        trust_res.findings.append(trust.finding("contract", cfile.repo_path))
    if task is not None:
        tfile = trust.load(root, base, head, task, "task", trust_worktree_contract)
        merge_frontmatter(c, parse_frontmatter(tfile.text, str(task)))
        if tfile.modified and tfile.repo_path:
            tampered.append(tfile.repo_path)
            trust_res.findings.append(trust.finding("task", tfile.repo_path))
    ctx = CheckContext(changes, c, out, run_acceptance=run_acceptance, timeout=timeout, isolate_home=isolate_home)
    if tampered:
        ctx.acceptance_blocked = f"not run: {', '.join(tampered)} modified by the agent"
    results: list[AdapterResult] = [
        trust_res,
        scope.run(ctx),
        integrity.run(ctx),
        deps.run(ctx),
        tests_guard.run(ctx),
        rules.run(ctx),
    ]
    try:
        acc, run_records = acceptance.run(ctx)
    except ToolError as exc:
        # Keep the static findings: write a failing report, then still exit 2.
        acc = AdapterResult("acceptance", "ran", f"error: {exc}")
        acc.findings.append(
            Finding("acceptance-error", Severity.ERROR, f"Acceptance could not run: {exc}", adapter="acceptance")
        )
        results.append(acc)
        _finish(ctx, results, [], out)
        raise
    results.append(acc)
    if require_acceptance and acc.status == "skipped":
        acc.findings.append(
            Finding(
                "acceptance-not-run",
                Severity.ERROR,
                f"Acceptance commands were required but not run ({acc.detail}).",
                adapter="acceptance",
            )
        )
    if with_agentdiff:
        results.append(agentdiff.run(ctx))
    else:
        results.append(AdapterResult("agentdiff", "skipped", "enable with --with-agentdiff"))
    return _finish(ctx, results, run_records, out)


def _finish(
    ctx: CheckContext, results: list[AdapterResult], run_records: list[RunRecord], out: Path
) -> tuple[int, dict[str, Any]]:
    all_findings: list[Finding] = number([f for r in results for f in r.findings])
    report = build(ctx, results, all_findings, run_records)
    write(out, report, fix_round(ctx, all_findings))
    if failing(all_findings):
        return EXIT_FINDINGS, report
    return (EXIT_PARTIAL if report["status"] == "pass-partial" else EXIT_CLEAN), report


@app.command()
def check(
    base: Annotated[str, typer.Option(help="Base revision (state before the agent ran).")],
    head: Annotated[str | None, typer.Option(help="Head revision; default: the working tree.")] = None,
    contract: Annotated[str | None, typer.Option(help=f"Contract TOML; default: <repo>/{DEFAULT_CONTRACT}.")] = None,
    task: Annotated[
        Path | None, typer.Option(help="Task markdown whose YAML frontmatter extends the contract.")
    ] = None,
    repo: Annotated[Path, typer.Option(help="Repository to check.")] = Path("."),
    out: Annotated[Path | None, typer.Option(help="Output directory; default: <git-dir>/homework.")] = None,
    no_run: Annotated[bool, typer.Option("--no-run", help="Do not run acceptance commands.")] = False,
    with_agentdiff: Annotated[bool, typer.Option("--with-agentdiff", help="Add agentdiff as an extra signal.")] = False,
    timeout: Annotated[float, typer.Option(help="Per-command timeout in seconds.")] = 1800.0,
    trust_worktree_contract: Annotated[
        bool,
        typer.Option(
            "--trust-worktree-contract",
            help="Allow a contract/task inside the repo that is missing from --base (you wrote it, not the agent).",
        ),
    ] = False,
    require_acceptance: Annotated[
        bool,
        typer.Option("--require-acceptance", help="Fail (exit 1) if acceptance commands are skipped for any reason."),
    ] = False,
    isolate_home: Annotated[
        bool,
        typer.Option("--isolate-home", help="Run acceptance commands with an empty temporary HOME."),
    ] = False,
) -> None:
    """Layer 1: deterministic checks. Exit 0 = pass, 1 = findings, 2 = tool/input error,
    3 = pass-partial (no findings, acceptance not run)."""
    try:
        code, report = run_check(
            repo=repo,
            base=base,
            head=head,
            contract=contract,
            task=task,
            out=out,
            run_acceptance=not no_run,
            with_agentdiff=with_agentdiff,
            timeout=timeout,
            trust_worktree_contract=trust_worktree_contract,
            require_acceptance=require_acceptance,
            isolate_home=isolate_home,
        )
    except ToolError as exc:
        typer.echo(f"homework: error: {clean_text(str(exc))}", err=True)
        raise typer.Exit(EXIT_ERROR) from exc
    except Exception as exc:
        # A crash is never a verdict: report it as a tool error, not as findings (1) or success (0).
        traceback.print_exc(file=sys.stderr)
        typer.echo(f"homework: internal error: {exc!r}", err=True)
        raise typer.Exit(EXIT_ERROR) from exc
    summary = report["summary"]
    status = report["status"]
    typer.echo(f"homework check: {status} {summary}")
    for f in report["findings"]:
        loc = f["file"] or "-"
        if f["line"]:
            loc += f":{f['line']}"
        typer.echo(f"  {f['id']} {f['severity']:7} {f['rule']:24} {loc}  {f['message']}")
    raise typer.Exit(code)


@app.command()
def review(
    base: Annotated[str, typer.Option(help="Base revision (state before the agent ran).")],
    head: Annotated[str | None, typer.Option(help="Head revision; default: the working tree.")] = None,
    contract: Annotated[str | None, typer.Option(help=f"Contract TOML; default: <repo>/{DEFAULT_CONTRACT}.")] = None,
    task: Annotated[Path | None, typer.Option(help="Task markdown (the specification the reviewers check).")] = None,
    repo: Annotated[Path, typer.Option(help="Repository to review.")] = Path("."),
    out: Annotated[Path | None, typer.Option(help="Output directory; default: <git-dir>/homework.")] = None,
    reviewer: Annotated[
        list[str] | None,
        typer.Option(help="Reviewer to run (repeatable): codex, agy. Default: codex."),
    ] = None,
    timeout: Annotated[float, typer.Option(help="Per-call timeout in seconds.")] = 600.0,
    trust_worktree_contract: Annotated[
        bool,
        typer.Option(
            "--trust-worktree-contract",
            help="Allow a contract/task inside the repo that is missing from --base (you wrote it, not the agent).",
        ),
    ] = False,
    allow_secrets_risk: Annotated[
        bool,
        typer.Option(
            "--allow-secrets-risk",
            help="Send the diff even if a file in it looks like it holds a secret (key, token, .env).",
        ),
    ] = False,
) -> None:
    """Layer 2: independent model reviewers (sends the diff to third-party models).
    Exit 0 = pass, 1 = fix (a reviewer says incomplete/wrong, gave no valid answer, or used tools),
    2 = tool error (bad input, secret in the diff, every reviewer failed to run),
    3 = pass-partial: a human must approve (a reviewer failed to run or could verify nothing)."""
    from .layer2 import run_review
    from .review import REVIEWERS

    names = reviewer or ["codex"]
    try:
        unknown = [n for n in names if n not in REVIEWERS]
        if unknown:
            raise ToolError(f"unknown reviewer(s): {', '.join(unknown)} (choose from {', '.join(REVIEWERS)})")
        root = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip())
        cpath = trust.resolve_contract(contract, root, base)
        code, report = run_review(
            repo=repo,
            base=base,
            head=head,
            contract=cpath,
            task=task,
            out=out,
            reviewers=[REVIEWERS[n]() for n in dict.fromkeys(names)],
            timeout=timeout,
            trust_worktree_contract=trust_worktree_contract,
            allow_secrets_risk=allow_secrets_risk,
        )
    except ToolError as exc:
        typer.echo(f"homework: error: {clean_text(str(exc))}", err=True)
        raise typer.Exit(EXIT_ERROR) from exc
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        typer.echo(f"homework: internal error: {exc!r}", err=True)
        raise typer.Exit(EXIT_ERROR) from exc
    typer.echo(f"homework review: {report['status']}")
    for w in report["warnings"]:
        typer.echo(f"  warning: {w}")
    for r in report["reviewers"]:
        line = f"  {r['reviewer']:6} {r['status']:10} calls={r['calls']}"
        if r["error"]:
            line += f"  {r['error']}"
        typer.echo(line)
        for f in (r["answer"] or {}).get("findings", []):
            loc = f["file"] or "-"
            if f["line"]:
                loc += f":{f['line']}"
            typer.echo(f"    {f['severity']:7} {f['kind']:14} {loc}  {f['message']}")
    raise typer.Exit(code)


@app.command()
def version() -> None:
    """Print the version."""
    typer.echo(__version__)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(app())
