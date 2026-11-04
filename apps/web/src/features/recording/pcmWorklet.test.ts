import { afterEach, describe, expect, it, vi } from "vitest";

type Frame = { type: string; buffer?: ArrayBuffer; level?: number };
type Processor = { port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (frame: Frame) => void }; process(input: Float32Array[][]): boolean };
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("PCM AudioWorklet", () => {
  it("resamples across render quanta and flushes partial audio before its final acknowledgement", async () => {
    const frames: Frame[] = []; let Constructor: (new () => Processor) | undefined;
    vi.stubGlobal("sampleRate", 48_000);
    vi.stubGlobal("AudioWorkletProcessor", class { port = { onmessage: null, postMessage: (frame: Frame) => { frames.push(frame); } }; });
    vi.stubGlobal("registerProcessor", (_name: string, ctor: new () => Processor) => { Constructor = ctor; });
    await import("./pcmWorklet");
    const processor = new Constructor!();
    for (let i = 0; i < 751; i++) processor.process([[new Float32Array(128).fill(0.5)]]);
    processor.port.onmessage?.({ data: "flush" });
    const audio = frames.filter((frame) => frame.type === "pcm");
    expect(audio[0]?.buffer?.byteLength).toBe(64_000);
    expect(audio[1]?.buffer?.byteLength).toBe(86); // ceil(128 extra input samples / 3) PCM samples.
    expect(frames.at(-1)?.type).toBe("flushed");
    const sample = new DataView(audio[0]!.buffer!).getInt16(0, true);
    expect(sample).toBe(16_384);
    processor.port.onmessage?.({ data: "flush" });
    expect(frames.filter((frame) => frame.type === "pcm")).toHaveLength(2);
  });
});
