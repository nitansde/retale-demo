import type {
  PresetCompatMacroContext,
  PresetCompatMacroInvocationLike,
  PresetCompatMacroNodeLike,
} from '@/lib/preset-compat/macro-context'
import type { PresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'

export type EvaluatePresetCompatMacroInvocationOptions = {
  invocation: PresetCompatMacroInvocationLike
  context: PresetCompatMacroContext
  registry: PresetCompatMacroRegistry
  resolveNode?: (node: PresetCompatMacroNodeLike) => string
}

function defaultResolveNode(node: PresetCompatMacroNodeLike): string {
  if (typeof node === 'string') {
    return node
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

  if (Array.isArray(node.children)) {
    return node.children.map((child) => defaultResolveNode(child)).join('')
  }

  return ''
}

function isRuntimeSupportedOnSurface(
  entry: NonNullable<ReturnType<PresetCompatMacroRegistry['get']>>,
  context: PresetCompatMacroContext,
) {
  const capability = entry.contract?.surfaces[context.surfaceId]?.capability
  if (!capability) {
    return entry.supported
  }

  return entry.supported
    && (capability === 'supported-runtime' || capability === 'context-partial')
}

export function evaluatePresetCompatMacroInvocation(
  options: EvaluatePresetCompatMacroInvocationOptions,
): string {
  const { context, invocation, registry } = options
  const macroName = typeof invocation.name === 'string' ? invocation.name.trim() : ''

  if (!macroName) {
    context.addDiagnostic({
      code: 'MALFORMED_MACRO',
      message: 'Macro invocation is missing a valid name.',
    })
    return ''
  }

  const entry = registry.get(macroName)
  if (!entry) {
    context.addDiagnostic({
      code: 'UNKNOWN_MACRO',
      message: `Unknown macro: ${macroName}`,
      macroName,
    })
    return ''
  }

  if (!isRuntimeSupportedOnSurface(entry, context)) {
    context.addDiagnostic({
      code: 'UNSUPPORTED_MACRO',
      message: `Macro is not supported on ${context.surfaceId}: ${entry.canonicalName}`,
      macroName: entry.canonicalName,
    })
    return ''
  }

  const resolveNode = options.resolveNode ?? defaultResolveNode
  const rawArguments = invocation.args ?? []
  const rawBranches = invocation.branches ?? []

  return entry.evaluate({
    context,
    invocation,
    registry,
    rawArguments,
    resolvedArguments: entry.argumentEvaluation === 'eager'
      ? rawArguments.map((node) => resolveNode(node))
      : undefined,
    rawBranches,
    resolvedBranches: entry.branchEvaluation === 'eager'
      ? rawBranches.map((node) => resolveNode(node))
      : undefined,
  })
}
