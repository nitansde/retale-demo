// Capture PCM16 at 16 kHz in 100 ms packets. Weighted resampling keeps a
// continuous clock at both 44.1 and 48 kHz (no per-render rounding/drift).
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.weight = 0
    this.sum = 0
    this.packet = new Int16Array(1600)
    this.offset = 0
    this.energy = 0
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    for (const sample of channel) {
      let remaining = 1
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight)
        this.sum += sample * take
        this.weight += take
        remaining -= take
        if (this.weight >= this.ratio - 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio))
          this.packet[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767))
          this.energy += value * value
          this.sum = 0; this.weight = 0
          if (this.offset === this.packet.length) {
            this.port.postMessage({ pcm: this.packet.buffer, rms: Math.sqrt(this.energy / this.offset) }, [this.packet.buffer])
            this.packet = new Int16Array(1600); this.offset = 0; this.energy = 0
          }
        }
      }
    }
    return true
  }
}
registerProcessor('retale-voice-capture', VoiceCaptureProcessor)
