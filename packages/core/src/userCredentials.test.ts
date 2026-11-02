import { describe, expect, it } from "vitest";
import { validateAdminSetPassword, validateOwnPasswordChange } from "./userCredentials";

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

describe("own password change", () => {
  it("accepts a new password of 6 to 72 characters that is confirmed", () => {
    expect(validateOwnPasswordChange("MkJ#26", "Gold#2026", "Gold#2026")).toBeNull();
    expect(validateOwnPasswordChange("MkJ#26", "abcdef", "abcdef")).toBeNull();
  });

  it("requires the current password", () => {
    expect(validateOwnPasswordChange("", "Gold#2026", "Gold#2026")).toBe("Enter your current password.");
  });

  it("rejects passwords that are too short or too long", () => {
    expect(validateOwnPasswordChange("MkJ#26", "abc", "abc")).toBe("New password must be 6 to 72 characters.");
    const long = "a".repeat(73);
    expect(validateOwnPasswordChange("MkJ#26", long, long)).toBe("New password must be 6 to 72 characters.");
  });

  it("rejects reusing the current password", () => {
    expect(validateOwnPasswordChange("MkJ#26", "MkJ#26", "MkJ#26")).toBe(
      "Choose a new password that is different from your current one.",
    );
  });

  it("requires the confirmation to match", () => {
    expect(validateOwnPasswordChange("MkJ#26", "Gold#2026", "Gold#2027")).toBe("The new passwords do not match.");
  });
});
