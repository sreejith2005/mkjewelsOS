export const PHONE_PATTERN = /^\+?[0-9][0-9\s()-]{7,19}$/;

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter((letter): letter is string => Boolean(letter));
  return letters.join("").toUpperCase().slice(0, 2) || "?";
}

export function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

