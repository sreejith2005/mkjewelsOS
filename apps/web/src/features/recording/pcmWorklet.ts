/** AudioWorklet compiled separately by Vite. It never performs network I/O. */
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class JewelPcmProcessor extends AudioWorkletProcessor {
  private samples: number[] = [];
  private phase = 0;
  private total = 0;
  private count = 0;
  private levelSum = 0;
  private levelCount = 0;
  private active = true;
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "flush") {
        this.active = false;
        if (this.count) { const average = this.total / this.count; this.samples.push(Math.round(average * (average < 0 ? 32768 : 32767))); this.total = 0; this.count = 0; }
        this.flush(); this.port.postMessage({ type: "flushed" });
      }
    };
  }
  private flush() {
    if (!this.samples.length) return;
    const output = new ArrayBuffer(this.samples.length * 2); const view = new DataView(output);
    this.samples.forEach((value, index) => view.setInt16(index * 2, value, true));
    this.samples = []; this.port.postMessage({ type: "pcm", buffer: output }, [output]);
  }
  process(inputs: Float32Array[][]): boolean {
    if (!this.active) return true;
    const input = inputs[0]?.[0]; if (!input) return true;
    // A stateful box-filter decimator preserves partial input across render quanta.
    for (const raw of input) {
      const value = Math.max(-1, Math.min(1, raw)); this.total += value; this.count++;
      this.levelSum += value * value; this.levelCount++;
      this.phase += 16_000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate; const average = this.total / this.count;
        this.samples.push(Math.round(average * (average < 0 ? 32768 : 32767))); this.total = 0; this.count = 0;
        if (this.samples.length === 32_000) this.flush();
      }
      if (this.levelCount >= sampleRate / 4) {
        this.port.postMessage({ type: "level", level: Math.min(1, Math.sqrt(this.levelSum / this.levelCount) * 4) });
        this.levelSum = 0; this.levelCount = 0;
      }
    }
    return true;
  }
}
registerProcessor("jewelos-pcm", JewelPcmProcessor);
export {};
