import { describe, expect, it } from "vitest";
import { edgeFunctionErrorMessage } from "./format";

describe("edgeFunctionErrorMessage", () => {
  it("uses the safe error returned by an Edge Function", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "The selected primary buddy is not available." }), {
        headers: { "Content-Type": "application/json" },
      }),
    };

    await expect(edgeFunctionErrorMessage(error)).resolves.toBe(
      "The selected primary buddy is not available.",
    );
  });

  it("falls back to the ordinary error message when no safe response is available", async () => {
    await expect(edgeFunctionErrorMessage(new Error("Network unavailable"))).resolves.toBe(
      "Network unavailable",
    );
  });
});
