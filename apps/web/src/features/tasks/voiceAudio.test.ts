import { describe, expect, it } from "vitest";
import { encodeWav, mixToMono } from "./voiceAudio";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV header and clamps samples", async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 8);
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("mixToMono", () => {
  it("averages channels and lifts a quiet recording", () => {
    const mono = mixToMono([new Float32Array([0.1, -0.1]), new Float32Array([0.1, -0.1])]);
    expect(mono[0]).toBeCloseTo(0.9);
    expect(mono[1]).toBeCloseTo(-0.9);
  });

  it("leaves silence and an already loud recording alone", () => {
    expect(Array.from(mixToMono([new Float32Array([0, 0])]))).toEqual([0, 0]);
    expect(mixToMono([new Float32Array([0.8])])[0]).toBeCloseTo(0.8);
  });
});
