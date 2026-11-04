import { describe, expect, it } from "vitest";
import { PcmChunker, parseRecordingSession, reconcileTranscript, validateRecordingEndpoint } from "./recording";

describe("durable recording protocol", () => {
  it("emits full chunks and flushes the final partial exactly once", () => {
    const chunker = new PcmChunker(8);
    expect(chunker.push(new Uint8Array([0, 1, 2]))).toEqual([]);
    expect(chunker.push(new Uint8Array([3, 4, 5, 6, 7, 8, 9]))).toEqual([new Uint8Array([0,1,2,3,4,5,6,7])]);
    expect(chunker.flush()).toEqual(new Uint8Array([8,9]));
    expect(chunker.flush()).toBeNull();
  });
  it("refuses an incomplete PCM sample rather than dropping a byte", () => {
    const chunker = new PcmChunker(8);
    chunker.push(new Uint8Array([1]));
    expect(() => chunker.flush()).toThrow("partial_sample");
  });
  it("accepts only credential-free TLS endpoint roots", () => {
    expect(validateRecordingEndpoint("https://ingest.example.com", "https:")).toBe("https://ingest.example.com");
    for (const url of ["http://ingest.example.com", "https://user:pass@ingest.example.com", "https://ingest.example.com?ticket=x", "https://ingest.example.com/#x"]) {
      expect(() => validateRecordingEndpoint(url, "https:")).toThrow();
    }
  });
  it("does not let a newer provisional overwrite a final segment or duplicate an ID", () => {
    const segment = { segment_id: "a", sequence: 0, revision: 1, text: "provisional", is_final: false, started_ms: 0, ended_ms: 2000 };
    const final = { ...segment, revision: 2, text: "final", is_final: true };
    const current = reconcileTranscript([segment], [final, segment, { ...segment, revision: 3 }]);
    expect(current).toEqual([final]);
  });
  it("rejects invalid scope/status metadata", () => {
    expect(() => parseRecordingSession({ id: "x", status: "recording" })).toThrow("invalid_session");
  });
});
