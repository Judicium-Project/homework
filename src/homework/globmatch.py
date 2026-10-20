"""Repository-relative glob matching with gitignore-like ``**`` semantics.

Python 3.12 lacks ``PurePath.full_match`` (3.13+) and ``fnmatch`` lets ``*`` cross ``/``,
which would make ``apps/web/*`` match ``apps/web/a/b.ts``. Contracts must be exact, so this
module implements its own segment-wise matcher.
"""

from __future__ import annotations

import posixpath
import re
from collections.abc import Iterable
from functools import lru_cache

from .models import ToolError


def normalize(path: str) -> str | None:
    """Normalise a repo-relative POSIX path; ``None`` if it escapes the repo or is absolute.

    Escaping paths must never match an allow-list, otherwise ``apps/web/../../etc`` could
    satisfy ``apps/web/**``.
    """
    if not path or path.startswith("/") or "\\" in path:
        return None
    norm = posixpath.normpath(path)
    if norm == "." or norm == ".." or norm.startswith("../"):
        return None
    return norm


@lru_cache(maxsize=1024)
def _segment_regex(segment: str) -> re.Pattern[str]:
    out: list[str] = []
    i = 0
    while i < len(segment):
        c = segment[i]
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "[":
            end = segment.find("]", i + 1)
            if end == -1:
                out.append(re.escape(c))
            else:
                body = segment[i + 1 : end]
                if body.startswith("!"):
                    body = "^" + body[1:]
                out.append("[" + body.replace("\\", "\\\\") + "]")
                i = end
        else:
            out.append(re.escape(c))
        i += 1
    try:
        return re.compile("".join(out) + r"\Z")
    except re.error as exc:
        raise ToolError(f"invalid glob segment {segment!r}: {exc}") from exc


def _match_segments(pat: tuple[str, ...], parts: tuple[str, ...]) -> bool:
    if not pat:
        return not parts
    head = pat[0]
    if head == "**":
        # "**" consumes zero or more whole segments.
        return any(_match_segments(pat[1:], parts[i:]) for i in range(len(parts) + 1))
    if not parts:
        return False
    return bool(_segment_regex(head).match(parts[0])) and _match_segments(pat[1:], parts[1:])


def match(pattern: str, path: str) -> bool:
    """True if ``path`` (repo-relative) matches ``pattern``.

    A pattern ending in ``/`` means "everything under this directory". A bare directory
    name does NOT match its children, so ``apps/web`` never matches ``apps/web2/x`` nor
    ``apps/web/x`` - contracts must say ``apps/web/**`` explicitly.
    """
    norm = normalize(path)
    if norm is None:
        return False
    pat = pattern.strip()
    if pat.endswith("/"):
        pat = pat + "**"
    pat = pat.removeprefix("./")
    if not pat or pat.startswith("/") or ".." in pat.split("/"):
        return False
    return _match_segments(tuple(p for p in pat.split("/") if p != ""), tuple(norm.split("/")))


def validate(pattern: str) -> None:
    """Compile every segment now so a broken contract glob fails loudly before any check runs."""
    for seg in pattern.strip().split("/"):
        if seg and seg != "**":
            _segment_regex(seg)


def match_any(patterns: Iterable[str], path: str) -> bool:
    return any(match(p, path) for p in patterns)
