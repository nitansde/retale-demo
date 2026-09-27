function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** The rewrite route can return JSON when a preset disables streaming. */
export function readRoleplayReplyContent(value: unknown): string | null {
  const payload = record(value)
  if (!payload || payload.ok === false || payload.error) return null
  const result = record(payload.result)
  if (typeof result?.content === 'string' && result.content.trim()) return result.content
  const candidate = record(Array.isArray(payload.candidates) ? payload.candidates[0] : null)
  return typeof candidate?.content === 'string' && candidate.content.trim() ? candidate.content : null
}

/** Recover previously saved response envelopes without changing user-authored JSON. */
export function normalizeSavedRoleplayReply(content: string): string {
  if (!content.trimStart().startsWith('{')) return content
  try {
    const payload = record(JSON.parse(content))
    if (typeof payload?.provider !== 'string' || !('presetCompat' in payload || 'metadata' in payload || 'candidates' in payload)) return content
    return readRoleplayReplyContent(payload) ?? content
  } catch {
    return content
  }
}
