import { describe, expect, it } from "vitest";
import { usernameLoginErrorMessage } from "./functionError";

describe("usernameLoginErrorMessage", () => {
  it("uses the safe function response instead of the SDK wrapper", () => {
    expect(usernameLoginErrorMessage(401, "invalid_credentials")).toBe("Username or password is incorrect.");
  });

  it("explains a rate-limit response", () => {
    expect(usernameLoginErrorMessage(429, "login_rate_limited")).toBe("Too many attempts. Try again in 15 minutes.");
  });

  it("does not expose unexpected server responses", () => {
    expect(usernameLoginErrorMessage(503, "login_identity")).toContain("LOGIN-IDENTITY");
  });
});
