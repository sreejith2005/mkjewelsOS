import { describe, expect, it } from "vitest";
import { detectLanguageStyle } from "./language";

describe("language style", () => {
  it.each([
    ["What is pending for me today?", "en"],
    ["आज मेरा क्या पेंडिंग है?", "hi"],
    ["aaj mera kya pending hai?", "hinglish"],
    ["aaj mera kya kaam baaki hai", "hi_latn"],
    ["leave kaise apply karu", "hinglish"],
    ["", "en"],
  ])("labels %j as %s", (text, expected) => {
    expect(detectLanguageStyle(text)).toBe(expected);
  });
});
