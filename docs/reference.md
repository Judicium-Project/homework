# homework reference

Full behaviour of both layers: trust boundary, every check, reviewer confinement, threat model. For a quick start see the [README](../README.md).


**Trust boundary.** The agent under review wrote the working tree (and `--head`), so nothing it
could have edited decides what is checked or executed:

- A contract or `--task` file **inside the repository is read from `--base`** (`git show
  <base>:<path>`). If the working-tree/head copy differs (edited, deleted, replaced by a symlink),
  the check reports `contract-modified` / `task-modified`, uses the base version, and **does not run
  any acceptance command** (they come from those files, so a tampered copy would let the agent pick
  what runs).
- A contract/task inside the repo that is **missing from `--base`** is an input error (exit 2), not a
  silent trust of the working-tree copy: the safe default is to refuse. Commit it before the agent
  starts, keep it outside the repository (recommended; read as-is), or pass
  `--trust-worktree-contract` if you wrote it yourself.
- Acceptance commands get an **allow-listed environment**: `PATH`, `HOME`, `LANG`, `LC_*`, `TMPDIR`,
  `TERM`, `CI`, plus names listed in the contract's `env_passthrough`. Tokens in your shell do not leak
  into the agent's tests or build scripts. `HOME` is still your real home directory, so the agent's
  code can read `~/.npmrc`, `~/.netrc`, `~/.ssh`, cloud CLI credentials and the like; pass
  `--isolate-home` to run acceptance with an empty temporary `HOME` (deleted afterwards). Tools that
  need a configured home (registry auth, git identity) then have to get it via `env_passthrough`.
- Git state that hides changes is a finding: `.gitattributes` edits (`gitattributes-modified`),
  assume-unchanged / skip-worktree index flags (`index-flag-hidden`). The diff is taken with `--text
  --no-textconv`. Git-ignored files in the working tree are listed as an `info` finding only: their
  content is not checked, yet acceptance commands run with them in place (an ignored `.env`, a
  planted file under `node_modules/` or a build output directory can change what a test does). Run
  the check on a clean clone or `git clean -ndX` first if that matters.

The contract (TOML) says what the task may touch:

```toml
version = 1
allowed_paths = ["apps/web/src/**", "apps/web/package.json"]
required_paths = ["apps/web/src/features/chat/Composer.tsx"]   # must be changed
allowed_dependencies = ["@floating-ui/react"]
generated_by = "pnpm gen"            # rerun; any resulting change = hand-edited/stale output
acceptance = ["pnpm lint && pnpm test", "cd services/api && go test ./..."]

[forbidden]
paths = ["apps/web/e2e/**"]
paths_except = ["apps/web/e2e/new-feature.spec.ts"]
patterns = [{ regex = 'text-transform:\s*uppercase', globs = ["**/*.css"] }]

[tests]
exempt = []          # test files the task may rewrite freely

[rules]
disable = []         # rule ids to switch off

env_passthrough = []  # extra env var names acceptance commands may see
```

