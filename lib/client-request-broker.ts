type ClientGetOptions<T> = {
  priority?: RequestPriority
  cache?: RequestCache
  dedupe?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  parse: (response: Response) => Promise<T>
}

type InFlightEntry = {
  controller: AbortController
  consumers: number
  promise: Promise<Response>
}

const inFlightGets = new Map<string, InFlightEntry>()
const activeGets = new Set<InFlightEntry>()

export function normalizeClientGetKey(url: string, cache: RequestCache = 'no-store') {
  const parsed = new URL(url, 'http://client.local')
  const sorted = Array.from(parsed.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  parsed.search = ''
  for (const [key, value] of sorted) parsed.searchParams.append(key, value)
  return `GET ${parsed.pathname}${parsed.search} cache=${cache}`
}

function acquireClientGet<T>(url: string, options: ClientGetOptions<T>) {
  const cache = options.cache ?? 'no-store'
  const key = normalizeClientGetKey(url, cache)
  const dedupe = options.dedupe !== false
  let entry = dedupe ? inFlightGets.get(key) : undefined

  if (!entry) {
    const controller = new AbortController()
    entry = {
      controller,
      consumers: 0,
      promise: fetch(url, { cache, signal: controller.signal, ...(options.priority ? { priority: options.priority } : {}) }),
    }
    activeGets.add(entry)
    if (dedupe) inFlightGets.set(key, entry)
    void entry.promise.finally(() => {
      if (inFlightGets.get(key) === entry) inFlightGets.delete(key)
    }).catch(() => undefined)
  }

  entry.consumers += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    entry!.consumers -= 1
    queueMicrotask(() => {
      if (entry!.consumers === 0) {
        activeGets.delete(entry!)
        // Fetch resolves at the headers; a timed-out body must also stop downloading.
        entry!.controller.abort()
      }
    })
  }
  return { promise: entry.promise, release }
}

export async function requestClientGet<T>(url: string, options: ClientGetOptions<T>): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const consumer = acquireClientGet(url, options)
  let rejectAbort: ((reason: DOMException) => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const releaseOnAbort = () => {
    rejectAbort?.(new DOMException('Aborted', 'AbortError'))
  }
  options.signal?.addEventListener('abort', releaseOnAbort, { once: true })
  const timeoutId = options.timeoutMs && options.timeoutMs > 0
    ? globalThis.setTimeout(() => rejectAbort?.(new DOMException('Timed out', 'AbortError')), options.timeoutMs)
    : null
  try {
    const parsed = consumer.promise.then((response) => options.parse(response.clone()))
    return await (options.signal || timeoutId
      ? Promise.race([parsed, aborted])
      : parsed)
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', releaseOnAbort)
    consumer.release()
  }
}

export function resetClientRequestBrokerForTests() {
  for (const entry of activeGets) entry.controller.abort()
  activeGets.clear()
  inFlightGets.clear()
}
