import { describe, expect, it } from "vitest";
import { validateAdminSetPassword } from "./userCredentials";

describe("administrator-set user credentials", () => {
  it("accepts the six-character credential supported by the account functions", () => {
    expect(validateAdminSetPassword("MkJ#26", "MkJ#26")).toBeNull();
  });

  it("rejects a credential that cannot be sent to the account function", () => {
    expect(validateAdminSetPassword("short", "short")).toBe(
      "Password must be exactly 6 characters.",
    );
  });

  it("requires the confirmation to match before an account is created", () => {
    expect(validateAdminSetPassword("MkJ#26", "MkJ#27")).toBe(
      "The password confirmation does not match.",
    );
  });
});
