import { describe, expect, it } from "vitest";
import { initialVoiceCaptureState, reduceVoiceCapture, VOICE_NOTE_MAX_SECONDS } from "./voiceCaptureModel";

describe("voiceCaptureModel", () => {
  it("counts down and requests an automatic stop at 60 seconds", () => {
    let state = reduceVoiceCapture(initialVoiceCaptureState, { type: "start" });
    for (let second = 0; second < VOICE_NOTE_MAX_SECONDS; second += 1) {
      state = reduceVoiceCapture(state, { type: "tick" });
    }
    expect(state).toMatchObject({ status: "recording", secondsLeft: 0, stopRequested: true });
  });

  it("returns to a usable error state when microphone permission is denied", () => {
    expect(reduceVoiceCapture(initialVoiceCaptureState, { type: "permission_denied" })).toMatchObject({
      status: "error",
      error: "Microphone access was blocked. Enable it in device settings and try again.",
    });
  });

  it("rejects a zero-byte recording", () => {
    const recording = reduceVoiceCapture(initialVoiceCaptureState, { type: "start" });
    expect(reduceVoiceCapture(recording, { type: "stopped", size: 0 })).toMatchObject({
      status: "error",
      error: "Nothing was recorded. Try again.",
    });
  });

  it("moves a valid stopped recording into interpretation", () => {
    const recording = reduceVoiceCapture(initialVoiceCaptureState, { type: "start" });
    expect(reduceVoiceCapture(recording, { type: "stopped", size: 128 }).status).toBe("interpreting");
  });

  it("keeps the transcript after success and allows recording again", () => {
    const interpreted = reduceVoiceCapture(
      { ...initialVoiceCaptureState, status: "interpreting" },
      { type: "interpreted", transcript: "Count stock tomorrow" },
    );
    expect(interpreted).toMatchObject({ status: "idle", transcript: "Count stock tomorrow" });
    expect(reduceVoiceCapture(interpreted, { type: "start" })).toMatchObject({ status: "recording", transcript: null });
  });

  it("supports retry after interpretation failure", () => {
    const failed = reduceVoiceCapture(
      { ...initialVoiceCaptureState, status: "interpreting" },
      { type: "failed", message: "Unable to interpret the voice note." },
    );
    expect(failed.status).toBe("error");
    expect(reduceVoiceCapture(failed, { type: "start" }).status).toBe("recording");
  });

  it("cleans up an interrupted recording back to idle", () => {
    const recording = reduceVoiceCapture(initialVoiceCaptureState, { type: "start" });
    expect(reduceVoiceCapture(recording, { type: "cancel" })).toEqual(initialVoiceCaptureState);
  });
});
