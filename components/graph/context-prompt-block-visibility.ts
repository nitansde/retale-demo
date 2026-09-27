import type { GenerationContextPromptBlock } from '@/components/graph/types'
import { estimateTokenCount } from '@/lib/utils'

function replaceUserInstruction(content: string, userInstruction: string) {
  const marker = '用户要求：'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) return content

  const instructionStart = markerIndex + marker.length
  const continuationTaskIndex = content.indexOf('\n任务要求：', instructionStart)
  const suffix = continuationTaskIndex >= 0 ? content.slice(continuationTaskIndex) : ''
  return `${content.slice(0, instructionStart)}${userInstruction}${suffix}`
}

export function resolveActiveGenerationContextTokenEstimate(params: {
  blocks: GenerationContextPromptBlock[]
  disabledBlockIds: string[]
  fallbackTokenEstimate: number
  userInstruction: string
}) {
  const disabledBlockIds = new Set(params.disabledBlockIds)
  let contentChanged = false
  const activeContents = params.blocks.flatMap((block) => {
    if (!block.enabled || disabledBlockIds.has(block.id)) {
      contentChanged = true
      return []
    }

    if (block.id !== 'user-instruction') return [block.content]

    const nextInstruction = params.userInstruction.trim() || '按当前模式生成。'
    const nextContent = replaceUserInstruction(block.content, nextInstruction)
    if (nextContent !== block.content) contentChanged = true
    return [nextContent]
  })

  if (!contentChanged) return params.fallbackTokenEstimate
  const assembledContext = activeContents.join('\n\n')
  return assembledContext ? estimateTokenCount(assembledContext) : 0
}
