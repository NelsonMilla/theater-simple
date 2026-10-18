// Stream 80 ms packets of mono, little-endian signed PCM16. Never plays input audio.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.round(sampleRate * 0.08);
    this.samples = new Float32Array(this.capacity);
    this.used = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  flush() {
    if (!this.used) return;
    const buffer = new ArrayBuffer(this.used * 2);
    const view = new DataView(buffer);
    let sum = 0;
    for (let i = 0; i < this.used; i++) {
      const value = Math.max(-1, Math.min(1, this.samples[i]));
      sum += value * value;
      view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    this.port.postMessage({ type: 'pcm', buffer, level: Math.sqrt(sum / this.used) }, [buffer]);
    this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.samples[this.used++] = sample / channels.length;
      if (this.used === this.capacity) this.flush();
    }
    return true;
  }
}
registerProcessor('theater-pcm', PCMProcessor);
