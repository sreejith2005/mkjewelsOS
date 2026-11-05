"""Masks contact and identity numbers before text reaches a prompt or an extract.

Same patterns and order as recording_redact (migration 0379) and
packages/core/src/salesScore/redact.ts; shared vectors in
contracts/redaction_vectors.json. Stored transcripts keep the original.
"""
from __future__ import annotations

import re
import string

PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '[EMAIL]'),
    (re.compile(r'[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}'), '[UPI]'),
    (re.compile(r'(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])'), '[PAN]'),
    (re.compile(r'(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])'), '[CARD]'),
    (re.compile(r'(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])'), '[AADHAAR]'),
    (re.compile(r'(?<![0-9])(?:\+?91[ -]?)?[6-9][0-9]{4}[ -]?[0-9]{5}(?![0-9])'), '[PHONE]'),
)
_PUNCTUATION = str.maketrans('', '', string.punctuation)


def redact(text: str | None) -> str:
    value = text or ''
    for pattern, token in PATTERNS:
        value = pattern.sub(token, value)
    return value


def norm(text: str | None) -> str:
    """Quote matching normalisation; mirrors recording_norm in SQL (ASCII punctuation only)."""
    return ' '.join((text or '').lower().translate(_PUNCTUATION).split())


def quote_in(quote: str, *texts: str | None) -> bool:
    needle = norm(quote)
    if not 3 <= len(needle) <= 500:
        return False
    return any(needle in norm(t) or needle in norm(redact(t)) for t in texts if t)
