"""Acceptance runner: re-runs the contract's acceptance commands with every build cache disabled.

G45 "passed" lint/test/build from the moon cache without running anything. Commands therefore
(1) get cache-bypass flags injected (moon/turbo ``--force``, ``go test -count=1``), (2) run with
cache-disabling env vars as a second line of defence for wrappers like ``pnpm test`` that call
moon internally, and (3) have their output scanned for cache-hit markers. Commands come only
from the contract and never go through a shell.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import shlex
import signal
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO

from ..context import CheckContext
from ..models import AdapterResult, Finding, Severity, ToolError

NAME = "acceptance"

CACHE_ENV = {"MOON_CACHE": "off", "TURBO_FORCE": "true"}
GOFLAGS_COUNT = "-count=1"

CACHE_HIT = re.compile(
    r"\((?:cached|cached from remote)[,)]"  # moon task line / go test "ok pkg (cached)"
    r"|\([1-9]\d* cached\)"  # moon summary "Tasks: 5 completed (5 cached)"
    r"|\bcache hit\b"  # turbo "cache hit, replaying logs"
    r"|\bCached:\s+[1-9]\d* cached\b",  # turbo summary
    re.I,
)

_OPERATORS = {"&&"}
_UNSUPPORTED = {"|", "||", ";", "&", ">", ">>", "<", "<<", "(", ")", ";;", "|&", ">&", "<&"}
# The author of "$VAR" or "$(cmd)" expected a shell; running it literally would silently test the wrong thing.
_EXPANSION = re.compile(r"\$[({A-Za-z_]|`")
_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


@dataclass
class Step:
    argv: list[str]
    env: dict[str, str] = field(default_factory=dict)
    cd: str | None = None  # "cd <dir>" pseudo-step


def parse_command(command: str) -> list[Step]:
    """Split ``a && cd x && b`` into steps without a shell; anything fancier is rejected."""
    lex = shlex.shlex(command, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError as exc:
        raise ToolError(f"acceptance command cannot be parsed: {command!r}: {exc}") from exc
    steps: list[Step] = []
    current: list[str] = []

    def flush() -> None:
        if not current:
            raise ToolError(f"acceptance command has an empty step: {command!r}")
        env: dict[str, str] = {}
        while current and _ENV_ASSIGN.match(current[0]):
            key, _, value = current.pop(0).partition("=")
            env[key] = value
        if not current:
            raise ToolError(f"acceptance step only sets variables: {command!r}")
        if current[0] == "cd":
            if len(current) != 2:
                raise ToolError(f"'cd' needs exactly one directory: {command!r}")
            steps.append(Step([], env, cd=current[1]))
        else:
            steps.append(Step(list(current), env))
        current.clear()

    for tok in tokens:
        if _EXPANSION.search(tok):
            raise ToolError(
                f"acceptance command uses shell expansion in {tok!r} (commands run without a shell): {command!r}"
            )
        if tok in _OPERATORS:
            flush()
        elif tok in _UNSUPPORTED:
            raise ToolError(
                f"acceptance command uses unsupported shell syntax {tok!r} (only '&&' and 'cd' are "
                f"supported; commands run without a shell): {command!r}"
            )
        else:
            current.append(tok)
    flush()
    return steps


def _tool_index(argv: list[str], tool: str) -> int | None:
    # Look past package-manager launchers: "pnpm turbo run", "npx moon run", "pnpm exec moon run".
    for i, tok in enumerate(argv[:4]):
        if os.path.basename(tok) == tool:
            return i
    return None


def _insert_before_passthrough(argv: list[str], start: int, flag: str) -> list[str]:
    end = argv.index("--", start) if "--" in argv[start:] else len(argv)
    return [*argv[:end], flag, *argv[end:]]


def force_no_cache(argv: list[str]) -> list[str]:
    """Rewrite argv so the build tool cannot answer from its cache."""
    for tool in ("moon", "turbo"):
        i = _tool_index(argv, tool)
        if i is not None and "run" in argv[i + 1 : i + 2] and "--force" not in argv:
            return _insert_before_passthrough(argv, i + 1, "--force")
    i = _tool_index(argv, "go")
    if i is not None and argv[i + 1 : i + 2] == ["test"] and not any(a.startswith("-count") for a in argv):
        return [*argv[: i + 2], GOFLAGS_COUNT, *argv[i + 2 :]]
    return argv


ENV_ALLOW = ("PATH", "HOME", "LANG", "TMPDIR", "TERM", "CI")


def _base_env(passthrough: list[str]) -> dict[str, str]:
    """Only an allow-list of the caller's environment reaches acceptance commands.

    The commands come from the contract but run the agent's code (tests, build scripts); API
    tokens and credentials in the caller's environment must not be readable by that code.
    """
    allowed = set(ENV_ALLOW) | set(passthrough)
    return {k: v for k, v in os.environ.items() if k in allowed or k.startswith("LC_")}


def _env(extra: dict[str, str], passthrough: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    env = _base_env(passthrough)
    overrides = dict(CACHE_ENV)
    goflags = env.get("GOFLAGS", "")
    if "-count=" not in goflags:
        # GOFLAGS entries apply only to go subcommands that know the flag, so go build is unaffected.
        overrides["GOFLAGS"] = f"{goflags} {GOFLAGS_COUNT}".strip()
    overrides.update(extra)
    env.update(overrides)
    return env, overrides


def _tree_state(root: Path) -> str:
    """Fingerprint of the working tree (tracked diff + untracked file contents)."""
    h = hashlib.sha256()
    for args in (["git", "diff", "--binary", "HEAD"], ["git", "ls-files", "-z", "--others", "--exclude-standard"]):
        out = subprocess.run(args, cwd=root, capture_output=True, check=False).stdout
        h.update(out)
        if "--others" in args:
            for name in filter(None, out.split(b"\0")):
                p = root / os.fsdecode(name)
                if p.is_file():
                    h.update(p.read_bytes())
    return h.hexdigest()


def _changed_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd=root, capture_output=True, check=False
    ).stdout
    return sorted({os.fsdecode(e[3:]) for e in out.split(b"\0") if len(e) > 3})


@dataclass
class RunRecord:
    command: str
    steps: list[dict[str, object]]
    exit_code: int
    cache_marker: str | None
    output_tail: str
    timed_out: bool = False

    @property
    def cache_hit(self) -> bool:
        return self.cache_marker is not None


OUTPUT_TAIL = 1 << 20  # bytes of each step's output kept for the log
_CHUNK = 1 << 20
_OVERLAP = 256  # longer than any CACHE_HIT match, so a marker split across chunks is still found


def _kill_group(proc: subprocess.Popen[bytes]) -> None:
    # The command runs in its own session; killing the group also reaches grandchildren
    # (test runners, dev servers) that would otherwise outlive the check.
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)


def _scan_output(buf: IO[bytes]) -> tuple[str, str | None]:
    """Cache-marker search over the whole output, but only the last OUTPUT_TAIL bytes are kept."""
    buf.seek(0)
    hit: str | None = None
    prev = b""
    while chunk := buf.read(_CHUNK):
        window = prev + chunk
        if hit is None and (m := CACHE_HIT.search(window.decode("utf-8", errors="replace"))):
            hit = m.group(0)
        prev = window[-_OVERLAP:]
    size = buf.seek(0, os.SEEK_END)
    buf.seek(max(0, size - OUTPUT_TAIL))
    tail = buf.read().decode("utf-8", errors="replace")
    if size > OUTPUT_TAIL:
        tail = f"[... {size - OUTPUT_TAIL} bytes of output truncated ...]\n" + tail
    return tail, hit


def _execute(argv: list[str], cwd: Path, env: dict[str, str], timeout: float) -> tuple[int, str, str | None, bool]:
    timed_out = False
    # Output goes to a temp file, not a pipe: memory stays bounded and a grandchild that keeps the
    # pipe open cannot block us after the timeout.
    with tempfile.TemporaryFile() as buf:
        try:
            proc = subprocess.Popen(
                argv,
                cwd=cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=buf,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise ToolError(f"acceptance command not runnable, executable missing: {argv[0]}") from exc
        try:
            rc = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_group(proc)
            rc = proc.wait()
        except BaseException:
            _kill_group(proc)
            proc.wait()
            raise
        _kill_group(proc)  # leftover background children of a finished command
        out, hit = _scan_output(buf)
    return rc, out, hit, timed_out


def run_command(
    command: str,
    root: Path,
    log: list[str],
    timeout: float,
    passthrough: list[str] | None = None,
    home: Path | None = None,
) -> RunRecord:
    steps = parse_command(command)
    cwd = root
    records: list[dict[str, object]] = []
    output_tail = ""
    marker: str | None = None
    timed_out = False
    exit_code = 0
    log.append(f"$ {command}")
    for step in steps:
        if step.cd is not None:
            cwd = (cwd / step.cd).resolve()
            if not cwd.is_dir():
                raise ToolError(f"acceptance 'cd {step.cd}': no such directory")
            log.append(f"# cd {cwd.relative_to(root.resolve()) if cwd.is_relative_to(root.resolve()) else cwd}")
            continue
        argv = force_no_cache(step.argv)
        env, overrides = _env(step.env, passthrough or [])
        if home is not None:
            env["HOME"] = str(home)
        log.append(f"# argv: {shlex.join(argv)}")
        log.append("# env: " + " ".join(f"{k}={v}" for k, v in sorted(overrides.items())))
        rc, out, hit, timed_out = _execute(argv, cwd, env, timeout)
        output_tail = (output_tail + out)[-OUTPUT_TAIL:]
        marker = marker or hit
        log.append(out.rstrip("\n"))
        if timed_out:
            log.append(f"# timed out after {timeout:g}s; process group killed")
        log.append(f"# exit {rc}")
        proc_rc = rc
        records.append({"argv": argv, "cwd": str(cwd), "env": overrides, "exit_code": proc_rc})
        if timed_out or proc_rc != 0:
            exit_code = proc_rc
            break  # "&&" semantics
    return RunRecord(command, records, exit_code, marker, output_tail[-2000:], timed_out)


def run(ctx: CheckContext) -> tuple[AdapterResult, list[RunRecord]]:
    c = ctx.contract
    if ctx.acceptance_blocked:
        return AdapterResult(NAME, "skipped", ctx.acceptance_blocked), []
    if not ctx.run_acceptance:
        return AdapterResult(NAME, "skipped", "--no-run"), []
    if ctx.changes.head is not None:
        return AdapterResult(NAME, "skipped", "acceptance commands only run against the working tree"), []
    if not c.acceptance and not c.generated_by:
        return AdapterResult(NAME, "skipped", "contract has no acceptance commands"), []
    res = AdapterResult(NAME, "ran")
    log: list[str] = []
    records: list[RunRecord] = []
    try:
        if ctx.isolate_home:
            with tempfile.TemporaryDirectory(prefix="homework-home-") as home:
                log.append(f"# isolated HOME: {home}")
                _run_all(ctx, res, log, records, Path(home))
        else:
            _run_all(ctx, res, log, records)
    finally:
        # Written even when a command raises, so the evidence of what ran survives a tool error.
        ctx.out_dir.mkdir(parents=True, exist_ok=True)
        log_path = ctx.out_dir / "acceptance.log"
        log_path.write_text("\n".join(log) + "\n", encoding="utf-8")
        res.detail = f"log: {log_path}"
    return res, records


def _timeout_finding(command: str, timeout: float) -> Finding:
    return Finding(
        "acceptance-timeout",
        Severity.ERROR,
        f"Acceptance command did not finish within {timeout:g}s and was killed: {command}. "
        "Make it terminate (no watch mode, no hanging servers or prompts).",
        adapter=NAME,
    )


def _run_all(
    ctx: CheckContext, res: AdapterResult, log: list[str], records: list[RunRecord], home: Path | None = None
) -> None:
    c = ctx.contract
    root = ctx.root
    if c.generated_by:
        before, before_files = _tree_state(root), set(_changed_files(root))
        rec = run_command(c.generated_by, root, log, ctx.timeout, c.env_passthrough, home)
        records.append(rec)
        if rec.timed_out:
            res.findings.append(_timeout_finding(c.generated_by, ctx.timeout))
        elif rec.exit_code != 0:
            res.findings.append(
                Finding(
                    "generated-failed",
                    Severity.ERROR,
                    f"Generator '{c.generated_by}' failed (exit {rec.exit_code}).",
                    evidence=rec.output_tail[-500:],
                    adapter=NAME,
                )
            )
        elif _tree_state(root) != before:
            drift = sorted(set(_changed_files(root)) ^ before_files) or sorted(_changed_files(root))
            res.findings.append(
                Finding(
                    "generated-drift",
                    Severity.ERROR,
                    f"Running '{c.generated_by}' changed the tree: generated files were edited by hand or not "
                    "regenerated. Never edit generated files; change the source and rerun the generator.",
                    evidence=", ".join(drift)[:500],
                    adapter=NAME,
                )
            )
    for command in c.acceptance:
        rec = run_command(command, root, log, ctx.timeout, c.env_passthrough, home)
        records.append(rec)
        if rec.timed_out:
            res.findings.append(_timeout_finding(command, ctx.timeout))
        elif rec.exit_code != 0:
            res.findings.append(
                Finding(
                    "acceptance-failed",
                    Severity.ERROR,
                    f"Acceptance command failed (exit {rec.exit_code}): {command}",
                    evidence=rec.output_tail[-500:],
                    adapter=NAME,
                )
            )
        if rec.cache_hit:
            res.findings.append(
                Finding(
                    "acceptance-cache-hit",
                    Severity.ERROR,
                    f"Acceptance command reported cached results even with caches disabled: {command}. "
                    "A cached pass proves nothing; make the build tool honour --force / cache off.",
                    evidence=rec.cache_marker,
                    adapter=NAME,
                )
            )
