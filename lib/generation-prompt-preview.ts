export type RequestPromptBlock = {
  id: string
  label: string
  content: string
  kind?: 'preset'
  contextBlockId?: string
}
export type RequestPromptMessage = {
  role: 'system' | 'user'
  blocks: RequestPromptBlock[]
}

type ContextBlockSource = { id: string; label: string; content: string; enabled: boolean; trimmed?: boolean }
type PromptPreviewSources = {
  contextBlocks?: readonly ContextBlockSource[]
  modeSystemPrompt?: string
  baseUserPrompt?: string
  presetUserParts?: readonly string[]
}
type PromptRange = Omit<RequestPromptBlock, 'id' | 'content'> & { start: number; end: number }

function headingsOf(content: string) {
  return [...content.matchAll(/^(#{1,3})[ \t]+([^\r\n]+)\r?$/gm)]
    .map((match) => ({ start: match.index, level: match[1].length, label: match[2].trim() }))
}

// Slice the final strings only after all prompt transforms. Origin hints affect
// presentation only; joining the blocks still reconstructs the provider message.
export function buildRequestPromptMessages(systemPrompt: string, userPrompt: string, sources: PromptPreviewSources = {}): RequestPromptMessage[] {
  return ([['system', systemPrompt], ['user', userPrompt]] as const).map(([role, content]) => {
    const headings = headingsOf(content)
    const ranges: PromptRange[] = []
    const addRange = (range: PromptRange) => {
      if (range.end <= range.start || ranges.some((existing) => range.start < existing.end && range.end > existing.start)) return false
      ranges.push(range)
      return true
    }
    const findText = (text: string, attributes: Omit<PromptRange, 'start' | 'end'>) => {
      if (!text.trim()) return false
      let start = content.indexOf(text)
      while (start !== -1) {
        if (addRange({ ...attributes, start, end: start + text.length })) return true
        start = content.indexOf(text, start + text.length)
      }
      return false
    }

    if (role === 'system') {
      const modeStart = sources.modeSystemPrompt ? content.lastIndexOf(sources.modeSystemPrompt) : -1
      if (modeStart >= 0) addRange({ start: modeStart, end: content.length, label: '角色扮演回复契约' })
      addRange({ start: 0, end: modeStart >= 0 ? modeStart : content.length, label: '预设', kind: 'preset' })
    } else {
      // Protect whole preset fragments before matching context. A preset may
      // itself quote context or contain headings identical to the base prompt.
      for (const part of sources.presetUserParts ?? []) findText(part.trim(), { label: '预设', kind: 'preset' })
      for (const block of sources.contextBlocks ?? []) {
        if (!block.enabled || block.trimmed) continue
        const attributes = { label: block.label, contextBlockId: block.id }
        if (findText(block.content.trim(), attributes)) continue
        const heading = headingsOf(block.content)[0]
        const labels = new Set([block.label, heading?.label])
        if (block.id === 'selected-text') labels.add('原章节起始片段（仅作背景，当前进度见对话历史）')
        // Task/source headers and preset formatting can change the displayed
        // content. Match the final section, retaining the original toggle ID.
        for (let index = 0; index < headings.length; index += 1) {
          const current = headings[index]
          if (!labels.has(current.label)) continue
          const sectionEnd = headings.slice(index + 1).find((next) => next.level <= current.level)?.start ?? content.length
          const end = Math.min(sectionEnd, ...ranges.filter((range) => range.start > current.start).map((range) => range.start))
          if (addRange({ ...attributes, start: current.start, end })) break
        }
      }
    }

    const baseLabels = sources.baseUserPrompt === undefined ? null : new Set(headingsOf(sources.baseUserPrompt).map((heading) => heading.label))
    const blocks: RequestPromptBlock[] = []
    const append = (start: number, end: number, attributes: Omit<PromptRange, 'start' | 'end'>) => {
      blocks.push({ id: `request-${role}-${blocks.length}`, ...attributes, content: content.slice(start, end) })
    }
    const appendGap = (start: number, end: number) => {
      const gapHeadings = headings.filter((heading) => heading.start >= start && heading.start < end)
      const labels = new Map(gapHeadings.map((heading) => [heading.start, heading.label]))
      const starts = [...new Set([start, ...gapHeadings.map((heading) => heading.start)])]
      starts.forEach((offset, index) => {
        const label = labels.get(offset) || (role === 'system' ? 'System' : 'User')
        // A macro may have changed a preset heading or its body. Such sections
        // still belong to the preset, rather than becoming individual rules.
        const text = content.slice(offset, starts[index + 1] ?? end).trim()
        const isPreset = role === 'user' && Boolean(sources.presetUserParts?.length) && baseLabels && !baseLabels.has(label)
          && text && !sources.baseUserPrompt?.includes(text)
        append(offset, starts[index + 1] ?? end, { label, ...(isPreset ? { kind: 'preset' as const } : {}) })
      })
    }
    let cursor = 0
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start > cursor) appendGap(cursor, range.start)
      append(range.start, range.end, { label: range.label, ...(range.kind ? { kind: range.kind } : {}), ...(range.contextBlockId ? { contextBlockId: range.contextBlockId } : {}) })
      cursor = range.end
    }
    if (cursor < content.length || blocks.length === 0) appendGap(cursor, content.length)
    return {
      role,
      blocks,
    }
  })
}
