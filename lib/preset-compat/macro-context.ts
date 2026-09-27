import type { PresetCompatMacroDiagnosticCode } from '@/lib/preset-compat/macro-types'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'

export type PresetCompatMacroPhase = string

export type PresetCompatMacroNodeLike =
  | string
  | {
      type?: string
      value?: string
      text?: string
      raw?: string
      content?: string
      children?: readonly PresetCompatMacroNodeLike[]
      [key: string]: unknown
    }

export type PresetCompatMacroInvocationLike = {
  name: string
  args?: readonly PresetCompatMacroNodeLike[]
  branches?: readonly PresetCompatMacroNodeLike[]
  [key: string]: unknown
}

export type PresetCompatMacroDiagnostic = {
  code: PresetCompatMacroDiagnosticCode
  message: string
  macroName?: string
  surfaceId: PresetCompatSurfaceId
  phase: PresetCompatMacroPhase
}

export type PresetCompatMacroContext = {
  surfaceId: PresetCompatSurfaceId
  phase: PresetCompatMacroPhase
  diagnostics: PresetCompatMacroDiagnostic[]
  addDiagnostic: (diagnostic: Omit<PresetCompatMacroDiagnostic, 'surfaceId' | 'phase'>) => PresetCompatMacroDiagnostic
  getNow: () => Date
  random: () => number
  getRuntimeValue: (key: string) => unknown
  setRuntimeValue: (key: string, value: unknown) => void
  getLocalVariable: (key: string) => unknown
  setLocalVariable: (key: string, value: unknown) => void
  getGlobalVariable: (key: string) => unknown
  setGlobalVariable: (key: string, value: unknown) => void
}

export type CreatePresetCompatMacroContextOptions = {
  surfaceId: PresetCompatSurfaceId
  phase: PresetCompatMacroPhase
  seed?: number | null
  now?: Date | (() => Date)
  runtimeValues?: Record<string, unknown>
  localVariables?: Record<string, unknown>
  globalVariables?: Record<string, unknown>
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0

  return function nextRandom() {
    state = (state + 0x6D2B79F5) >>> 0
    let next = Math.imul(state ^ (state >>> 15), 1 | state)
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function createNowGetter(value: CreatePresetCompatMacroContextOptions['now']) {
  if (typeof value === 'function') {
    return value
  }

  if (value instanceof Date) {
    const frozen = new Date(value)
    return () => new Date(frozen)
  }

  return () => new Date()
}

export function createPresetCompatMacroContext(
  options: CreatePresetCompatMacroContextOptions,
): PresetCompatMacroContext {
  const diagnostics: PresetCompatMacroDiagnostic[] = []
  const runtimeValues = new Map(Object.entries(options.runtimeValues ?? {}))
  const localVariables = new Map(Object.entries(options.localVariables ?? {}))
  const globalVariables = new Map(Object.entries(options.globalVariables ?? {}))
  const getNow = createNowGetter(options.now)
  const random = createSeededRandom(options.seed ?? 0)

  return {
    surfaceId: options.surfaceId,
    phase: options.phase,
    diagnostics,
    addDiagnostic(diagnostic) {
      const nextDiagnostic: PresetCompatMacroDiagnostic = {
        ...diagnostic,
        surfaceId: options.surfaceId,
        phase: options.phase,
      }
      diagnostics.push(nextDiagnostic)
      return nextDiagnostic
    },
    getNow,
    random,
    getRuntimeValue(key) {
      return runtimeValues.get(key)
    },
    setRuntimeValue(key, value) {
      runtimeValues.set(key, value)
    },
    getLocalVariable(key) {
      return localVariables.get(key)
    },
    setLocalVariable(key, value) {
      localVariables.set(key, value)
    },
    getGlobalVariable(key) {
      return globalVariables.get(key)
    },
    setGlobalVariable(key, value) {
      globalVariables.set(key, value)
    },
  }
}
