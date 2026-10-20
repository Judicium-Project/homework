"""Secret and local-path redaction for text that flows back to the agent.

Reviewer answers end up in ``fix-round.md``, which the (untrusted) agent reads. A reviewer that was
steered by an injection in the diff could try to smuggle file contents back that way, so every free
text field is passed through :func:`redact` first. The same patterns flag untracked files that look
like they hold a secret before they are sent to a third-party reviewer.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

MASK = "[redacted]"

# Token shapes of common providers; deliberately broad, a false positive only costs a mask.
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"-----BEGIN [A-Z0-9 ]*-----.*?(?:-----END [A-Z0-9 ]*-----|\Z)", re.S),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bxox[abposr]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]{8,}"),
)
# Only in reviewer text, not in the untracked-file scan: these also match hashes and ordinary data.
HEX_PATTERN = re.compile(r"\b[0-9a-fA-F]{32,}\b")
B64_CANDIDATE = re.compile(r"(?<![A-Za-z0-9+/=_\-])[A-Za-z0-9+/_\-]{40,}={0,2}(?![A-Za-z0-9+/=_\-])")
# "/home" only as a whole path component: "/opt/homebrew/bin" must survive.
HOME_PATTERN = re.compile(
    r"(?<![\w.\-])(?:/Users|/home|/var/root|/root)(?=/)(?:/[^\s'\"`)\]}>,;:]+)+|~/[^\s'\"`)\]}>,;:]*"
)


def _b64(m: re.Match[str]) -> str:
    # Long repository paths ("apps/web/src/features/...") match the alphabet too; real encoded
    # data mixes cases and digits, so require both before masking.
    s = m.group(0)
    digits = sum(c.isdigit() for c in s)
    if digits >= 4 and any(c.isupper() for c in s) and any(c.islower() for c in s):
        return MASK
    return s


def redact(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub(MASK, text)
    text = HEX_PATTERN.sub(MASK, text)
    text = B64_CANDIDATE.sub(_b64, text)
    home = str(Path.home())
    if len(home) > 1:
        text = text.replace(home, "~")
    return HOME_PATTERN.sub("[path]", text)


def redact_obj(value: Any) -> Any:
    """Redact every string inside a JSON-like value; keys and non-strings are kept."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, list):
        return [redact_obj(v) for v in value]
    if isinstance(value, dict):
        return {k: redact_obj(v) for k, v in value.items()}
    return value


SECRET_FILE_NAMES = re.compile(r"(?:^|/)(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx))$")


def looks_secret(name: str, text: str) -> str | None:
    """Why a file name or text looks like it holds a secret, or None."""
    if SECRET_FILE_NAMES.search(name):
        return "file name"
    for pat in SECRET_PATTERNS:
        if pat.search(text):
            return f"content matches {pat.pattern[:24]!r}"
    return None
