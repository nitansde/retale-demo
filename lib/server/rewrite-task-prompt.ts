export const CONTINUATION_SOURCE_BLOCK_LABEL = '已有正文（从这里之后继续写）'

const CONTINUATION_TASK_LINES = [
  '任务要求：接着上下文中给出的已有正文，继续根据用户指令写接下来的故事。',
  '输出要求：只输出后续新正文，不要复述、解释或重新输出已有正文。',
]

export function isContinuationRewriteTask(params: {
  selectedText: string
  hasContinuationSource: boolean
}) {
  return !params.selectedText.trim() && params.hasContinuationSource
}

export function buildRewriteTaskPromptLines(params: {
  operationType: string
  userInstruction: string
  continuation: boolean
}) {
  return [
    params.continuation && params.operationType !== 'roleplay' ? '任务类型：续写后续故事' : `操作类型：${params.operationType}`,
    `用户要求：${params.userInstruction || '按当前模式生成。'}`,
    ...(params.continuation && params.operationType !== 'roleplay' ? CONTINUATION_TASK_LINES : []),
  ]
}
