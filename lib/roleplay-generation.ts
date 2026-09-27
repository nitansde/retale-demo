import type { ContextCompressionPreview } from '@/lib/context-compression'
import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'
import type { RequestPromptMessage } from '@/lib/generation-prompt-preview'

export type RoleplayGenerationOptions = {
  disabledBlockIds: string[]
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
  writingSkillSeed: number
}

export function defaultRoleplayGenerationOptions(seed = 1): RoleplayGenerationOptions {
  return { disabledBlockIds: [], writingSkillCardIds: [], writingSkillExampleCount: WRITING_SKILL_DEFAULTS.defaultRuntimeExampleCount, writingSkillSeed: seed }
}

export function isRequiredRoleplayContextBlock(id: string) {
  return ['roleplay-history', 'selected-text', 'user-instruction', 'output-constraints'].includes(id)
}

export function parseRoleplayGenerationOptions(value: unknown): RoleplayGenerationOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const ids = (value: unknown) => Array.isArray(value) && value.length <= 200 && value.every((id) => typeof id === 'string' && id.trim() && id.length <= 200)
    ? [...new Set(value.map((id: string) => id.trim()))] : null
  const disabledBlockIds = ids(input.disabledBlockIds)
  const writingSkillCardIds = ids(input.writingSkillCardIds)
  const count = input.writingSkillExampleCount
  const seed = input.writingSkillSeed
  if (!disabledBlockIds || !writingSkillCardIds || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > WRITING_SKILL_DEFAULTS.maxRuntimeExampleCount
    || typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) return null
  return { disabledBlockIds: disabledBlockIds.filter((id) => !isRequiredRoleplayContextBlock(id)), writingSkillCardIds, writingSkillExampleCount: count, writingSkillSeed: seed }
}

export type RoleplayPromptPreview = {
  compression?: ContextCompressionPreview | null
  tokenEstimate?: number
  requestMessages?: RequestPromptMessage[]
  ok: true
  systemPrompt: string
  userPrompt: string
  contextSnapshotId: string | null
  warnings?: string[]
  promptBlocks: Array<{ id: string; label: string; content: string; enabled: boolean; priority: 'highest' | 'high' | 'medium'; required: boolean; trimmed: boolean }>
  writingSkillRecords: Array<{ skillCardId: string; exampleCount: number; selectedExampleRefs: string[] }>
}
