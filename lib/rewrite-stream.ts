import { redactUserFacingDiagnostic } from '@/lib/workspace-user-facing-errors'

export const REWRITE_STREAM_CONTENT_TYPE = 'application/x-ndjson'

type RewriteStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

/** An in-band error survives HTTP streaming, unlike ReadableStream.error(). */
export function encodeRewriteStream(source: ReadableStream<Uint8Array>) {
  const reader = source.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const encode = (event: RewriteStreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`)
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A chunk can contain only part of a UTF-8 character. Keep reading until
        // there is an event to enqueue, otherwise a consumer can stall forever.
        while (true) {
          const { done, value } = await reader.read()
          if (cancelled) return
          const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
          if (text) controller.enqueue(encode({ type: 'text', text }))
          if (done) {
            controller.enqueue(encode({ type: 'done' }))
            controller.close()
            reader.releaseLock()
          }
          if (done || text) break
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? redactUserFacingDiagnostic(error.message) : ''
        controller.enqueue(encode({ type: 'error', error: message || 'Provider stream failed' }))
        controller.close()
        reader.releaseLock()
      }
    },
    async cancel(reason) {
      cancelled = true
      try { await reader.cancel(reason) } finally { reader.releaseLock() }
    },
  })
}

export async function readRewriteStream(response: Response, onChunk: (chunk: string) => void) {
  if (!response.body) throw new Error('Roleplay streaming response body is empty')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const framed = response.headers.get('content-type')?.includes(REWRITE_STREAM_CONTENT_TYPE)
  let buffer = ''
  let completed = false
  const consume = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as RewriteStreamEvent
    if (event.type === 'error') throw new Error(event.error)
    if (event.type === 'text') onChunk(event.text)
    if (event.type === 'done') completed = true
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (framed) {
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) consume(line)
      } else if (text) onChunk(text)
      if (done || completed) break
    }
    if (framed) {
      if (buffer.trim()) consume(buffer)
      if (!completed) throw new Error('Provider stream ended before generation completed. Please retry.')
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
