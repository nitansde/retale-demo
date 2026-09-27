export type ContextLine = { lineNo: number; text: string }

export function splitContextLines(text: string): ContextLine[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line, index) => ({
    lineNo: index + 1,
    text: line,
  }))
}

// Without editor offsets, identical occurrences are ambiguous. Choose the first
// contiguous occurrence consistently for both the neighborhood and chapter prefix.
export function findSelectionSpan(text: string, selectedText: string) {
  const selection = selectedText.trim()
  if (!selection) return null
  const directStart = text.indexOf(selection)
  if (directStart >= 0) return { start: directStart, end: directStart + selection.length }

  const normalizedSelection = selection.replace(/\s+/g, ' ')
  const normalizedStart = text.replace(/\s+/g, ' ').indexOf(normalizedSelection)
  if (normalizedStart < 0) return null
  const normalizedEnd = normalizedStart + normalizedSelection.length
  let normalizedOffset = 0
  let start = 0
  let previousWhitespace = false

  // Map the two boundaries back without allocating a per-character offset array.
  for (let offset = 0; offset < text.length; offset += 1) {
    const whitespace = /\s/.test(text[offset])
    if (whitespace && previousWhitespace) continue
    previousWhitespace = whitespace
    if (normalizedOffset === normalizedStart) start = offset
    normalizedOffset += 1
    if (normalizedOffset === normalizedEnd) return { start, end: offset + 1 }
  }
  return null
}

export function inferSelectionRange(lines: readonly ContextLine[], selectedText: string) {
  const missing = { lineStart: null, lineEnd: null }
  const span = findSelectionSpan(lines.map((line) => line.text).join('\n'), selectedText)
  if (!span) return missing

  let offset = 0
  let lineStart: number | null = null
  for (const line of lines) {
    const end = offset + line.text.length
    if (lineStart === null && span.start < end) lineStart = line.lineNo
    if (span.end <= end) return { lineStart, lineEnd: line.lineNo }
    offset = end + 1
  }
  return missing
}
