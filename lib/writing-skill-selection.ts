export const WRITING_SKILL_PROMPT_BLOCK_PREFIX = 'writing-skill:'

export function normalizeWritingSkillCardIds(input: {
  writingSkillCardIds?: unknown
  writingSkillCardId?: unknown
}) {
  const source = Array.isArray(input.writingSkillCardIds)
    ? input.writingSkillCardIds
    : [input.writingSkillCardId]

  return Array.from(new Set(
    source
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  ))
}

export function createWritingSkillRuntimeSeed() {
  const values = new Uint32Array(1)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(values)
    return (values[0] & 0x7fffffff) || 1
  }
  return Math.max(1, Math.floor(Math.random() * 0x7fffffff))
}

export function buildWritingSkillPromptBlockId(cardId: string) {
  return `${WRITING_SKILL_PROMPT_BLOCK_PREFIX}${cardId}`
}

export function isWritingSkillPromptBlockId(blockId: string) {
  return blockId.startsWith(WRITING_SKILL_PROMPT_BLOCK_PREFIX)
}

export function readWritingSkillCardIdFromPromptBlockId(blockId: string) {
  return isWritingSkillPromptBlockId(blockId)
    ? blockId.slice(WRITING_SKILL_PROMPT_BLOCK_PREFIX.length)
    : null
}
