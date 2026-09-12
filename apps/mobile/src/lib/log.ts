import { env } from "@/config/env";

/**
 * Development logging that leaves nothing behind in a release APK.
 *
 * `log.debug` and `log.info` compile to no-ops when `__DEV__` is false, so a
 * shipped build carries no console noise and cannot leak record contents into
 * logcat, where any app with READ_LOGS could read it.
 *
 * `log.error` always runs: a crash in production still needs a breadcrumb. It
 * reports the scope and the error message only — never the payload that caused
 * it, which may hold customer data.
 */
type Scope =
  | "auth"
  | "api"
  | "navigation"
  | "form"
  | "fms"
  | "upload"
  | "network"
  | "startup";

const format = (scope: Scope, message: string) => `[jewelos:${scope}] ${message}`;

export const log = {
  debug(scope: Scope, message: string, detail?: unknown): void {
    if (!env.isDevelopment) return;
    if (detail === undefined) console.log(format(scope, message));
    else console.log(format(scope, message), detail);
  },

  info(scope: Scope, message: string): void {
    if (!env.isDevelopment) return;
    console.log(format(scope, message));
  },

  warn(scope: Scope, message: string): void {
    if (!env.isDevelopment) return;
    console.warn(format(scope, message));
  },

  error(scope: Scope, message: string, error?: unknown): void {
    console.error(format(scope, message), errorText(error));
  },
} as const;

/** The message of anything thrown, without dragging its payload along. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}
