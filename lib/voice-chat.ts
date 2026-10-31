export type SavedVoice = {
  id: string
  name: string
  gender: 'female' | 'male'
  language: 'zh' | 'en'
}

export const DEFAULT_VOICES: SavedVoice[] = [
  { id: '7f92f8afb8ec43bf81429cc1c9199cb1', name: '学姐', gender: 'female', language: 'zh' },
  { id: '933563129e564b19a115bedd57b7406a', name: 'Sarah', gender: 'female', language: 'en' },
  { id: '5d29a99739c14d4ca3e4fe42193105b2', name: '梓轩', gender: 'male', language: 'zh' },
  { id: 'bf322df2096a46f18c579d0baa36f41d', name: 'Adrin', gender: 'male', language: 'en' },
]

export type VoiceSettings = {
  asrProvider: 'soniox' | 'qwen'
  sonioxApiKey: string
  sonioxModel: string
  qwenApiKey: string
  qwenUrl: string
  qwenModel: string
  fishApiKey: string
  fishModel: string
  voiceId: string
  voices: SavedVoice[]
  language: 'zh' | 'en' | 'auto'
  silenceMs: number
  thinking: 'default' | 'off' | 'low'
}

export type PublicVoiceSettings = Omit<VoiceSettings, 'sonioxApiKey' | 'qwenApiKey' | 'fishApiKey'> & {
  sonioxConfigured: boolean
  qwenConfigured: boolean
  fishConfigured: boolean
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  asrProvider: 'qwen', sonioxApiKey: '', sonioxModel: 'stt-rt-v5',
  qwenApiKey: '', qwenUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime', qwenModel: 'qwen3-asr-flash-realtime',
  fishApiKey: '', fishModel: 's2.1-pro-free', voiceId: DEFAULT_VOICES[0].id, voices: DEFAULT_VOICES, language: 'zh', silenceMs: 500, thinking: 'low',
}

export type VoiceEvent =
  | { type: 'ready'; sessionId: string }
  | { type: 'speech' }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'text'; text: string; segment: number; silent?: boolean }
  | { type: 'audio'; audio: string; sampleRate: number; segment: number }
  | { type: 'segment-end'; segment: number }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'ping' }

/** Read newline-framed events without assuming network chunks match records. */
export async function readVoiceEvents(response: Response, onEvent: (event: VoiceEvent) => void) {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Voice request failed (${response.status})`)
  }
  if (!response.body) throw new Error('Voice stream is empty')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (buffer.length > 2_000_000) throw new Error('Voice event exceeds limit')
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
        if (line) onEvent(JSON.parse(line) as VoiceEvent)
      }
      if (done) {
        if (buffer.trim()) throw new Error('Voice stream ended with an incomplete event')
        break
      }
    }
  } finally { await reader.cancel().catch(() => undefined) }
}

/** Only emit speakable phrases, retaining the tail for the next model chunk. */
export function splitVoicePhrases(text: string, flush = false): { phrases: string[]; rest: string } {
  const phrases: string[] = []
  let rest = text
  while (rest.length) {
    // Keep runs like '？！' and closing quotes with their sentence: Fish returns no
    // audio for a lone '！' or '」'. A '.' at the end of a chunk may be a decimal.
    const match = /(?:[。！？!?；;\n]|\.(?=\s))+[”’"'」』）)】]*/u.exec(rest)
    let end = match ? match.index + match[0].length : rest.length >= 100 ? 100 : flush ? rest.length : 0
    if (match && end === rest.length && !flush) end = 0 // The run may continue in the next chunk.
    if (!end) break
    const phrase = rest.slice(0, end).trim()
    rest = rest.slice(end)
    if (/[\p{L}\p{N}]/u.test(phrase)) phrases.push(phrase) // Punctuation alone has nothing to speak.
  }
  return { phrases, rest }
}

/** A quote opening the reply, a sentence or a line, or after a colon or comma,
 * marks dialogue (她转身道：「走吧。」), unlike an emphasis quote (那个“宝贝”). */
export function usesDialogueQuotes(text: string) {
  return /(?:^|[：:，,。！？!?\n])\s*[「『“"]/.test(text)
}

export type SpeechState = { depth: number; star: boolean; quote: number; quoted: boolean }

/** Drop descriptions the character does not say aloud: （…）, (…), 【…】, […],
 * *…* and, when the reply uses dialogue quotes (`quoted`), everything outside
 * them. `state` carries open brackets and quotes into the next phrase. */
export function speakableText(phrase: string, state: SpeechState = { depth: 0, star: false, quote: 0, quoted: false }) {
  let speech = ''
  for (const char of phrase) {
    if ('（(【['.includes(char)) state.depth++
    else if ('）)】]'.includes(char)) state.depth = Math.max(0, state.depth - 1)
    else if (char === '*') state.star = !state.star
    else if ('「『“'.includes(char)) state.quote++
    else if ('」』”'.includes(char)) state.quote = Math.max(0, state.quote - 1)
    else if (char === '"') state.quote = state.quote ? state.quote - 1 : 1
    else if (!state.depth && !state.star && (!state.quoted || state.quote)) speech += char
  }
  return speech.trim()
}
