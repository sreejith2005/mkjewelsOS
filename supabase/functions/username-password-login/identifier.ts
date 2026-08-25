const usernamePattern = /^[a-z0-9]{2,80}$/;
const workEmailPattern = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export type LoginIdentifier =
  | { kind: "username"; value: string }
  | { kind: "work_email"; value: string };

export function normalizeLoginIdentifier(input: unknown): LoginIdentifier | null {
  if (typeof input !== "string") return null;

  const value = input.trim().toLowerCase();
  if (usernamePattern.test(value)) return { kind: "username", value };
  if (workEmailPattern.test(value)) return { kind: "work_email", value };
  return null;
}
