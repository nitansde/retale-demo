import type {
  PresetCompatMacroContext,
  PresetCompatMacroInvocationLike,
  PresetCompatMacroNodeLike,
} from '@/lib/preset-compat/macro-context'
import { evaluatePresetCompatMacroInvocation } from '@/lib/preset-compat/macro-evaluator'
import { parsePresetCompatMacroSource } from '@/lib/preset-compat/macro-parser'
import {
  createPresetCompatRegisteredMacro,
  type PresetCompatMacroEvaluateParams,
  type PresetCompatMacroRegistry,
} from '@/lib/preset-compat/macro-registry'

type VariableScope = 'local' | 'global'

const SHORTHAND_OPERATORS = ['||=', '??=', '+=', '-=', '==', '!=', '>=', '<=', '||', '??', '++', '--', '>', '<', '='] as const

function createTextNode(value: string): PresetCompatMacroNodeLike {
  return {
    type: 'text',
    value,
  }
}

function createSegmentNode(value: string): PresetCompatMacroNodeLike {
  const parsed = parsePresetCompatMacroSource(value)
  return {
    children: parsed.nodes,
  }
}

function createInvocationFromNode(node: PresetCompatMacroNodeLike): PresetCompatMacroInvocationLike | null {
  if (typeof node === 'string' || !('type' in node) || node.type !== 'macro') {
    return null
  }

  const typedNode = node as PresetCompatMacroNodeLike & {
    rawName?: string
    normalizedName?: string
    whitespaceControl?: '#' | null
    args?: Array<{ segments?: PresetCompatMacroNodeLike[] }>
    children?: PresetCompatMacroNodeLike[]
    elseChildren?: PresetCompatMacroNodeLike[] | null
    form?: 'inline' | 'block'
  }

  return normalizePresetCompatVariableInvocation({
    name: typedNode.rawName ?? typedNode.normalizedName ?? '',
    whitespaceControl: typedNode.whitespaceControl ?? null,
    args: (typedNode.args ?? []).map((argument) => ({ children: argument.segments ?? [] })),
    branches: typedNode.form === 'block'
      ? [
          { children: typedNode.children ?? [] },
          { children: typedNode.elseChildren ?? [] },
        ]
      : [],
  })
}

export function resolveNodeLike(
  node: PresetCompatMacroNodeLike,
  context: PresetCompatMacroContext,
  registry: PresetCompatMacroRegistry,
): string {
  if (typeof node === 'string') {
    return node
  }

  if ('children' in node && Array.isArray(node.children) && (!('type' in node) || node.type !== 'macro')) {
    return node.children.map((child) => resolveNodeLike(child, context, registry)).join('')
  }

  if ('type' in node && node.type === 'text' && typeof node.value === 'string') {
    return node.value
  }

  const invocation = createInvocationFromNode(node)
  if (invocation) {
    return evaluatePresetCompatMacroInvocation({
      invocation,
      context,
      registry,
      resolveNode: (nextNode) => resolveNodeLike(nextNode, context, registry),
    })
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

  return ''
}

function getScopeLabel(scope: VariableScope) {
  return scope === 'global' ? 'global' : 'local'
}

function getVariableValue(context: PresetCompatMacroContext, scope: VariableScope, key: string) {
  return scope === 'global' ? context.getGlobalVariable(key) : context.getLocalVariable(key)
}

function setVariableValue(context: PresetCompatMacroContext, scope: VariableScope, key: string, value: unknown) {
  if (scope === 'global') {
    context.setGlobalVariable(key, value)
    return
  }

  context.setLocalVariable(key, value)
}

function valueToString(value: unknown) {
  if (value === undefined) {
    return ''
  }

  return typeof value === 'string' ? value : String(value)
}

function isDefined(value: unknown): boolean {
  return value !== undefined
}

function isFallbackWorthy(value: unknown): boolean {
  return value === undefined || valueToString(value) === ''
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || !/^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/.test(trimmed)) {
    return null
  }

  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : null
}

function toBooleanString(value: boolean) {
  return value ? 'true' : 'false'
}

function parseVariableArgs(
  params: PresetCompatMacroEvaluateParams,
  scope: VariableScope,
  expectedMinimum: number,
) {
  const name = (params.resolvedArguments?.[0] ?? '').trim()

  if (!name || (params.rawArguments.length < expectedMinimum && (params.resolvedArguments?.length ?? 0) < expectedMinimum)) {
    params.context.addDiagnostic({
      code: 'INVALID_ARGUMENTS',
      message: `Expected ${expectedMinimum} argument(s) for ${getScopeLabel(scope)} variable macro.`,
      macroName: params.invocation.name,
    })
    return null
  }

  return {
    name,
    value: params.resolvedArguments?.[1] ?? '',
  }
}

