import type { PresetCompatMacroContext, PresetCompatMacroNodeLike } from '@/lib/preset-compat/macro-context'
import { normalizePresetCompatVariableInvocation } from '@/lib/preset-compat/macro-builtins-variables'
import { evaluatePresetCompatMacroInvocation } from '@/lib/preset-compat/macro-evaluator'
import type {
  PresetCompatParsedMacroNode,
} from '@/lib/preset-compat/macro-parser'
import { parsePresetCompatMacroSource } from '@/lib/preset-compat/macro-parser'
import type { PresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'

export type ProcessPresetCompatMacroOptions = {
  context: PresetCompatMacroContext
  registry: PresetCompatMacroRegistry
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createInvocationFromParsedNode(node: PresetCompatParsedMacroNode) {
  return normalizePresetCompatVariableInvocation({
    name: node.rawName || node.normalizedName,
    whitespaceControl: node.whitespaceControl,
    args: node.args.map((argument) => ({ children: argument.segments })),
    branches: node.form === 'block'
      ? [
          { children: node.children },
          { children: node.elseChildren ?? [] },
        ]
      : [],
  })
}

function resolveParsedMacroNode(node: PresetCompatParsedMacroNode, options: ProcessPresetCompatMacroOptions): string {
  return evaluatePresetCompatMacroInvocation({
    invocation: createInvocationFromParsedNode(node),
    context: options.context,
    registry: options.registry,
    resolveNode(nodeLike) {
      return resolveMacroNodeLike(nodeLike, options)
    },
  })
}

function resolveMacroNodeLike(node: PresetCompatMacroNodeLike, options: ProcessPresetCompatMacroOptions): string {
  if (typeof node === 'string') {
    return processPresetCompatMacroString(node, options)
  }

  if ('type' in node && node.type === 'text' && typeof node.value === 'string') {
    return node.value
  }

  if ('type' in node && node.type === 'malformed-macro' && typeof node.raw === 'string') {
    return node.raw
  }

  if ('type' in node && node.type === 'macro') {
    return resolveParsedMacroNode(node as PresetCompatParsedMacroNode, options)
  }

  if (Array.isArray(node.children)) {
    return node.children.map((child) => resolveMacroNodeLike(child, options)).join('')
  }

  if (typeof node.value === 'string') {
    return node.value
  }

  if (typeof node.text === 'string') {
    return node.text
  }

  if (typeof node.raw === 'string') {
    return node.raw
  }

  if (typeof node.content === 'string') {
    return node.content
  }

  return ''
}

export function processPresetCompatMacroString(source: string, options: ProcessPresetCompatMacroOptions): string {
  const parsed = parsePresetCompatMacroSource(source)

  for (const diagnostic of parsed.diagnostics) {
    options.context.addDiagnostic({
      code: diagnostic.code,
      message: diagnostic.message,
    })
  }

  return parsed.nodes.map((node) => resolveMacroNodeLike(node, options)).join('')
}

export function processPresetCompatMacroJson<T>(value: T, options: ProcessPresetCompatMacroOptions): T {
  if (typeof value === 'string') {
    return processPresetCompatMacroString(value, options) as T
  }

  if (Array.isArray(value)) {
    return value.map((entry) => processPresetCompatMacroJson(entry, options)) as T
  }

  if (!isObjectRecord(value)) {
    return value
  }

  const output: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    output[key] = processPresetCompatMacroJson(entry, options)
  }

  return output as T
}
