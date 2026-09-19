// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { interpretTaskVoiceNote } = vi.hoisted(() => ({ interpretTaskVoiceNote: vi.fn() }));
vi.mock("./voiceApi", () => ({ interpretTaskVoiceNote }));

const { VoiceTaskCapture } = await import("./VoiceTaskCapture");

class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  constructor(readonly stream: MediaStream) {
    super();
    FakeRecorder.instances.push(this);
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    const data = new Blob(["voice"], { type: this.mimeType });
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
    this.dispatchEvent(new Event("stop"));
  }
}

/** Feeds the level meter a constant signal: 0 is a dead mic, 0.01 a quiet voice, 0.1 a clear one. */
function installAudioContext(amplitude: number, state: AudioContextState = "running") {
  class FakeAudioContext {
    state = state;
    resume() { return Promise.resolve(); }
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude) };
    }
    createMediaStreamSource() { return { connect: () => undefined }; }
    close() { return Promise.resolve(); }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  interpretTaskVoiceNote.mockResolvedValue({ transcript: "Ask Priya to count stock", draft: {}, gaps: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  getUserMedia.mockClear();
  stopTrack.mockClear();
  interpretTaskVoiceNote.mockReset();
});

async function record(milliseconds: number) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Record a task instruction" })); });
  await act(async () => { vi.advanceTimersByTime(milliseconds); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop recording" })); });
}

describe("VoiceTaskCapture", () => {
  it("opens one microphone however many times the mic is tapped while it starts", async () => {
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    const mic = screen.getByRole("button", { name: "Record a task instruction" });
    await act(async () => {
      fireEvent.click(mic);
      fireEvent.click(mic);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it("sends a clip in which a voice was heard and hands back the interpretation", async () => {
    installAudioContext(0.1);
    const onInterpreted = vi.fn();
    render(<VoiceTaskCapture onInterpreted={onInterpreted} />);
    await record(2_000);
    expect(interpretTaskVoiceNote).toHaveBeenCalledTimes(1);
    expect(onInterpreted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-transcript").textContent).toContain("Ask Priya to count stock");
    expect(stopTrack).toHaveBeenCalled();
  });

  it("uploads the recording re-encoded as 16 kHz mono WAV", async () => {
    installAudioContext(0.1);
    class FakeOfflineAudioContext {
      decodeAudioData() {
        return Promise.resolve({ length: 16_000, numberOfChannels: 1, sampleRate: 16_000, getChannelData: () => new Float32Array(16_000).fill(0.3) });
      }
    }
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
    // jsdom's Blob lacks arrayBuffer(); every browser with MediaRecorder has it.
    Object.defineProperty(Blob.prototype, "arrayBuffer", { configurable: true, value: () => Promise.resolve(new ArrayBuffer(8)) });
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    await record(2_000);
    const [sent, filename] = interpretTaskVoiceNote.mock.calls[0] as [Blob, string];
    expect(filename).toBe("voice-note.wav");
    expect(sent.type).toBe("audio/wav");
    expect(sent.size).toBe(44 + 16_000 * 2);
    Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
  });

  it("sends a quiet voice that noise suppression has turned down", async () => {
    installAudioContext(0.01);
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    await record(3_000);
    expect(interpretTaskVoiceNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/no sound/)).toBeNull();
  });

  it("never refuses a clip the meter could not listen to because audio stayed suspended", async () => {
    installAudioContext(0, "suspended");
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    await record(3_000);
    expect(interpretTaskVoiceNote).toHaveBeenCalledTimes(1);
  });

  it("refuses a dead or muted microphone instead of letting speech-to-text invent words", async () => {
    installAudioContext(0);
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    await record(3_000);
    expect(interpretTaskVoiceNote).not.toHaveBeenCalled();
    expect(screen.getByText(/sent no sound at all/)).toBeTruthy();
  });

  it("refuses a mis-tap shorter than a second", async () => {
    installAudioContext(0.1);
    render(<VoiceTaskCapture onInterpreted={vi.fn()} />);
    await record(300);
    expect(interpretTaskVoiceNote).not.toHaveBeenCalled();
    expect(screen.getByText(/too short/)).toBeTruthy();
  });

  it("does not write into a composer that closed while the note was interpreted", async () => {
    installAudioContext(0.1);
    let resolve: (value: unknown) => void = () => undefined;
    interpretTaskVoiceNote.mockReturnValue(new Promise((next) => { resolve = next; }));
    const onInterpreted = vi.fn();
    const { unmount } = render(<VoiceTaskCapture onInterpreted={onInterpreted} />);
    await record(2_000);
    unmount();
    await act(async () => { resolve({ transcript: "late", draft: {}, gaps: [] }); });
    expect(onInterpreted).not.toHaveBeenCalled();
  });
});
