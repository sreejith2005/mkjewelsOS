/**
 * Masks contact and identity numbers before text leaves the review screen
 * (analytics extracts). Same patterns, in the same order, as recording_redact
 * (migration 0378) and services/recorder/redact.py; shared vectors in tests.
 * Ordinary prices, carat and purity numbers are left alone.
 */
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  [/[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}/g, "[UPI]"],
  [/(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/g, "[PAN]"],
  [/(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])/g, "[CARD]"],
  [/(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/g, "[AADHAAR]"],
  [/(?<![0-9])(?:\+?91[ -]?)?[6-9][0-9]{4}[ -]?[0-9]{5}(?![0-9])/g, "[PHONE]"],
];

export function redactSensitiveText(text: string): string {
  return PATTERNS.reduce((value, [pattern, token]) => value.replace(pattern, token), text);
}
