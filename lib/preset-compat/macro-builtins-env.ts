import type { PresetCompatMacroContext } from '@/lib/preset-compat/macro-context'
import {
  createPresetCompatRegisteredMacro,
  type PresetCompatRegisteredMacro,
} from '@/lib/preset-compat/macro-registry'

type RuntimeLookupSpec = {
  macroName: string
  keys: readonly string[]
  fallback?: string
}

const ENV_MACRO_SPECS: readonly RuntimeLookupSpec[] = [
  { macroName: 'user', keys: ['user', 'userName', 'protagonistName'], fallback: '主人公' },
  { macroName: 'bot', keys: ['bot', 'assistant', 'assistantName'] },
  { macroName: 'char', keys: ['char', 'charName', 'character', 'characterName'] },
  { macroName: 'persona', keys: ['persona', 'personaPrompt', 'personality', 'personalityPrompt'] },
  { macroName: 'scenario', keys: ['scenario', 'scenarioPrompt'] },
  { macroName: 'chat', keys: ['chat', 'chatName'] },
  { macroName: 'lastmessage', keys: ['lastMessage'] },
  { macroName: 'lastusermessage', keys: ['lastUserMessage'] },
  { macroName: 'lastcharmessage', keys: ['lastCharMessage', 'lastAssistantMessage'] },
  { macroName: 'maxprompt', keys: ['maxPrompt'] },
  { macroName: 'maxcontext', keys: ['maxContext', 'openaiMaxContext'] },
  { macroName: 'maxresponse', keys: ['maxResponse', 'maxTokens'] },
] as const

function normalizeRuntimeValue(value: unknown) {
  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return String(value)
}

function readRuntimeValue(context: PresetCompatMacroContext, spec: RuntimeLookupSpec) {
  for (const key of spec.keys) {
    const normalized = normalizeRuntimeValue(context.getRuntimeValue(key))
    if (normalized !== null) {
      return normalized
    }
  }

  if (typeof spec.fallback === 'string' && context.phase !== 'regex-replacement') {
    return spec.fallback
  }

  context.addDiagnostic({
    code: 'MISSING_CONTEXT_VALUE',
    message: `Macro requires runtime context value: ${spec.macroName}`,
    macroName: spec.macroName,
  })

  return ''
}

export function createPresetCompatEnvMacroBuiltins(): PresetCompatRegisteredMacro[] {
  return ENV_MACRO_SPECS.map((spec) => createPresetCompatRegisteredMacro({
    name: spec.macroName,
    evaluate: ({ context }) => readRuntimeValue(context, spec),
  }))
}
