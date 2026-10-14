import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The app has no React Native render-test setup (MOBILE_PARITY_PLAYBOOK known defect 9),
// so these guards read the source: the behaviour they protect is a single wiring line.
const source = (relative: string): string => readFileSync(`${process.cwd()}/src/features/assistant/${relative}`, "utf8");

describe("Ask Kiara voice never sends", () => {
  it("puts the transcript into the draft only", () => {
    const chat = source("./KiaraChat.tsx");
    const wiring = chat.match(/useKiaraVoice\(\(text\) => ([^\n]+)\);/);
    expect(wiring?.[1]).toBe("setDraft(appendKiaraTranscript(draftRef.current, text, KIARA_QUESTION_MAX_LENGTH))");
  });

  it("uploads to ask-kiara/transcribe and never asks Kiara from the voice module", () => {
    const voice = source("./KiaraVoiceButton.tsx");
    expect(voice).toContain("upload: transcribeKiaraVoice");
    expect(voice).not.toMatch(/askKiara|sendKiaraQuestion/);
  });
});

describe("Tasks voice keeps its contract on the shared recorder", () => {
  it("records the same file and calls interpret-task-voice with the same wording", () => {
    const tasks = source("../tasks/VoiceTaskCapture.tsx");
    expect(tasks).toContain('fileName: "voice-note.m4a"');
    expect(tasks).toContain("upload: interpretTaskVoiceNote");
    expect(tasks).toContain('failureMessage: "Unable to interpret the voice note."');
    const recorder = source("../voice/useVoiceNoteRecorder.ts");
    expect(recorder).toContain('type: "audio/mp4"');
    expect(recorder).toContain("RecordingPresets.HIGH_QUALITY");
    expect(recorder).toContain("recorder.record({ forDuration: VOICE_NOTE_MAX_SECONDS })");
  });
});
