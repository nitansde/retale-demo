import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { decodeHTMLStrict } from '#html-entity-decoder'
import { escapeText } from 'entities/escape'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function htmlToPlainText(html: string) {
  const text = html
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
  // Decode once, after stripping markup, so encoded literal tags remain prose.
  return decodeHTMLStrict(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function countChineseFriendlyWords(text: string) {
  return text.replace(/\s/g, '').length
}

function endsWithParagraphPunctuation(text: string) {
  return /[。！？!?…]+[”’」』】）》」』）)]*$/.test(text)
}

function startsWithParagraphIndent(text: string) {
  return /^[\t 　]+/.test(text)
}

export function splitPlainTextParagraphs(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return [] as string[]

  const paragraphs: string[] = []
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .filter((line) => line.trim())

    if (!lines.length) continue

    let buffer = ''

    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!buffer) {
        buffer = trimmedLine
        continue
      }

      if (startsWithParagraphIndent(line) || endsWithParagraphPunctuation(buffer)) {
        paragraphs.push(buffer.trim())
        buffer = trimmedLine
        continue
      }

      buffer = `${buffer}${trimmedLine}`
    }

    if (buffer.trim()) {
      paragraphs.push(buffer.trim())
    }
  }

  return paragraphs.filter(Boolean)
}

export function plainTextToHtml(text: string) {
  const paragraphs = splitPlainTextParagraphs(text)
  return (paragraphs.length ? paragraphs : ['　'])
    .map((paragraph) => `<p>${escapeText(paragraph.trim() || '　')}</p>`)
    .join('')
}

export function plainTextLinesToHtml(text: string) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (paragraphs.length ? paragraphs : ['　'])
    .map((paragraph) => `<p>${escapeText(paragraph || '　')}</p>`)
    .join('')
}

export function normalizeLegacySingleParagraphHtml(html: string) {
  const trimmed = html.trim()
  if (!trimmed) return html

  if (!/^(\s*<p>[\s\S]*?<\/p>\s*)+$/i.test(trimmed)) {
    return html
  }

  const paragraphMatches = Array.from(trimmed.matchAll(/<p>([\s\S]*?)<\/p>/gi))
  if (!paragraphMatches.length) {
    return html
  }

  const paragraphContents = paragraphMatches.map((match) => match[1] ?? '')
  if (paragraphContents.some((content) => /<(?!br\s*\/?>)/i.test(content))) {
    return html
  }

  const normalizedText = paragraphContents
    .map((content) => decodeHTMLStrict(content.replace(/<br\s*\/?>/gi, '\n')).replace(/\u00a0/g, ' '))
    .join('\n')
  const nonEmptyLineCount = normalizedText.split('\n').filter((line) => line.trim()).length
  if (nonEmptyLineCount <= paragraphMatches.length) {
    return html
  }

  return plainTextLinesToHtml(normalizedText)
}

export function getParagraphsFromHtml(html: string) {
  return splitPlainTextParagraphs(htmlToPlainText(html))
}

export function formatNowLabel() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

export function createUuid() {
  const cryptoObject = globalThis.crypto
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof cryptoObject?.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const raw of values) {
    const value = raw?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

export function chunkValues<T>(values: T[], size = 500) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export function shuffleWithSeed<T>(items: T[], random: () => number) {
  const next = items.slice()
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[next[index], next[target]] = [next[target], next[index]]
  }
  return next
}

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, '').length / 1.6))
}