Checks: scope (allowed/forbidden paths, symlinks, required paths, forbidden patterns; lines over
10 000 characters are checked in overlapping 4096-character windows and reported as a `line-too-long`
warning), dependencies (`package.json` / `go.mod` / `go.work` additions, removals, key reordering,
git/URL/file/`npm:` and other protocol sources, new `replace` / `use` directives), nested git
repositories and submodule changes (their content is not diffed), test protection (deleted tests, `.skip`/`.only`/`.fail` including aliases, constant
assertions, fewer assertions), an ast-grep rule pack (`src/homework/rules/`, ts / tsx / javascript
variants; a match counts when its line range contains an added line), and the acceptance commands
re-run without caches (moon/turbo `--force`,
`go test -count=1`, plus `MOON_CACHE=off`, `TURBO_FORCE=true`, `GOFLAGS=-count=1`). Commands run without
a shell; only `&&`, `cd` and `VAR=value` prefixes are supported. Each command runs in its own process
group; on `--timeout` the whole group is killed and `acceptance-timeout` is reported. The log keeps the
last 1 MB of each step's output (cache markers are searched in the full output). `--with-agentdiff` adds
[agentdiff](https://pypi.org/project/agentdiff-cli/) as an informational signal.

Output goes to `<git-dir>/homework/` (or `--out`): `report.json` (validated against
[`schemas/report.schema.json`](../schemas/report.schema.json)), `fix-round.md` (instructions to hand
back to the agent) and `acceptance.log`; stale copies are deleted at the start of every run. Exit
codes: `0` pass, `1` findings, `2` tool or input error (including any unexpected crash), `3`
pass-partial.

`status` is `pass`, `fail`, or `pass-partial`: no findings, but the acceptance commands did not run
(`--no-run`, `--head`, no acceptance in the contract). Static checks alone do not show the change
works, so pass-partial has its own exit code `3` and a script that only tests for `0` does not mistake
it for a pass. In pipeline scripts, use `--require-acceptance`: it turns a skipped acceptance run into
an `acceptance-not-run` finding (exit 1), so only a run that actually executed the commands can pass.

**Pipeline rule** (same for `check` and `review`): exit `0` go on, `1` hand `fix-round.md` back to the
agent, `2` tool error: stop the pipeline, `3` a human must approve; never treat it as a pass
automatically.

Known limits: the moon cache-hit pattern is verified against moon's source, but the regression
fixture `fixtures/g45/run-cached.log` is a synthetic log, not a captured run. Forbidden-pattern regexes
use Python `re` (no timeout; long lines are windowed, a catastrophic pattern on a 4096-character window
is still possible, and a match longer than 512 characters can straddle two windows - the
`line-too-long` warning fails the run anyway).

Development: `uv run pytest`, `uv run ruff check`, `uv run mypy`.

## `homework review` (layer 2)

```sh
# Run after `check`, against the same base. Default reviewer: Codex.
homework review --base HEAD --task task.md --contract contract.toml
# Add a fresh agy session as a second, independent reviewer:
homework review --base HEAD --task task.md --reviewer codex --reviewer agy
```

Each reviewer gets a fixed prompt (`src/homework/prompts/reviewer.md`), the task and the contract (read
from `--base`, with the same trust rule as `check`), and the diff. It never sees the agent's report or
commit message. The diff is treated as untrusted data: it is wrapped in a fence whose markers carry a
random per-run nonce, and the prompt tells the reviewer to ignore any instruction inside it. The answer
must match `src/homework/review.schema.json` (`verdict`, one `items[]` entry per acceptance criterion,
at least one, with `file:line` evidence, `findings[]` of kind `half-done`, `scope-creep`, `wrong-behavior`,
`other`). An answer that does not match is asked for once more. A reviewer that says `complete` but
lists a missing item or an `error` finding counts as `incomplete`; one whose every item is
`unverifiable` counts as `unverified` (nothing was checked, pass-partial).

Before anything is sent, the list of files in the diff (untracked ones marked) is printed to stderr.
A file in the diff that looks like it holds a secret stops the run with exit 2 unless you pass
`--allow-secrets-risk`: a sent file named like `.env*`, `*.pem`, `*.key`, `id_rsa`..., an untracked file whose
content, or a tracked file whose added lines, contain a private key block or an AWS/OpenAI/GitHub/Slack/bearer
token. Removed lines are not checked.

Reviewers run in parallel, each in an empty temporary directory with an allow-listed environment and a
timeout (`--timeout`, default 600 s per call). Each runs in its own process group; on timeout the whole
group is killed.

- `codex`: `codex exec --ephemeral --ignore-user-config --ignore-rules --output-schema …`, prompt on
  stdin. The session has no shell tool (`--disable shell_tool`, plus browser/computer use, apps,
  plugins, sub-agents, image viewing and web search off) and a permission profile that can read only
  the empty work directory and the runtime minimum and write nothing
  (`permissions.homework-review.filesystem = {":minimal"="read", ":workspace_roots"={"."="read"}}` plus
  file-level read entries for the codex binary, its symlink target and the `codex-*` executables next
  to the target; no directory). Codex is started by its resolved path. Checked with `codex sandbox`:
  the binary runs, but listing its directory, reading `~` or `$CODEX_HOME/auth.json` and writing are
  denied. A binary whose resolved directory is `/`, `$HOME` or a direct child of `$HOME` is refused
  (exit 2). `HOME` is an empty temporary directory; credentials come from `CODEX_HOME` (default
  `~/.codex`). Binary: `PATH` (shell aliases are ignored) or `HOMEWORK_CODEX_BIN`.
- `agy`: headless `agy --input-format stream-json --output-format stream-json --json-schema …`, the
  prompt sent on stdin as one user message (not in argv, so not visible in `ps` and not bounded by
  `ARG_MAX`), without `--dangerously-skip-permissions`. agy has no switch that turns tools off. Any
  sign of tool use marks that reviewer `suspicious`: non-empty `denied_actions`, a tool step in the
  event stream, or any step stream other than the measured plain ones (prompt, an optional `unknown`
  setup step right after it, the answer, finish; with `--json-schema` also agy's own single follow-up
  user turn for the JSON, `num_turns` = 2). That is why agy is opt-in. Binary: `PATH` or
  `HOMEWORK_AGY_BIN`. An `agy` found on `PATH` may be a user wrapper script (extra context, memory,
  logging) rather than the CLI itself; point `HOMEWORK_AGY_BIN` at the real agy executable so the
  reviewer session is the plain CLI.

Output: `review.json` and a "layer 2" section in `fix-round.md` (same directory as `check`, by default
`.git/homework/`). A pass with warnings lists them as "pass, N warning(s)" for the human.

| exit | status | when |
|---|---|---|
| `0` | pass | every reviewer answered `complete` |
| `1` | fail | a reviewer says incomplete/wrong, **or** gave no schema-valid answer after the retry (`invalid`), **or** used tools (`suspicious`) |
| `2` | error | bad input, a sent file that looks secret, or every reviewer failed to run |
| `3` | pass-partial | none failed, but a reviewer failed to run (exit ≠ 0, timeout, quota) or verified nothing (`unverified`) |

Pipeline rule: `0` go on, `1` hand `fix-round.md` back to the agent, `2` stop, `3` a human must approve
(never auto-pass).

**Threat model.** The diff comes from the agent being reviewed and is untrusted; it may try to steer
the reviewer with an injection or to break it so the run degrades to pass-partial.

- A broken answer is a failure, not a degraded pass: `invalid` and `suspicious` fail the run. Only a
  real infrastructure failure (process exit, timeout) gives pass-partial.
- Reviewer text goes back to the agent through `fix-round.md`, so `summary`, `note`, `evidence` and
  `message` are redacted first (home-directory paths, private key blocks, `AKIA…`, `sk-…`, `ghp_…`,
  `xox…-`, bearer tokens, long hex / base64 strings). `review.json` stores the redacted answer.
- Remaining limits: agy can still read whatever your agy permissions allow (e.g. `read_file(*)`);
  tool use is detected after the fact, not prevented. Redaction is pattern-based and will not catch a
  secret in an unknown format. Codex confinement relies on Codex's own permission profiles
  (Seatbelt on macOS, bubblewrap on Linux).

**Privacy:** the task, the contract and the full diff are sent to third-party model providers (OpenAI
for Codex, Google for agy). Do not review code you may not share with them. agy keeps the run in its
conversation history.

**Cost:** one model call per reviewer (two if the first answer is malformed). On the 934-line G45
fixture a call took 15-70 s; agy reported about 54k input tokens. Calls count against your Codex / agy
plan quota.

Live tests call the real CLIs and are skipped by default: `uv run pytest --live -m live`.
Measurements of reviewer accuracy and cost were taken on the fixtures in `fixtures/`.
