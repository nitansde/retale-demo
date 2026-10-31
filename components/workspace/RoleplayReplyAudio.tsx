"use client"

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Pause, Volume2 } from 'lucide-react'
import { VoiceMessagePlayer, type MessagePlaybackState } from '@/lib/voice-message-player'
import { useI18n } from '@/lib/i18n/provider'

const PLAYBACK_EVENT = 'retale-reply-audio-start'

export function RoleplayReplyAudio({ text, disabled, voiceId }: { text: string; disabled: boolean; voiceId: string }) {
  const { t } = useI18n()
  const player = useRef<VoiceMessagePlayer | null>(null)
  const [state, setState] = useState<MessagePlaybackState>('idle')
  const [error, setError] = useState('')
  useEffect(() => {
    const stop = () => { player.current?.stop(); player.current = null }
    window.addEventListener(PLAYBACK_EVENT, stop)
    window.addEventListener('pagehide', stop)
    return () => { window.removeEventListener(PLAYBACK_EVENT, stop); window.removeEventListener('pagehide', stop); stop() }
  }, [text, voiceId, disabled])
  const toggle = () => {
    if (disabled) return
    if (player.current && state !== 'idle') { void player.current.toggle(); return }
    window.dispatchEvent(new Event(PLAYBACK_EVENT))
    setError('')
    try {
      player.current = new VoiceMessagePlayer(setState, setError)
      void player.current.play(text)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Speech failed') }
  }
  const label = t(state === 'playing' || state === 'loading' ? 'voice.pause' : state === 'paused' ? 'voice.resume' : 'voice.play')
  return <div className="mt-1 flex items-center gap-2">
    <button type="button" disabled={disabled} onClick={toggle} aria-label={label} title={label} aria-pressed={state === 'playing'} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-overlay/5 hover:text-zinc-300 disabled:opacity-40">
      {state === 'loading' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : state === 'playing' ? <Pause className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    </button>
    {error ? <span role="alert" className="text-xs text-rose-300">{error}</span> : null}
  </div>
}
