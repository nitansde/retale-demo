import { readVoiceEvents, type VoiceEvent } from '@/lib/voice-chat'
import { captureVoice, setAudioSession, VoicePcmPlayer } from '@/lib/voice-audio'

export type VoiceCallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ending'
export type VoiceReplyResult = { text: string; interrupted: boolean; error?: string }
export type VoiceReplyRunner = (payload: Record<string, unknown>) => Promise<VoiceReplyResult>
export type VoiceCallCallbacks = {
  state: (state: VoiceCallState) => void
  transcript: (text: string) => void
  reply: (text: string) => void
  error: (message: string) => void
  turn: (text: string, runReply: VoiceReplyRunner) => Promise<void>
}

/** Owns one microphone, ASR connection and cancellable playback at a time. */
export class VoiceCall {
  private abort = new AbortController()
  private turnAbort?: AbortController
  private context?: AudioContext
  private player?: VoicePcmPlayer
  private sessionId = ''
  private sequence = 0
  private queue: Uint8Array[] = []
  private uploading = false
  private muted = false
  private turnChain = Promise.resolve()
  private ending?: Promise<void>
  private stopCapture?: () => void
  private silence?: ReturnType<typeof setInterval>
  private current: VoiceCallState = 'idle'
  // Correlates phone and server events in logs/voice-debug (see /api/roleplay/voice/debug).
  private callId = globalThis.crypto?.randomUUID?.() ?? `call-${Date.now()}`
  constructor(private callbacks: VoiceCallCallbacks) {}

