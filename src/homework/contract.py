"""Task contract: ``contract.toml`` / ``.homework.toml`` plus optional task.md frontmatter.

Schema: see fixtures/README.md (contract.toml schema section). Unknown keys are rejected so a typo
cannot silently disable a check.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .globmatch import validate as validate_glob
from .models import ToolError

DEFAULT_CONTRACT = ".homework.toml"

_TOP_KEYS = {
    "version",
    "task",
    "source",
    "allowed_paths",
    "required_paths",
    "allowed_dependencies",
    "generated_by",
    "acceptance",
    "acceptance_manual",
    "forbidden",
    "tests",
    "rules",
    "env_passthrough",
}
_FORBIDDEN_KEYS = {"paths", "paths_except", "patterns", "notes"}
_TESTS_KEYS = {"exempt"}
_RULES_KEYS = {"e2e_paths", "disable"}

# K4 frontmatter names -> contract names. Frontmatter only ever widens/extends the contract
# file, so a task author can add scope without editing the project-wide file.
_FRONTMATTER_ALIASES = {
    "files": "allowed_paths",
    "allowed_paths": "allowed_paths",
    "required_paths": "required_paths",
    "allowed_deps": "allowed_dependencies",
    "allowed_dependencies": "allowed_dependencies",
    "accept": "acceptance",
    "acceptance": "acceptance",
    "generated_by": "generated_by",
    "forbid_extra": "forbid_extra",
}

DEFAULT_E2E_PATHS = ("**/e2e/**", "**/*.e2e.*", "**/playwright/**")


@dataclass(frozen=True)
class ForbiddenPattern:
    regex: re.Pattern[str]
    globs: tuple[str, ...]


@dataclass
class Contract:
    path: Path | None
    task: str = ""
    allowed_paths: list[str] = field(default_factory=list)
    required_paths: list[str] = field(default_factory=list)
    allowed_dependencies: list[str] = field(default_factory=list)
    generated_by: str = ""
    acceptance: list[str] = field(default_factory=list)
    acceptance_manual: list[str] = field(default_factory=list)
    forbidden_paths: list[str] = field(default_factory=list)
    forbidden_paths_except: list[str] = field(default_factory=list)
    forbidden_patterns: list[ForbiddenPattern] = field(default_factory=list)
    forbidden_notes: list[str] = field(default_factory=list)
    tests_exempt: list[str] = field(default_factory=list)
    e2e_paths: list[str] = field(default_factory=lambda: list(DEFAULT_E2E_PATHS))
    disabled_rules: list[str] = field(default_factory=list)
    # Extra environment variables acceptance commands may see (on top of the fixed allow-list).
    env_passthrough: list[str] = field(default_factory=list)


_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")

_GLOB_FIELDS = (
    "allowed_paths",
    "required_paths",
    "forbidden_paths",
    "forbidden_paths_except",
    "tests_exempt",
    "e2e_paths",
)


def _validate_globs(c: Contract) -> None:
    for name in _GLOB_FIELDS:
        for pattern in getattr(c, name):
            validate_glob(pattern)
    for fp in c.forbidden_patterns:
        for pattern in fp.globs:
            validate_glob(pattern)


def _str_list(value: Any, key: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ToolError(f"contract: '{key}' must be a list of strings")
    return list(value)


def _pattern(entry: Any) -> ForbiddenPattern:
    if isinstance(entry, str):
        entry = {"regex": entry}
    if not isinstance(entry, dict) or "regex" not in entry:
        raise ToolError("contract: forbidden.patterns entries need a 'regex'")
    try:
        rx = re.compile(str(entry["regex"]))
    except re.error as exc:
        raise ToolError(f"contract: bad forbidden regex {entry['regex']!r}: {exc}") from exc
    return ForbiddenPattern(rx, tuple(_str_list(entry.get("globs", ["**"]), "forbidden.patterns.globs")))


def _check_keys(data: dict[str, Any], allowed: set[str], where: str) -> None:
    unknown = set(data) - allowed
    if unknown:
        raise ToolError(f"contract: unknown key(s) in {where}: {', '.join(sorted(unknown))}")


def parse_contract(data: dict[str, Any], path: Path | None) -> Contract:
    _check_keys(data, _TOP_KEYS, "top level")
    version = data.get("version", 1)
    if version != 1:
        raise ToolError(f"contract: unsupported version {version!r}")
    forb = data.get("forbidden", {}) or {}
    tests = data.get("tests", {}) or {}
    rules = data.get("rules", {}) or {}
    for sub, keys, name in (
        (forb, _FORBIDDEN_KEYS, "forbidden"),
        (tests, _TESTS_KEYS, "tests"),
        (rules, _RULES_KEYS, "rules"),
    ):
        if not isinstance(sub, dict):
            raise ToolError(f"contract: '{name}' must be a table")
        _check_keys(sub, keys, f"[{name}]")
    gen = data.get("generated_by", "") or ""
    if not isinstance(gen, str):
        raise ToolError("contract: 'generated_by' must be a string")
    c = Contract(
        path=path,
        task=str(data.get("task", "")),
        allowed_paths=_str_list(data.get("allowed_paths"), "allowed_paths"),
        required_paths=_str_list(data.get("required_paths"), "required_paths"),
        allowed_dependencies=_str_list(data.get("allowed_dependencies"), "allowed_dependencies"),
        generated_by=gen,
        acceptance=_str_list(data.get("acceptance"), "acceptance"),
        acceptance_manual=_str_list(data.get("acceptance_manual"), "acceptance_manual"),
        forbidden_paths=_str_list(forb.get("paths"), "forbidden.paths"),
        forbidden_paths_except=_str_list(forb.get("paths_except"), "forbidden.paths_except"),
        forbidden_patterns=[_pattern(p) for p in forb.get("patterns", []) or []],
        forbidden_notes=_str_list(forb.get("notes"), "forbidden.notes"),
        tests_exempt=_str_list(tests.get("exempt"), "tests.exempt"),
        disabled_rules=_str_list(rules.get("disable"), "rules.disable"),
        env_passthrough=_str_list(data.get("env_passthrough"), "env_passthrough"),
    )
    for name in c.env_passthrough:
        if not _ENV_NAME.match(name):
            raise ToolError(f"contract: env_passthrough entry {name!r} is not a variable name")
    if "e2e_paths" in rules:
        c.e2e_paths = _str_list(rules["e2e_paths"], "rules.e2e_paths")
    _validate_globs(c)
    return c


def load_contract_text(text: str, path: Path | None) -> Contract:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ToolError(f"contract {path}: invalid TOML: {exc}") from exc
    return parse_contract(data, path)


def load_contract(path: Path) -> Contract:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ToolError(f"contract not found: {path}") from exc
    return load_contract_text(text, path)


_FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.S)


def parse_frontmatter(text: str, label: str) -> dict[str, Any]:
    m = _FRONTMATTER.match(text)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        raise ToolError(f"task {label}: invalid YAML frontmatter: {exc}") from exc
    if not isinstance(data, dict):
        raise ToolError(f"task {label}: frontmatter must be a mapping")
    return data


def read_frontmatter(task_path: Path) -> dict[str, Any]:
    try:
        text = task_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ToolError(f"task file not found: {task_path}") from exc
    return parse_frontmatter(text, str(task_path))


def merge_frontmatter(contract: Contract, fm: dict[str, Any]) -> Contract:
    for key, value in fm.items():
        target = _FRONTMATTER_ALIASES.get(str(key))
        if target is None:
            continue  # task frontmatter may carry unrelated metadata (title, owner, ...)
        if target == "generated_by":
            if not isinstance(value, str):
                raise ToolError("task frontmatter: 'generated_by' must be a string")
            contract.generated_by = contract.generated_by or value
        elif target == "forbid_extra":
            entries = value if isinstance(value, list) else [value]
            contract.forbidden_patterns.extend(_pattern(e) for e in entries)
        else:
            current: list[str] = getattr(contract, target)
            current.extend(v for v in _str_list(value, str(key)) if v not in current)
    _validate_globs(contract)
    return contract
