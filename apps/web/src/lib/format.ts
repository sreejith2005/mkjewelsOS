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
  text?: () => Promise<string>;
};

function functionResponseMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key];
    }
  }
  return null;
}

/** Reads only the intentionally safe `error` field returned by an Edge Function. */
export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  if (typeof error !== "object" || error === null || !("context" in error)) {
    return errorMessage(error);
  }

  const context = error.context;
  if (typeof context !== "object" || context === null) return errorMessage(error);
  const response = context as EdgeFunctionErrorContext;
  const readable = response.clone?.() ?? response;
  if (typeof readable.json !== "function" && typeof readable.text !== "function") return errorMessage(error);

  try {
    if (typeof readable.json !== "function") throw new Error("No JSON response reader");
    const payload = await readable.json();
    const message = functionResponseMessage(payload);
    if (message) return message;
  } catch {
    if (typeof readable.text === "function") {
      try {
        const payload = JSON.parse(await readable.text());
        const message = functionResponseMessage(payload);
        if (message) return message;
      } catch {
        // The ordinary error remains the final fallback.
      }
    }
  }
  return errorMessage(error);
}
