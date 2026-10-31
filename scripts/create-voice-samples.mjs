// Pre-generates the demo's voice clips with Fish Audio: a static site cannot call
// TTS, so every scripted roleplay line of every book ships as an MP3.
// Run: FISH_API_KEY=... node scripts/create-voice-samples.mjs
// Clips already on disk are kept, so a run stopped by quota can simply be repeated.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const key = process.env.FISH_API_KEY
if (!key) throw new Error('Set FISH_API_KEY')
const model = process.env.FISH_MODEL || 's2.1-pro-free'

mkdirSync('test-results', { recursive: true })
mkdirSync('public/voice', { recursive: true })
const outfile = resolve('test-results/voice-samples.cjs')
await build({
  stdin: { contents: 'export {demoBooks} from "./demo/catalog"; export {scenarioFor} from "./demo/fixtures"; export {DEFAULT_VOICES, speakableText, usesDialogueQuotes} from "./lib/voice-chat"', resolveDir: process.cwd(), loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
})
const { demoBooks, scenarioFor, DEFAULT_VOICES, speakableText, usesDialogueQuotes } = createRequire(import.meta.url)(outfile)

// The default roleplay partner of each book; a line sounds best in that gender.
const maleCounterparts = new Set(['demo-heiress', 'demo-redcliff', 'demo-monkey', 'demo-safe-room', 'demo-crows', 'demo-familiar', 'demo-bellwether', 'demo-austen', 'demo-dracula'])
const voiceFor = (language, gender) => DEFAULT_VOICES.find((voice) => voice.language === language && voice.gender === gender).id

const jobs = []
for (const book of demoBooks) {
  const language = book.locale ?? 'zh'
  const natural = maleCounterparts.has(book.id) ? 'male' : 'female'
  const { reply, responses } = scenarioFor(book.id).roleplay
  for (const text of [reply, ...responses]) jobs.push({ text, voices: [voiceFor(language, natural), voiceFor(language, natural === 'male' ? 'female' : 'male')] })
}

const clips = {}
const speak = async (speech, voiceId, file) => {
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model },
    body: JSON.stringify({ text: speech, reference_id: voiceId, format: 'mp3', mp3_bitrate: 64, sample_rate: 44100, latency: 'normal' }),
  })
  if (!response.ok) throw new Error(`Fish ${response.status}: ${(await response.text()).slice(0, 200)}`)
  // Fish voices differ by about 13 dB; level them so no character is quiet on a phone.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'pipe:0', '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-b:a', '64k', file], { input: Buffer.from(await response.arrayBuffer()) })
}

// Natural voices first, so running out of quota still leaves every book voiced.
let made = 0
try {
  for (const pass of [0, 1]) {
    for (const { text, voices } of jobs) {
      const voiceId = voices[pass]
      const speech = speakableText(text, { depth: 0, star: false, quote: 0, quoted: usesDialogueQuotes(text) })
      const name = `${createHash('sha256').update(`${voiceId}\n${speech}`).digest('hex').slice(0, 16)}.mp3`
      const file = `public/voice/${name}`
      if (!existsSync(file)) { await speak(speech, voiceId, file); made++ }
      ;(clips[text] ??= {})[voiceId] = name
    }
    console.log(`pass ${pass + 1} done`)
  }
} finally {
  writeFileSync('demo/voice-clips.json', `${JSON.stringify(clips, null, 2)}\n`)
  console.log(`${made} generated, ${Object.keys(clips).length}/${jobs.length} lines mapped`)
}