function resolveDynamicOperand(
  node: PresetCompatMacroNodeLike | undefined,
  params: PresetCompatMacroEvaluateParams,
) {
  return node ? resolveNodeLike(node, params.context, params.registry) : ''
}

function applyDelta(currentValue: unknown, delta: number) {
  const base = toNumber(currentValue) ?? 0
  return base + delta
}

function compareValues(left: unknown, right: unknown, operator: string) {
  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)

  if (leftNumber !== null && rightNumber !== null) {
    switch (operator) {
      case '==':
        return leftNumber === rightNumber
      case '!=':
        return leftNumber !== rightNumber
      case '>':
        return leftNumber > rightNumber
      case '>=':
        return leftNumber >= rightNumber
      case '<':
        return leftNumber < rightNumber
      case '<=':
        return leftNumber <= rightNumber
      default:
        return false
    }
  }

  const leftString = valueToString(left)
  const rightString = valueToString(right)

  switch (operator) {
    case '==':
      return leftString === rightString
    case '!=':
      return leftString !== rightString
    case '>':
      return leftString > rightString
    case '>=':
      return leftString >= rightString
    case '<':
      return leftString < rightString
    case '<=':
      return leftString <= rightString
    default:
      return false
  }
}

function createScopedOperatorEvaluator(operator: typeof SHORTHAND_OPERATORS[number]) {
  return function evaluateScopedOperator(params: PresetCompatMacroEvaluateParams) {
    const scope = resolveDynamicOperand(params.rawArguments[0], params).trim() === 'global' ? 'global' : 'local'
    const variableName = resolveDynamicOperand(params.rawArguments[1], params).trim()

    if (!variableName) {
      params.context.addDiagnostic({
        code: 'INVALID_ARGUMENTS',
        message: `Missing variable name for ${operator} operator.`,
        macroName: operator,
      })
      return ''
    }

    const currentValue = getVariableValue(params.context, scope, variableName)
    const rhsNode = params.rawArguments[2]
    const rhsValue = () => resolveDynamicOperand(rhsNode, params)

    switch (operator) {
      case '=':
        setVariableValue(params.context, scope, variableName, rhsValue())
        return ''
      case '++':
        setVariableValue(params.context, scope, variableName, applyDelta(currentValue, 1))
        return ''
      case '--':
        setVariableValue(params.context, scope, variableName, applyDelta(currentValue, -1))
        return ''
      case '+=': {
        const nextRaw = rhsValue()
        const leftNumber = toNumber(currentValue)
        const rightNumber = toNumber(nextRaw)
        const nextValue = leftNumber !== null && rightNumber !== null
          ? leftNumber + rightNumber
          : valueToString(currentValue) + nextRaw
        setVariableValue(params.context, scope, variableName, nextValue)
        return ''
      }
      case '-=': {
        const nextValue = (toNumber(currentValue) ?? 0) - (toNumber(rhsValue()) ?? 0)
        setVariableValue(params.context, scope, variableName, nextValue)
        return ''
      }
      case '||':
        return isFallbackWorthy(currentValue) ? rhsValue() : valueToString(currentValue)
      case '??':
        return isDefined(currentValue) ? valueToString(currentValue) : rhsValue()
      case '||=': {
        if (isFallbackWorthy(currentValue)) {
          setVariableValue(params.context, scope, variableName, rhsValue())
        }
        return ''
      }
      case '??=': {
        if (!isDefined(currentValue)) {
          setVariableValue(params.context, scope, variableName, rhsValue())
        }
        return ''
      }
      case '==':
      case '!=':
      case '>':
      case '>=':
      case '<':
      case '<=':
        return toBooleanString(compareValues(currentValue, rhsValue(), operator))
      default:
        return ''
    }
  }
}

