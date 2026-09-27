import { estimateTokenCount } from '@/lib/utils'

export const HISTORY_COMPRESSION_BATCH_TOKENS = 50_000
// Leave room for chat framing, structured-output instructions and JSON repair.
export const HISTORY_COMPRESSION_REQUEST_RESERVE = 1_500

export type HistoryBatchCursor = { chapterIndex: number; offset: number }
type HistoryChapter = { label: string; content: string }

function fittingPrefixEnd(content: string, tokenBudget: number) {
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokenCount(content.slice(0, middle)) <= tokenBudget) low = middle
    else high = middle - 1
  }
  // Prefer a nearby paragraph boundary without discarding or overlapping text.
  const paragraphEnd = content.lastIndexOf('\n', low - 1) + 1
  let end = paragraphEnd >= low * 0.8 ? paragraphEnd : low
  // Keep UTF-16 surrogate pairs together (e.g. emoji in dialogue).
  if (end > 0 && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end] ?? '')) end -= 1
  return end
}

/** Pack whole chapters in order; split only a chapter that cannot fit on its own. */
export function buildGeneratedHistoryBatch(chapters: HistoryChapter[], cursor: HistoryBatchCursor, tokenBudget: number) {
  const parts: string[] = []
  let remaining = Math.floor(tokenBudget)
  let { chapterIndex, offset } = cursor
  while (chapterIndex < chapters.length) {
    const chapter = chapters[chapterIndex]
    const header = `【${chapter.label}】\n`
    const content = chapter.content.slice(offset)
    const tokens = estimateTokenCount(header + content)
    if (tokens <= remaining) {
      parts.push(header + content)
      remaining -= tokens
      chapterIndex += 1
      offset = 0
      continue
    }
    if (parts.length) break
    const contentBudget = remaining - estimateTokenCount(header)
    const end = contentBudget > 0 ? fittingPrefixEnd(content, contentBudget) : 0
    if (end <= 0) throw new Error('压缩批次可用上下文不足，请使用上下文窗口更大的模型。')
    parts.push(header + content.slice(0, end))
    offset += end
    if (offset === chapter.content.length) { chapterIndex += 1; offset = 0 }
    break
  }
  return { material: parts.join('\n\n'), next: { chapterIndex, offset } }
}
