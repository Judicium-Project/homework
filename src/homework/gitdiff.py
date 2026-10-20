"""Collect the change set between a base revision and a head revision or the working tree."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .models import ToolError

SYMLINK_MODE = "120000"
GITLINK_MODE = "160000"

# Neutralise user git config that would change the diff format we parse.
_GIT_BASE = [
    "git",
    "-c",
    "core.quotepath=false",
    "-c",
    "diff.noprefix=false",
    "-c",
    "diff.mnemonicprefix=false",
    "-c",
    "diff.external=",
    "-c",
    "color.ui=false",
]

# Shared by the --raw and the patch call so both list the same files in the same order.
# --text/--no-textconv: a "binary" attribute or a textconv filter (both settable by the agent via
# .gitattributes) must not hide added lines.
_DIFF_OPTS = (
    "-M",
    "--no-ext-diff",
    "--text",
    "--no-textconv",
    "--submodule=short",
    "--ignore-submodules=none",
    "--no-relative",
)


def git(root: Path, *args: str, check: bool = True) -> bytes:
    try:
        proc = subprocess.run([*_GIT_BASE, *args], cwd=root, capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise ToolError("git executable not found") from exc
    if check and proc.returncode != 0:
        raise ToolError(f"git {' '.join(args)} failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def show(root: Path, rev: str, path: str) -> bytes | None:
    """Blob content of ``path`` at ``rev``; None if it does not exist there."""
    out = subprocess.run([*_GIT_BASE, "show", f"{rev}:{path}"], cwd=root, capture_output=True, check=False)
    return out.stdout if out.returncode == 0 else None


@dataclass
class FileChange:
    path: str  # new path (old path for deletions)
    status: str  # A, M, D, R, C, T
    old_path: str | None = None
    old_mode: str = ""
    new_mode: str = ""
    added: dict[int, str] = field(default_factory=dict)  # head line number -> text
    removed: list[str] = field(default_factory=list)
    nested_repo: bool = False  # untracked "dir/" entry from ls-files

    @property
    def deleted(self) -> bool:
        return self.status == "D"

    @property
    def is_symlink(self) -> bool:
        return self.new_mode == SYMLINK_MODE

    @property
    def is_gitlink(self) -> bool:
        """A submodule commit pointer, or (untracked) a nested repository: code git does not diff."""
        return GITLINK_MODE in (self.old_mode, self.new_mode)


@dataclass
class ChangeSet:
    root: Path
    base: str
    head: str | None  # None = working tree
    files: list[FileChange]
    base_sha: str = ""

    def by_path(self) -> dict[str, FileChange]:
        return {f.path: f for f in self.files}

    def read_head(self, path: str) -> bytes | None:
        if self.head is None:
            p = self.root / path
            if p.is_symlink():
                return os.readlink(p).encode()
            return p.read_bytes() if p.is_file() else None
        return show(self.root, self.head, path)

    def read_base(self, path: str) -> bytes | None:
        return show(self.root, self.base, path)


_HUNK = re.compile(rb"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _parse_raw(raw: bytes) -> list[FileChange]:
    parts = raw.split(b"\0")
    files: list[FileChange] = []
    i = 0
    while i < len(parts) and parts[i]:
        meta = parts[i].decode("ascii").lstrip(":").split()
        old_mode, new_mode, status = meta[0], meta[1], meta[4][0]
        if status in "RC":
            old, new = os.fsdecode(parts[i + 1]), os.fsdecode(parts[i + 2])
            files.append(FileChange(new, status, old, old_mode, new_mode))
            i += 3
        else:
            files.append(FileChange(os.fsdecode(parts[i + 1]), status, None, old_mode, new_mode))
            i += 2
    return files


def _parse_patch(patch: bytes, files: list[FileChange]) -> None:
    """Attach hunk lines to ``files`` by position, never by the path in the patch header.

    Header paths are C-quoted for names with '"', '\\', tabs or newlines, and an attacker who
    controls file names controls those headers. ``git diff --raw -z`` and ``git diff -p`` run with
    identical options emit file sections in the same order, so the n-th "diff --git" section belongs
    to the n-th raw entry.
    """
    # A type change (file <-> symlink) is printed as two sections: deletion, then creation.
    sections = [f for fc in files for f in ((fc, fc) if fc.status == "T" else (fc,))]
    index = -1
    current: FileChange | None = None
    new_line = 0
    # Remaining hunk body lines; while > 0 a line like "diff --git x" or "--- x" is content, not a header.
    old_left = new_left = 0
    for raw in patch.split(b"\n"):
        if old_left > 0 or new_left > 0:
            if raw.startswith(b"+"):
                if current is not None:
                    current.added[new_line] = raw[1:].decode(errors="replace")
                new_line += 1
                new_left -= 1
            elif raw.startswith(b"-"):
                if current is not None:
                    current.removed.append(raw[1:].decode(errors="replace"))
                old_left -= 1
            elif raw.startswith(b" "):
                new_line += 1
                old_left -= 1
                new_left -= 1
            continue
        if raw.startswith(b"diff --git "):
            index += 1
            if index >= len(sections):
                raise ToolError("git diff patch has more file sections than --raw entries")
            current = sections[index]
        else:
            m = _HUNK.match(raw)
            if m:
                old_left = int(m.group(2)) if m.group(2) is not None else 1
                new_line = int(m.group(3))
                new_left = int(m.group(4)) if m.group(4) is not None else 1
    if index != len(sections) - 1:
        raise ToolError(f"git diff patch has {index + 1} file sections, expected {len(sections)} from --raw")


def _split_lines(text: str) -> dict[int, str]:
    # Only "\n" ends a line for git and ast-grep; str.splitlines() would also split on \r, \f,
    # U+2028 ... and shift every later line number.
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return {i + 1: line for i, line in enumerate(lines)}


def collect(root: Path, base: str, head: str | None) -> ChangeSet:
    top = git(root, "rev-parse", "--show-toplevel").decode().strip()
    root = Path(top)
    base_sha = git(root, "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}").decode().strip()
    if head is not None:
        git(root, "rev-parse", "--verify", "--quiet", f"{head}^{{commit}}")
    revs = [base] if head is None else [base, head]
    raw = git(root, "diff", *_DIFF_OPTS, "--raw", "-z", *revs)
    files = _parse_raw(raw)
    patch = git(root, "diff", *_DIFF_OPTS, "-U0", "--src-prefix=a/", "--dst-prefix=b/", *revs)
    _parse_patch(patch, files)
    if head is None:
        # Agents create files without "git add"; an untracked file is as much a change as a tracked one.
        others = git(root, "ls-files", "-z", "--others", "--exclude-standard").split(b"\0")
        # fsdecode (surrogateescape) round-trips non-UTF-8 names back to the exact bytes on disk.
        for name in (os.fsdecode(o) for o in others if o):
            if name.endswith("/"):
                # ls-files lists an untracked nested repository as one "dir/" entry and never looks
                # inside it, so none of its files would be checked.
                files.append(FileChange(name.rstrip("/"), "A", None, "000000", GITLINK_MODE, nested_repo=True))
                continue
            p = root / name
            mode = SYMLINK_MODE if p.is_symlink() else "100644"
            fc = FileChange(name, "A", None, "000000", mode)
            if not p.is_symlink() and p.is_file():
                fc.added = _split_lines(p.read_bytes().decode(errors="replace"))
            files.append(fc)
    files.sort(key=lambda f: f.path)
    return ChangeSet(root, base, head, files, base_sha)
