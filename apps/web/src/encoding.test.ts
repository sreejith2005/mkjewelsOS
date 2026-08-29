import { describe, expect, it } from "vitest";

/**
 * Guards against mojibake: text that was UTF-8, decoded as cp1252/latin-1, then
 * re-encoded as UTF-8. It reaches users as "Creatingâ€¦" or "â ï¸ Important",
 * and an editor that saves the damaged bytes back makes it permanent, so it is
 * cheaper to fail a test than to find it in the UI.
 */
const MOJIBAKE = [
  "â€", // â€  - mangled punctuation (… — " ")
  "Ã¢", // Ã¢  - doubly mangled
  "ï¿½", // ï¿½ - mangled replacement char
  "�", // U+FFFD replacement character
  "Â·", // Â·  - mangled middle dot
  "Â ", // Â   - mangled non-breaking space
];

describe("source text encoding", () => {
  it("contains no double-encoded UTF-8", () => {
    const modules = import.meta.glob("./**/*.{ts,tsx,css}", { query: "?raw", eager: true, import: "default" });
    const damaged: string[] = [];
    for (const [path, contents] of Object.entries(modules)) {
      if (path.endsWith("encoding.test.ts")) continue;
      const text = contents as string;
      for (const marker of MOJIBAKE) {
        if (text.includes(marker)) {
          damaged.push(`${path} contains ${JSON.stringify(marker)}`);
          break;
        }
      }
    }
    expect(damaged).toEqual([]);
  });
});
