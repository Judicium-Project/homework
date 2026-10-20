from __future__ import annotations

import pytest

from homework.globmatch import match, normalize


@pytest.mark.parametrize(
    ("pattern", "path", "expected"),
    [
        ("apps/web/src/**", "apps/web/src/a.ts", True),
        ("apps/web/src/**", "apps/web/src/x/y/z.tsx", True),
        ("apps/web/src/**", "apps/web/src", True),  # "**" may match zero segments
        ("**/*.css", "a.css", True),
        ("**/*.css", "x/y/a.css", True),
        ("**/e2e/**", "apps/web/e2e/a.spec.ts", True),
        ("apps/web/*", "apps/web/a.ts", True),
        ("apps/web/*", "apps/web/a/b.ts", False),  # "*" never crosses "/"
        ("apps/*/src/**", "apps/web/src/a.ts", True),
        ("contracts/out/openapi.yaml", "contracts/out/openapi.yaml", True),
        ("src/a?.ts", "src/ab.ts", True),
        ("src/[ab].ts", "src/b.ts", True),
        ("src/[!ab].ts", "src/b.ts", False),
        ("dir/", "dir/sub/file", True),
    ],
)
def test_glob_basic(pattern: str, path: str, expected: bool) -> None:
    assert match(pattern, path) is expected


@pytest.mark.parametrize(
    ("pattern", "path"),
    [
        ("apps/web/**", "apps/web2/a.ts"),  # prefix X vs X2
        ("apps/web", "apps/web2"),
        ("apps/web", "apps/web/a.ts"),  # a bare directory does not grant its children
        ("apps/web/*.ts", "apps/web2/a.ts"),
        ("packages/tokens/**", "packages/tokens-extra/x.json"),
    ],
)
def test_glob_no_prefix_confusion(pattern: str, path: str) -> None:
    assert not match(pattern, path)


@pytest.mark.parametrize(
    "path",
    ["apps/web/../../../etc/passwd", "../outside.ts", "/abs/path.ts", "apps\\web\\a.ts", "", "."],
)
def test_glob_dotdot_and_absolute_never_match(path: str) -> None:
    assert not match("**", path)
    assert not match("apps/web/**", path)


def test_dotdot_inside_repo_is_normalised() -> None:
    assert normalize("apps/web/x/../a.ts") == "apps/web/a.ts"
    assert match("apps/web/*.ts", "apps/web/x/../a.ts")
    assert not match("apps/web/x/**", "apps/web/x/../a.ts")


def test_dotdot_cannot_climb_out_of_allowed_dir() -> None:
    assert not match("apps/web/**", "apps/web/../../etc/passwd")


def test_pattern_with_dotdot_is_rejected() -> None:
    assert not match("apps/../secrets/**", "secrets/a")
