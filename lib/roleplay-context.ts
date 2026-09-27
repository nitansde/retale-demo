export type RoleplayContextMessage = {
  role: 'user' | 'assistant'
  content: string
}

export function normalizeRoleplayContextMessages(messages: readonly RoleplayContextMessage[] | null | undefined) {
  return (messages ?? []).flatMap((message) => {
    const role = message?.role
    const content = typeof message?.content === 'string' ? message.content.trim() : ''
    return (role === 'user' || role === 'assistant') && content
      ? [{ role, content } satisfies RoleplayContextMessage]
      : []
  })
}

export function buildRoleplayContextBlock(messages: readonly RoleplayContextMessage[] | null | undefined) {
  const history = normalizeRoleplayContextMessages(messages)
  if (!history.length) return null
  return {
    id: 'roleplay-history',
    label: '当前角色扮演对话',
    enabled: true,
    priority: 'highest' as const,
    content: [
      '# 当前角色扮演对话',
      '以下是当前分支已经发生的故事，按时间顺序排列。承接最后一段的场景、动作、人物状态和未回答的话，继续往后写。',
      ...history.map((message, index) => `## ${index + 1}. ${message.role === 'user' ? '用户输入' : '已发生的故事'}\n${message.content}`),
    ].join('\n\n'),
  }
}
