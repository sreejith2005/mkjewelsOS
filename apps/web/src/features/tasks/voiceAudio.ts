/**
 * Speech-to-text reads a plain 16 kHz mono WAV more reliably than the
 * streaming WebM/MP4 a browser's MediaRecorder produces: that container has no
 * duration or seek index, and a clip the provider cannot decode is answered
 * with invented text rather than an error. The recording is therefore decoded
 * and re-encoded here before upload. 60 s of 16 kHz 16-bit mono is ~1.9 MB.
 */
export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

/** 16-bit PCM WAV of mono samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Averages channels to mono and lifts a quiet recording to a usable level. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
  }
  let peak = 0;
  for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.001 && peak < 0.5) {
    const gain = 0.9 / peak;
    for (let index = 0; index < length; index += 1) mono[index] = (mono[index] ?? 0) * gain;
  }
  return mono;
}

/**
 * Re-encodes a recording as 16 kHz mono WAV. `decodeAudioData` resamples to
 * the context's rate. Returns null when this browser cannot decode its own
 * recording, in which case the caller sends the original.
 */
export async function toTranscriptionWav(recording: Blob): Promise<Blob | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  try {
    const context = new OfflineAudioContext(1, 1, TRANSCRIPTION_SAMPLE_RATE);
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    if (decoded.length === 0) return null;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return encodeWav(mixToMono(channels), decoded.sampleRate);
  } catch {
    return null;
  }
}
