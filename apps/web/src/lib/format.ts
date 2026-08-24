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
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Something went wrong";
}

type EdgeFunctionErrorContext = {
  clone?: () => EdgeFunctionErrorContext;
  json?: () => Promise<unknown>;
};

/** Reads only the intentionally safe `error` field returned by an Edge Function. */
export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  if (typeof error !== "object" || error === null || !("context" in error)) {
    return errorMessage(error);
  }

  const context = error.context;
  if (typeof context !== "object" || context === null) return errorMessage(error);
  const response = context as EdgeFunctionErrorContext;
  const readable = response.clone?.() ?? response;
  if (typeof readable.json !== "function") return errorMessage(error);

  try {
    const payload = await readable.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string" &&
      payload.error.trim()
    ) {
      return payload.error;
    }
  } catch {
    // The HTTP error is still useful when a function does not return JSON.
  }
  return errorMessage(error);
}
