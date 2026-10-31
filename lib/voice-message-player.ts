import { setAudioSession } from '@/lib/voice-audio'

export type MessagePlaybackState = 'loading' | 'playing' | 'paused' | 'idle'

/** One reply owns its audio context. Pause retains the audio clock and position. */
export class VoiceMessagePlayer {
  private context = new AudioContext()
  private abort = new AbortController()
  private source?: AudioBufferSourceNode
  private paused = false
  constructor(private changed: (state: MessagePlaybackState) => void, private failed: (message: string) => void) {}

  async play(text: string) {
    this.changed('loading')
    try {
      // Unlock audio during the click, including on iOS, before requesting TTS.
      setAudioSession('playback')
      await this.context.resume()
      this.abort.signal.throwIfAborted()
      const response = await fetch('/api/roleplay/voice/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: this.abort.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || `Speech failed (${response.status})`)
      }
      const bytes = await response.arrayBuffer()
      this.abort.signal.throwIfAborted()
      const buffer = await this.context.decodeAudioData(bytes)
      this.abort.signal.throwIfAborted()
      this.source = this.context.createBufferSource()
      this.source.buffer = buffer; this.source.connect(this.context.destination)
      this.source.onended = () => this.stop()
      this.source.start()
      this.changed(this.paused ? 'paused' : 'playing')
    } catch (error) {
      if (!this.abort.signal.aborted) { this.failed(error instanceof Error ? error.message : 'Speech failed'); this.stop() }
    }
  }

  async toggle() {
    if (this.abort.signal.aborted) return
    this.paused = !this.paused
    this.changed(this.paused ? 'paused' : this.source ? 'playing' : 'loading')
    try { if (this.paused) await this.context.suspend(); else await this.context.resume() }
    catch (error) { if (!this.abort.signal.aborted) { this.failed(error instanceof Error ? error.message : 'Speech failed'); this.stop() } }
  }

  stop() {
    if (this.abort.signal.aborted) return
    this.abort.abort()
    if (this.source) { this.source.onended = null; try { this.source.stop(); this.source.disconnect() } catch { /* Already stopped. */ } }
    if (this.context.state !== 'closed') void this.context.close().catch(() => undefined)
    this.changed('idle')
  }
}