export function normalizePresetCompatVariableInvocation(
  invocation: PresetCompatMacroInvocationLike,
): PresetCompatMacroInvocationLike {
  const name = typeof invocation.name === 'string' ? invocation.name.trim() : ''
  if (!name || (name[0] !== '.' && name[0] !== '$')) {
    return invocation
  }

  const scope: VariableScope = name[0] === '$' ? 'global' : 'local'
  const remainder = name.slice(1)

  for (const operator of SHORTHAND_OPERATORS) {
    if (operator === '++' || operator === '--') {
      if (remainder.endsWith(operator)) {
        const variableName = remainder.slice(0, -operator.length).trim()
        return {
          ...invocation,
          name: operator,
          args: [createTextNode(scope), createTextNode(variableName)],
        }
      }
      continue
    }

    const operatorIndex = remainder.indexOf(operator)
    if (operatorIndex <= 0) {
      continue
    }

    const variableName = remainder.slice(0, operatorIndex).trim()
    const rhs = remainder.slice(operatorIndex + operator.length)

    return {
      ...invocation,
      name: operator,
      args: [createTextNode(scope), createTextNode(variableName), createSegmentNode(rhs)],
    }
  }

  return {
    ...invocation,
    name: scope === 'global' ? 'getglobalvar' : 'getvar',
    args: [createTextNode(remainder.trim())],
  }
}

export function registerPresetCompatVariableMacroBuiltins() {
  return [
    createPresetCompatRegisteredMacro({
      name: 'setvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 2)
        if (!parsed) {
          return ''
        }
        params.context.setLocalVariable(parsed.name, parsed.value)
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'getvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 1)
        if (!parsed) {
          return ''
        }
        return valueToString(params.context.getLocalVariable(parsed.name))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'addvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 2)
        if (!parsed) {
          return ''
        }
        const currentValue = params.context.getLocalVariable(parsed.name)
        const leftNumber = toNumber(currentValue)
        const rightNumber = toNumber(parsed.value)
        const nextValue = leftNumber !== null && rightNumber !== null
          ? leftNumber + rightNumber
          : valueToString(currentValue) + parsed.value
        params.context.setLocalVariable(parsed.name, nextValue)
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'incvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 1)
        if (!parsed) {
          return ''
        }
        params.context.setLocalVariable(parsed.name, applyDelta(params.context.getLocalVariable(parsed.name), 1))
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'decvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 1)
        if (!parsed) {
          return ''
        }
        params.context.setLocalVariable(parsed.name, applyDelta(params.context.getLocalVariable(parsed.name), -1))
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'hasvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 1)
        if (!parsed) {
          return ''
        }
        return toBooleanString(isDefined(params.context.getLocalVariable(parsed.name)))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'deletevar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'local', 1)
        if (!parsed) {
          return ''
        }
        const existed = isDefined(params.context.getLocalVariable(parsed.name))
        params.context.setLocalVariable(parsed.name, undefined)
        return toBooleanString(existed)
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'setglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 2)
        if (!parsed) {
          return ''
        }
        params.context.setGlobalVariable(parsed.name, parsed.value)
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'getglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 1)
        if (!parsed) {
          return ''
        }
        return valueToString(params.context.getGlobalVariable(parsed.name))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'addglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 2)
        if (!parsed) {
          return ''
        }
        const currentValue = params.context.getGlobalVariable(parsed.name)
        const leftNumber = toNumber(currentValue)
        const rightNumber = toNumber(parsed.value)
        const nextValue = leftNumber !== null && rightNumber !== null
          ? leftNumber + rightNumber
          : valueToString(currentValue) + parsed.value
        params.context.setGlobalVariable(parsed.name, nextValue)
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'incglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 1)
        if (!parsed) {
          return ''
        }
        params.context.setGlobalVariable(parsed.name, applyDelta(params.context.getGlobalVariable(parsed.name), 1))
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'decglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 1)
        if (!parsed) {
          return ''
        }
        params.context.setGlobalVariable(parsed.name, applyDelta(params.context.getGlobalVariable(parsed.name), -1))
        return ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'hasglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 1)
        if (!parsed) {
          return ''
        }
        return toBooleanString(isDefined(params.context.getGlobalVariable(parsed.name)))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'deleteglobalvar',
      evaluate(params) {
        const parsed = parseVariableArgs(params, 'global', 1)
        if (!parsed) {
          return ''
        }
        const existed = isDefined(params.context.getGlobalVariable(parsed.name))
        params.context.setGlobalVariable(parsed.name, undefined)
        return toBooleanString(existed)
      },
    }),
    ...SHORTHAND_OPERATORS.map((operator) => createPresetCompatRegisteredMacro({
      name: operator,
      argumentEvaluation: 'deferred',
      evaluate: createScopedOperatorEvaluator(operator),
    })),
  ]
}