  private trace(event: string, data: Record<string, unknown> = {}) {
    void fetch('/api/roleplay/voice/debug', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ call: this.callId, event, audioState: this.context?.state, ...data }),
    }).catch(() => undefined)
  }
  private setState(state: VoiceCallState) {
    if (state !== this.current) { this.current = state; this.trace('state', { state }) }
    this.callbacks.state(state)
  }

  async start(names: string[]) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要 HTTPS 或 localhost / Microphone requires HTTPS or localhost')
    this.setState('connecting')
    try {
      // Create/resume inside the click gesture, before any network await (iOS).
      this.context = new AudioContext()
      this.context.onstatechange = () => this.trace('audio-state')
      await this.context.resume()
      this.trace('start', { userAgent: navigator.userAgent, sampleRate: this.context.sampleRate })
      if (!this.context.audioWorklet) throw new Error('浏览器不支持实时音频，请更新浏览器 / Please update your browser')
      const response = await fetch('/api/roleplay/voice/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names, callId: this.callId }), signal: this.abort.signal,
      })
      let readyResolve!: () => void; let readyReject!: (error: unknown) => void
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
      void readVoiceEvents(response, (event) => {
        if (event.type === 'ready') { this.sessionId = event.sessionId; this.trace('asr-ready'); readyResolve() }
        else if (event.type === 'error') throw new Error(event.error)
        else this.onAsr(event)
      }).then(() => {
        if (!this.abort.signal.aborted) throw new Error('语音连接已断开，请重新开始 / Voice connection closed; start again')
      }).catch((error: unknown) => { readyReject(error); if (!this.abort.signal.aborted) this.fail(error) })
      await ready
      this.abort.signal.throwIfAborted()
      await this.openMic()
      this.setState('listening')
    } catch (error) { if (!this.abort.signal.aborted) this.fail(error); await this.end(); throw error }
  }

  private enqueue(packet: Uint8Array) {
    this.queue.push(packet)
    // 8 s of PCM16 at 16 kHz, matching the upload timeout; 1.5 s ended calls on a single mobile stall.
    if (this.queue.reduce((sum, item) => sum + item.length, 0) > 256_000) { this.fail(new Error('音频上传过慢，请检查网络后重试 / Audio upload is too slow')); return }
    void this.upload()
  }

  private async openMic() {
    const started = Date.now()
    clearInterval(this.silence)
    setAudioSession('play-and-record')
    this.stopCapture = await captureVoice(this.context!, (pcm) => {
      if (this.abort.signal.aborted) return
      // Half-duplex capture prevents echo and speech during replies from
      // interrupting playback or creating an unintended next turn.
      const listening = this.current === 'listening' && !this.muted
      this.enqueue(listening ? new Uint8Array(pcm) : new Uint8Array(pcm.byteLength))
    }, this.abort.signal)
    // Starting the mic can interrupt the context on iOS, which starves capture.
    if (this.context!.state !== 'running') void this.context!.resume().catch(() => undefined)
    this.trace('mic-open', { ms: Date.now() - started })
  }

  // iOS 27 crackles all page audio while the mic captures with echo cancellation,
  // and without it moves playback to the earpiece (WebKit bug 326286). Calls are
  // half-duplex, so give the mic up until the reply has played. Silence at the
  // capture rate keeps the ASR session inside its 20 s watchdog.
  private releaseMic() {
    if (!('audioSession' in navigator)) return
    this.stopCapture?.(); this.stopCapture = undefined
    setAudioSession('playback')
    this.silence = setInterval(() => this.enqueue(new Uint8Array(3200)), 100)
  }

  private async upload() {
    if (this.uploading || this.abort.signal.aborted) return
    this.uploading = true
    try {
      while (this.queue.length && !this.abort.signal.aborted) {
        const packets = this.queue.splice(0, 8)
        const bytes = new Uint8Array(packets.reduce((sum, item) => sum + item.length, 0))
        let offset = 0
        packets.forEach((packet) => { bytes.set(packet, offset); offset += packet.length })
        const response = await fetch(`/api/roleplay/voice/transcribe/${this.sessionId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Sequence': String(this.sequence++) },
          body: bytes, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]),
        })
        if (!response.ok) throw new Error('语音上传中断，请重新开始通话 / Voice upload interrupted; start again')
      }
    } catch (error) { if (!this.abort.signal.aborted) this.fail(error) }
    finally { this.uploading = false }
  }

  private onAsr(event: VoiceEvent) {
    if (this.abort.signal.aborted || this.muted || this.current !== 'listening') return
    if (event.type !== 'transcript') return
    this.callbacks.transcript(event.text)
    if (!event.final || !event.text.trim()) return
    this.trace('asr-final', { text: event.text })
    this.setState('thinking')
    this.releaseMic()
    this.turnChain = this.turnChain.then(async () => {
      if (this.abort.signal.aborted) return
      const controller = new AbortController()
      this.turnAbort = controller
      this.setState('thinking'); this.callbacks.reply('')
      try { await this.callbacks.turn(event.text, (payload) => this.respond(payload, controller.signal)) }
      finally {
        if (this.turnAbort === controller) this.turnAbort = undefined
        if (!this.abort.signal.aborted && !this.stopCapture) await this.openMic().catch((error: unknown) => { if (!this.abort.signal.aborted) this.fail(error) })
        if (!this.abort.signal.aborted) this.setState('listening')
      }
    // One failed reply (TTS hiccup, rate limit, save error) must not hang up the
    // call; show it and keep listening. Connection failures still end the call.
    }).catch((error: unknown) => {
      if (this.abort.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Voice reply failed'
      this.trace('turn-error', { message }); this.callbacks.error(message)
    })
  }

  private async respond(payload: Record<string, unknown>, turnSignal: AbortSignal): Promise<VoiceReplyResult> {
    const signal = AbortSignal.any([turnSignal, this.abort.signal])
    if (signal.aborted) return { text: '', interrupted: true }
    const texts = new Map<number, string>(); const heard = new Set<number>(); const silent = new Set<number>()
    const started = Date.now()
    const player = new VoicePcmPlayer(this.context!, (segment) => { heard.add(segment); this.trace('heard', { segment, ms: Date.now() - started }) })
    this.player = player
    const stop = () => player.stop()
    signal.addEventListener('abort', stop, { once: true })
    let complete = false; let errorMessage: string | undefined
    try {
      const response = await fetch('/api/roleplay/voice/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, voiceCallId: this.callId }), signal,
      })
      await readVoiceEvents(response, (event) => {
        if (signal.aborted) return
        if (event.type === 'error') throw new Error(event.error)
        if (event.type === 'text') { texts.set(event.segment, event.text); if (event.silent) silent.add(event.segment); this.callbacks.reply([...texts.values()].join('')) }
        if (event.type === 'audio') { this.setState('speaking'); player.push(event.audio, event.sampleRate, event.segment) }
        if (event.type === 'segment-end') { this.trace('segment-received', { segment: event.segment, ms: Date.now() - started }); player.endSegment(event.segment) }
        if (event.type === 'done') complete = true
      })
      if (!complete && !signal.aborted) throw new Error('语音回复意外中断 / Voice reply ended unexpectedly')
      await player.drain()
    } catch (error) {
      player.stop()
      if (!signal.aborted) errorMessage = error instanceof Error ? error.message : 'Voice reply failed'
    } finally {
      signal.removeEventListener('abort', stop)
      player.stop()
      if (this.player === player) this.player = undefined
    }
    this.trace('reply-result', { ms: Date.now() - started, segments: texts.size, heard: [...heard], complete, aborted: signal.aborted, error: errorMessage })
    // Unvoiced descriptions count as heard up to the first sentence that was not.
    const cut = Math.min(...[...texts.keys()].filter((id) => !silent.has(id) && !heard.has(id)))
    return { text: [...texts].filter(([id]) => heard.has(id) || (silent.has(id) && id < cut)).map(([, text]) => text).join(''), interrupted: signal.aborted || !complete || Boolean(errorMessage), error: errorMessage }
  }

  stopPlayback() {
    if (this.turnAbort || this.player) this.trace('stop-playback')
    this.turnAbort?.abort(); this.player?.stop()
  }
  setMuted(muted: boolean) { this.muted = muted; if (muted) this.callbacks.transcript('') }
  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'Voice connection failed'
    this.trace('call-error', { message }); this.callbacks.error(message)
    // Never await the chain from within a turn's catch handler.
    void this.end()
  }
  end(): Promise<void> {
    if (this.ending) return this.ending
    this.setState('ending')
    this.abort.abort(); this.stopPlayback(); this.stopCapture?.(); clearInterval(this.silence); this.queue = []
    setAudioSession('playback')
    if (this.sessionId) void fetch(`/api/roleplay/voice/transcribe/${this.sessionId}`, { method: 'DELETE', keepalive: true }).catch(() => undefined)
    this.ending = (async () => {
      // Browsers may close an AudioContext while stopping the input track
      // (especially on iOS/pagehide). close() can throw synchronously in that
      // state, so guard the call itself as well as its returned promise.
      const context = this.context
      if (context && context.state !== 'closed') {
        try { await context.close() } catch { /* Audio resources are already released. */ }
      }
      await this.turnChain
      this.setState('idle')
    })()
    return this.ending
  }
}
