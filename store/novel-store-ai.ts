import { normalizeAISettings } from '@/lib/ai-settings'
import type { NovelStore, NovelStoreGet, NovelStoreSet } from '@/store/novel-store-types'

export function createAISettingsActions(set: NovelStoreSet, get: NovelStoreGet): Pick<NovelStore, 'setAISettings' | 'saveAISettings'> {
  return {
    setAISettings: (settings) => set({ aiSettings: normalizeAISettings(settings) }),
    saveAISettings: async () => {
      const { aiSettings } = get()
      if (!aiSettings) return
      const response = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiSettings),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(error?.error || 'Failed to save AI settings')
      }
      const latest = await fetch('/api/settings/ai', { cache: 'no-store' }).then((res) => res.json())
      set({ aiSettings: normalizeAISettings(latest) })
    },
  }
}
