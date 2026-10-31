"use client"

import { useEffect, useState } from 'react'
import type { PublicVoiceSettings } from '@/lib/voice-chat'

export function useVoiceSettings() {
  const [settings, setSettings] = useState<PublicVoiceSettings | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/settings/voice', { cache: 'no-store', signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Unable to load voice settings')
      setSettings(await response.json()); setError('')
    }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load voice settings') })
    return () => abort.abort()
  }, [reload])
  const selectVoice = async (voiceId: string) => {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/settings/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceId }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save voice settings')
      setSettings(data)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save voice settings') }
    finally { setSaving(false) }
  }
  return { settings, setSettings, error, saving, selectVoice, reload: () => setReload((value) => value + 1) }
}
