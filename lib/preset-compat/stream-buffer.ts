export async function readBufferedTextStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (value) {
        text += decoder.decode(value, { stream: true })
      }
    }

    text += decoder.decode()
    return text
  } finally {
    try {
      await reader.cancel()
    } catch {
    }
  }
}

export function createBufferedTextStream(text: string) {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

export async function bufferAndTransformTextStream(
  stream: ReadableStream<Uint8Array>,
  transform: (value: string) => string
) {
  const rawText = await readBufferedTextStream(stream)
  const transformedText = transform(rawText)

  return {
    rawText,
    transformedText,
    stream: createBufferedTextStream(transformedText),
  }
}
