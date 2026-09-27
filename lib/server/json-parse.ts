export function safeParseJson(value: string | null | undefined) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function safeParseJsonObject(value: string | null | undefined) {
  const parsed = safeParseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}
