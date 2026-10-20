"""Layer 2 against a hostile diff: the agent tries to steer or crash the reviewer, or to read secrets
back through fix-round.md. No model calls: fake reviewers and fake process runners."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from conftest import FIXTURES, commit_all, init_repo
from homework import review as rv
from homework.cli import app
from homework.layer2 import collect_diff, run_review
from homework.models import ToolError
from homework.redact import redact
from test_review import G45_ANSWER, GOOD, Fake, _schema

Proc = tuple[int, str, str]
KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----"
SECRETS = {
    "home": "/Users/bob/.ssh/config",
    "linux_home": "/home/bob/.aws/credentials",
    "tilde": "~/.netrc",
    "aws": "AKIAABCDEFGHIJKLMNOP",
    "openai": "sk-proj-abcdefghijklmnopqrstuvwx",
    "github": "ghp_" + "a1B2" * 9,
    "slack": "xoxb-123456789012-abcdef",
    "bearer": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "hex": "0123456789abcdef" * 3,
    "b64": "QUtJQUFCQ0RFRkdISUpLTE1OT1AxMjM0NTY3ODkwYWJjZGVm",
}


def _kw(tmp_path: Path, name: str = "clean-1") -> dict[str, Any]:
    from conftest import sh

    repo = init_repo(tmp_path / "repo")
    import shutil

    shutil.copytree(FIXTURES / name / "base", repo, dirs_exist_ok=True)
    commit_all(repo)
    sh(repo, "git", "apply", "--whitespace=nowarn", str(FIXTURES / name / "change.diff"))
    return {
        "repo": repo,
        "base": "HEAD",
        "head": None,
        "contract": FIXTURES / name / "contract.toml",
        "task": None,
        "out": tmp_path / "out",
        "timeout": 5,
    }


def _leaky_answer() -> dict[str, Any]:
    leak = " ".join(SECRETS.values())
    ans: dict[str, Any] = json.loads(json.dumps(G45_ANSWER))
    ans["summary"] = "summary " + leak
    ans["items"][0]["note"] = "note " + leak + "\n" + KEY
    ans["items"][0]["evidence"] = SECRETS["home"] + ":1"
    ans["findings"][0]["message"] = "msg " + leak
    return ans


# --- 1. redaction ----------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(SECRETS))
def test_redact_patterns(name: str) -> None:
    out = redact(f"x {SECRETS[name]} y")
    assert SECRETS[name] not in out
    assert out.startswith("x ") and out.endswith(" y")


def test_redact_keeps_repo_paths_and_real_home() -> None:
    p = "apps/web/src/features/chat/components/Composer.tsx:120"
    assert redact(p) == p
    assert redact("/opt/homebrew/bin/codex") == "/opt/homebrew/bin/codex"
    assert str(Path.home()) not in redact(f"see {Path.home()}/x")
    assert "PRIVATE KEY" not in redact(KEY) and "b3Bl" not in redact(KEY)


def test_fix_round_and_review_json_are_redacted(tmp_path: Path) -> None:
    kw = _kw(tmp_path)
    res = CliRunner().invoke(app, ["version"])  # warm import
    assert res.exit_code == 0
    code, rep = run_review(reviewers=[Fake("codex", [_leaky_answer()])], **kw)
    assert code == 1
    texts = {
        "fix-round": (kw["out"] / "fix-round.md").read_text(),
        "review.json": (kw["out"] / "review.json").read_text(),
        "report": json.dumps(rep),
    }
    for where, text in texts.items():
        for name, s in SECRETS.items():
            assert s not in text, f"{name} leaked into {where}"
        assert "PRIVATE KEY" not in text and "b3BlbnNz" not in text, where
    assert "Composer.tsx" in texts["fix-round"]


def test_codex_is_confined(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOMEWORK_CODEX_BIN", "/bin/codex-fake")
    monkeypatch.delenv("CODEX_HOME", raising=False)
    seen: dict[str, Any] = {}

    def runner(
        argv: list[str], stdin: str | None, cwd: Path, env: dict[str, str], timeout: float
    ) -> tuple[int, str, str]:
        seen.update(argv=argv, env=env, cwd=cwd)
        Path(argv[argv.index("--output-last-message") + 1]).write_text(json.dumps(GOOD))
        return 0, "", ""

    rv.CodexReviewer(runner=runner).ask("P", _schema(tmp_path), 10)
    argv, env = seen["argv"], seen["env"]
    joined = " ".join(argv)
    # No shell tool at all, and a permission profile that can read only the empty work dir.
    assert "shell_tool" in argv[argv.index("--disable") + 1]
    assert 'default_permissions="homework-review"' in joined
    assert '":root"' not in joined and '":workspace_roots"={"."="read"}' in joined
    assert "--sandbox" not in argv
    # The sandboxed helper re-executes the codex binary: that file is readable, its directory is not.
    assert '"/bin/codex-fake"="read"' in joined and '"/bin"=' not in joined
    # HOME is an empty temporary directory; auth comes from the official CODEX_HOME variable.
    assert env["HOME"] != str(Path.home()) and not Path(env["HOME"]).exists()
    assert env["CODEX_HOME"] == str(Path.home() / ".codex")


def _exe(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(0o755)
    return path


def _readable(argv: list[str]) -> str:
    return next(a for a in argv if a.startswith(f"permissions.{rv.CODEX_PROFILE}.filesystem="))


def test_codex_profile_reads_files_not_directories(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    real = _exe(tmp_path / "opt" / "codex" / "1.0" / "bin" / "codex")
    helper = _exe(real.parent / "codex-code-mode-host")
    _exe(real.parent / "other-tool")
    (real.parent / "codex-notes.txt").write_text("x")
    (tmp_path / "pbin").mkdir()
    link = tmp_path / "pbin" / "codex"
    link.symlink_to(real)
    _exe(tmp_path / "pbin" / "codex-wrapper")
    fs = _readable(rv.codex_lockdown(str(link)))
    for f in (link, real.resolve(), helper.resolve()):
        assert f'"{f}"="read"' in fs
    for bad in ("other-tool", "codex-notes.txt", "codex-wrapper"):
        assert bad not in fs
    for d in (link.parent, real.parent, real.resolve().parent):
        assert f'"{d}"=' not in fs


def test_codex_runs_by_resolved_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Measured with codex sandbox: exec through the symlink is denied (its directory is not readable),
    # exec of the target file works, so the session and its re-exec use the target.
    real = _exe(tmp_path / "opt" / "bin" / "codex")
    link = tmp_path / "pbin" / "codex"
    link.parent.mkdir()
    link.symlink_to(real)
    monkeypatch.setenv("HOMEWORK_CODEX_BIN", str(link))
    seen: dict[str, Any] = {}

    def runner(
        argv: list[str], stdin: str | None, cwd: Path, env: dict[str, str], timeout: float
    ) -> tuple[int, str, str]:
        seen["argv"] = argv
        Path(argv[argv.index("--output-last-message") + 1]).write_text(json.dumps(GOOD))
        return 0, "", ""

    rv.CodexReviewer(runner=runner).ask("P", _schema(tmp_path), 10)
    assert seen["argv"][0] == str(real.resolve())


@pytest.mark.parametrize("where", ["codex", "bin/codex"])
def test_codex_binary_in_home_or_home_child_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, where: str
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    binary = _exe(home / where)
    with pytest.raises(ToolError, match="codex binary"):
        rv.codex_lockdown(str(binary))
    _exe(home / "a" / "b" / "codex")
    rv.codex_lockdown(str(home / "a" / "b" / "codex"))


def test_codex_binary_dir_root_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ToolError, match="codex binary"):
        rv.check_codex_dir(Path("/"), Path("/Users/x"))
    rv.check_codex_dir(Path("/opt/homebrew/bin"), Path("/Users/x"))


def test_cli_codex_in_home_exit_2(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("HOMEWORK_CODEX_BIN", str(_exe(home / "codex")))
    repo = init_repo(tmp_path / "r")
    (repo / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    commit_all(repo)
    (repo / "a.txt").write_text("a\n")
    args = ["review", "--base", "HEAD", "--repo", str(repo), "--contract", str(repo / "c.toml"),
            "--out", str(tmp_path / "o")]  # fmt: skip
    res = CliRunner().invoke(app, args)
    assert res.exit_code == 2 and "codex binary" in res.output


# --- 2. agy tool use is an injection sign ------------------------------------------------------


def _agy_stream(result: dict[str, Any], steps: list[str] | None = None) -> str:
    lines = [{"event": "init", "init": {"tools": ["view_file"]}}]
    for i, s in enumerate(steps if steps is not None else ["user_input", "agent_response", "finish"]):
        lines.append({"event": "step_update", "step_update": {"step_index": i, "state": "DONE", "step_type": s}})
    lines.append({"event": "result", "result": result})
    return "\n".join(json.dumps(x) for x in lines) + "\n"


def _agy(out: str, seen: dict[str, Any] | None = None) -> rv.AgyReviewer:
    def runner(
        argv: list[str], stdin: str | None, cwd: Path, env: dict[str, str], timeout: float
    ) -> tuple[int, str, str]:
        if seen is not None:
            seen.update(argv=argv, stdin=stdin)
        return 0, out, ""

    return rv.AgyReviewer(runner=runner)


OK_RESULT = {"status": "SUCCESS", "response": "x", "structured_output": GOOD, "num_turns": 1}


@pytest.mark.parametrize(
    ("result", "steps"),
    [
        ({**OK_RESULT, "denied_actions": ["write_to_file"]}, None),
        ({**OK_RESULT, "num_turns": 2}, []),
        (OK_RESULT, ["user_input", "view_file", "agent_response", "finish"]),
    ],
)
def test_agy_tool_use_fails_reviewer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, result: dict[str, Any], steps: list[str] | None
) -> None:
    monkeypatch.setenv("HOMEWORK_AGY_BIN", "/bin/agy-fake")
    kw = _kw(tmp_path)
    code, rep = run_review(reviewers=[_agy(_agy_stream(result, steps))], **kw)
    assert code == 1 and rep["status"] == "fail"
    r = rep["reviewers"][0]
    assert r["status"] == "suspicious" and "injection" in (r["error"] or "")
    fr = (kw["out"] / "fix-round.md").read_text()
    assert "WARNING" in fr and "agy" in fr


def test_agy_schema_followup_turn_is_not_tool_use() -> None:
    # Measured (g45, 20.10): with --json-schema agy adds its own second user turn to get the JSON
    # (num_turns=2, steps user_input .. user_input, agent_response, finish) without any tool step.
    steps = ["user_input", "unknown", "agent_response", "user_input", "agent_response", "finish"]
    assert rv.agy_tool_use({"num_turns": 2}, steps) is None
    assert rv.agy_tool_use({"num_turns": 2}, []) is not None
    assert rv.agy_tool_use({"num_turns": 1}, [*steps, "view_file"]) is not None


# Step streams recorded from real agy reviewer runs (measured 20.10.2026).
REC = json.loads((Path(__file__).resolve().parent / "data" / "agy-streams.json").read_text())


def _recorded_agy(name: str) -> tuple[dict[str, Any], list[str]]:
    rec = REC[name]
    return {"num_turns": rec["num_turns"]}, rec["steps"]


@pytest.mark.parametrize("name", ["g45-sertlestirme-v3", "clean-2-sertlestirme-v3"])
def test_recorded_agy_streams_are_plain(name: str) -> None:
    result, steps = _recorded_agy(name)
    assert rv.agy_tool_use(result, steps) is None


def test_measured_probe_stream_is_plain() -> None:
    # Measured 20.10 (harmless prompt, --json-schema): unknown carries no text and lasts ~0.3 ms.
    steps = ["user_input", "unknown", "agent_response", "user_input", "agent_response", "finish"]
    assert rv.agy_tool_use({"num_turns": 2}, steps) is None
    assert rv.agy_tool_use({"num_turns": 1}, ["user_input", "agent_response", "finish"]) is None


@pytest.mark.parametrize(
    ("turns", "steps"),
    [
        (1, []),
        (1, ["user_input", "agent_response", "unknown", "agent_response", "finish"]),
        (1, ["user_input", "unknown", "unknown", "agent_response", "finish"]),
        (2, ["user_input", "agent_response", "user_input", "agent_response", "user_input", "agent_response", "finish"]),
        (3, ["user_input", "agent_response", "user_input", "agent_response", "user_input", "agent_response", "finish"]),
        (1, ["user_input", "agent_response", "user_input", "agent_response", "finish"]),
        (2, ["user_input", "agent_response", "finish"]),
        (2, ["user_input", "agent_response", "user_input", "finish"]),
        (1, ["user_input", "agent_response"]),
        (1, ["agent_response", "finish"]),
    ],
)
def test_agy_unmeasured_streams_are_suspicious(turns: int, steps: list[str]) -> None:
    assert rv.agy_tool_use({"num_turns": turns}, steps) is not None


def test_agy_step_type_keeps_most_specific_update() -> None:
    lines = [
        {"event": "step_update", "step_update": {"step_index": 0, "state": "DONE", "step_type": "user_input"}},
        {"event": "step_update", "step_update": {"step_index": 1, "state": "ACTIVE", "step_type": "unknown"}},
        {"event": "step_update", "step_update": {"step_index": 1, "state": "DONE", "step_type": "view_file"}},
        {"event": "step_update", "step_update": {"step_index": 2, "state": "ACTIVE", "step_type": "agent_response"}},
        {"event": "step_update", "step_update": {"step_index": 2, "state": "DONE", "step_type": "unknown"}},
        {"event": "step_update", "step_update": {"step_index": 3, "state": "DONE", "step_type": "finish"}},
        {"event": "result", "result": {"num_turns": 1}},
    ]
    result, steps = rv.parse_agy_stream("\n".join(json.dumps(x) for x in lines))
    assert steps == ["user_input", "view_file", "agent_response", "finish"]
    assert rv.agy_tool_use(result, steps) is not None


def test_agy_clean_run_passes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOMEWORK_AGY_BIN", "/bin/agy-fake")
    kw = _kw(tmp_path)
    code, rep = run_review(reviewers=[_agy(_agy_stream({**OK_RESULT, "denied_actions": []}))], **kw)
    assert code == 0 and rep["reviewers"][0]["status"] == "complete"


# --- 3. agy prompt on stdin, never in argv --------------------------------------------------


def test_agy_prompt_goes_to_stdin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOMEWORK_AGY_BIN", "/bin/agy-fake")
    seen: dict[str, Any] = {}
    secret_prompt = "PROMPT-" + "z" * 200_000
    _agy(_agy_stream(OK_RESULT), seen).ask(secret_prompt, _schema(tmp_path), 10)
    argv = seen["argv"]
    assert not any("PROMPT-" in a for a in argv)
    assert not any(a in ("--print", "-p", "--prompt") or a.startswith(("--print=", "-p=")) for a in argv)
    assert argv[argv.index("--input-format") + 1] == "stream-json"
    assert argv[argv.index("--output-format") + 1] == "stream-json"
    msg = json.loads(seen["stdin"].splitlines()[0])
    assert msg == {"event": "user", "message": {"content": secret_prompt}}


def test_agy_error_result_is_call_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOMEWORK_AGY_BIN", "/bin/agy-fake")
    out = _agy_stream({"status": "ERROR", "error": "quota exhausted", "num_turns": 0})
    with pytest.raises(rv.ReviewerError, match="quota"):
        _agy(out).ask("P", _schema(tmp_path), 10)


# --- 4. merge: schema violation is a failure, infrastructure error is not -------------------


def test_schema_violation_twice_is_fail(tmp_path: Path) -> None:
    kw = _kw(tmp_path)
    code, rep = run_review(reviewers=[Fake("codex", ["garbage", {"verdict": "x"}])], **kw)
    assert code == 1 and rep["status"] == "fail"
    assert rep["reviewers"][0]["status"] == "invalid"
    assert "injection" in (kw["out"] / "fix-round.md").read_text().lower()


def test_two_reviewers_one_invalid_is_fail_one_crashed_is_partial(tmp_path: Path) -> None:
    kw = _kw(tmp_path)
    code, _ = run_review(reviewers=[Fake("codex", [GOOD]), Fake("agy", ["x", "y"])], **kw)
    assert code == 1
    code, rep = run_review(reviewers=[Fake("codex", [GOOD]), Fake("agy", [rv.ReviewerError("exited 1")])], **kw)
    assert code == 3 and rep["status"] == "pass-partial"


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [
        (["complete", "invalid"], "fail"),
        (["invalid"], "fail"),
        (["error", "suspicious"], "fail"),
        (["complete", "unverified"], "pass-partial"),
        (["unverified"], "pass-partial"),
        (["error", "unverified"], "pass-partial"),
    ],
)
def test_merge_new_statuses(statuses: list[str], expected: str) -> None:
    assert rv.merge([rv.ReviewResult(f"r{i}", s) for i, s in enumerate(statuses)]) == expected


# --- 5. schema minItems / all unverifiable ----------------------------------------------------


def test_items_must_not_be_empty() -> None:
    with pytest.raises(ValueError):
        rv.validate_answer({**GOOD, "items": []})


def test_all_unverifiable_is_partial(tmp_path: Path) -> None:
    ans = {**GOOD, "items": [{"criterion": "c", "status": "unverifiable", "evidence": None, "note": "n"}]}
    assert rv.effective_verdict(ans) == "unverified"
    code, rep = run_review(reviewers=[Fake("codex", [ans])], **_kw(tmp_path))
    assert code == 3 and rep["status"] == "pass-partial"


# --- 6. process group is killed on timeout ----------------------------------------------------


def test_timeout_kills_grandchild(tmp_path: Path) -> None:
    pidfile = tmp_path / "pid"
    script = f"sleep 300 & echo $! > {pidfile}; wait"
    with pytest.raises(rv.ReviewerError, match="timed out"):
        rv._run(["/bin/sh", "-c", script], None, tmp_path, dict(os.environ), 1.0)
    pid = int(pidfile.read_text())
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        # A zombie (dead, not yet reaped by init) still answers kill(0).
        ps = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, check=False)
        if ps.stdout.strip().startswith("Z"):
            break
        time.sleep(0.1)
    else:
        os.kill(pid, signal.SIGKILL)
        pytest.fail("grandchild survived the timeout")


# --- 7. warnings listed on pass --------------------------------------------------------------


def test_pass_lists_warnings(tmp_path: Path) -> None:
    warn = {"kind": "scope-creep", "severity": "warning", "file": "a.go", "line": 3, "message": "extra button"}
    code, _ = run_review(reviewers=[Fake("codex", [{**GOOD, "findings": [warn]}])], **(kw := _kw(tmp_path)))
    assert code == 0
    fr = (kw["out"] / "fix-round.md").read_text()
    assert "pass, 1 warning" in fr and "extra button" in fr and "a.go:3" in fr


# --- 8. file list and untracked secrets -------------------------------------------------------


def test_sent_files_listed_on_stderr_and_untracked_secret_blocks(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    (repo / "a.txt").write_text("b\n")
    (repo / "notes.txt").write_text("hello\n")
    collect_diff(repo, "HEAD", None)
    err = capsys.readouterr().err
    assert "a.txt" in err and "notes.txt" in err and "untracked" in err
    (repo / "creds.txt").write_text(f"aws = {SECRETS['aws']}\n")
    with pytest.raises(ToolError, match="--allow-secrets-risk"):
        collect_diff(repo, "HEAD", None)
    assert SECRETS["aws"] in collect_diff(repo, "HEAD", None, allow_secrets_risk=True)
    (repo / "creds.txt").unlink()
    (repo / ".env.local").write_text("X=1\n")
    with pytest.raises(ToolError):
        collect_diff(repo, "HEAD", None)


def test_tracked_added_secret_blocks(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "app.py").write_text("x = 1\n")
    commit_all(repo)
    (repo / "app.py").write_text(f"x = 1\ntoken = '{SECRETS['github']}'\n")
    with pytest.raises(ToolError, match=r"app\.py"):
        collect_diff(repo, "HEAD", None)
    assert SECRETS["github"] in collect_diff(repo, "HEAD", None, allow_secrets_risk=True)


def test_committed_secret_in_range_blocks(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "a.txt").write_text("a\n")
    commit_all(repo)
    from conftest import sh

    base = sh(repo, "git", "rev-parse", "HEAD").strip()
    (repo / "server.pem").write_text("not really a key\n")
    commit_all(repo)
    with pytest.raises(ToolError, match=r"server\.pem"):
        collect_diff(repo, base, "HEAD")
    with pytest.raises(ToolError, match=r"server\.pem"):
        collect_diff(repo, base, None)


def test_removed_secret_line_does_not_block(tmp_path: Path) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "app.py").write_text(f"token = '{SECRETS['aws']}'\n")
    commit_all(repo)
    (repo / "app.py").write_text("token = None\n")
    collect_diff(repo, "HEAD", None)


@pytest.mark.parametrize("name", ["clean-1", "clean-2", "g45", "g46", "g46-tur1"])
def test_fixture_diffs_have_no_secret_false_alarm(tmp_path: Path, name: str) -> None:
    if not (FIXTURES / name).is_dir():
        pytest.skip(f"no fixture {name}")
    kw = _kw(tmp_path, name)
    collect_diff(kw["repo"], "HEAD", None)


def test_cli_secret_exit_2_and_flag(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = init_repo(tmp_path / "r")
    (repo / "c.toml").write_text('version = 1\nallowed_paths = ["**"]\n')
    commit_all(repo)
    (repo / "k.txt").write_text(KEY + "\n")
    monkeypatch.setitem(rv.REVIEWERS, "codex", lambda: Fake("codex", [GOOD]))
    args = ["review", "--base", "HEAD", "--repo", str(repo), "--contract", str(repo / "c.toml"),
            "--out", str(tmp_path / "o")]  # fmt: skip
    assert CliRunner().invoke(app, args).exit_code == 2
    res = CliRunner().invoke(app, [*args, "--allow-secrets-risk"])
    assert res.exit_code == 0, res.output


if sys.platform == "win32":  # pragma: no cover
    pytest.skip("POSIX process groups", allow_module_level=True)
