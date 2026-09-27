import { createPresetCompatRegisteredMacro } from '@/lib/preset-compat/macro-registry'
import { resolveNodeLike } from '@/lib/preset-compat/macro-builtins-variables'

function isTruthy(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized !== ''
    && normalized !== 'false'
    && normalized !== '0'
    && normalized !== 'null'
    && normalized !== 'undefined'
    && normalized !== 'nan'
    && normalized !== 'no'
    && normalized !== 'off'
}

function reverseText(value: string) {
  return Array.from(value).reverse().join('')
}

function stripBlankEdgeLines(lines: string[]) {
  let start = 0
  let end = lines.length

  while (start < end && lines[start].trim() === '') {
    start += 1
  }

  while (end > start && lines[end - 1].trim() === '') {
    end -= 1
  }

  return lines.slice(start, end)
}

function dedentLines(lines: string[]) {
  const nonEmptyLines = lines.filter((line) => line.trim() !== '')
  if (!nonEmptyLines.length) {
    return lines.join('\n')
  }

  const commonIndent = Math.min(
    ...nonEmptyLines.map((line) => {
      const match = line.match(/^[\t ]*/)
      return match?.[0].length ?? 0
    })
  )

  return lines.map((line) => {
    if (line.trim() === '') {
      return ''
    }
    return line.slice(commonIndent)
  }).join('\n')
}

function trimScopedValue(value: string, preserveWhitespace: boolean) {
  const lines = value.split('\n')
  if (preserveWhitespace) {
    return dedentLines(lines)
  }

  return dedentLines(stripBlankEdgeLines(lines)).trim()
}

export function registerPresetCompatCoreMacroBuiltins() {
  return [
    createPresetCompatRegisteredMacro({
      name: 'space',
      evaluate: () => ' ',
    }),
    createPresetCompatRegisteredMacro({
      name: 'newline',
      evaluate: () => '\n',
    }),
    createPresetCompatRegisteredMacro({
      name: 'noop',
      evaluate: () => '',
    }),
    createPresetCompatRegisteredMacro({
      name: 'else',
      evaluate: () => '',
    }),
    createPresetCompatRegisteredMacro({
      name: 'comment-slashslash',
      aliases: ['//', 'comment'],
      evaluate: () => '',
    }),
    createPresetCompatRegisteredMacro({
      name: 'reverse',
      branchEvaluation: 'deferred',
      evaluate(params) {
        const source = params.resolvedArguments?.[0]
          ?? (params.rawBranches[0] ? resolveNodeLike(params.rawBranches[0], params.context, params.registry) : '')
        return reverseText(source ?? '')
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'trim',
      branchEvaluation: 'deferred',
      evaluate(params) {
        const scopedValue = params.rawBranches[0]
          ? resolveNodeLike(params.rawBranches[0], params.context, params.registry)
          : params.resolvedArguments?.[0] ?? ''
        const preserveWhitespace = 'whitespaceControl' in params.invocation && params.invocation.whitespaceControl === '#'
        return trimScopedValue(scopedValue, preserveWhitespace)
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'if',
      branchEvaluation: 'deferred',
      evaluate(params) {
        const condition = params.resolvedArguments?.[0] ?? ''
        const selectedBranch = isTruthy(condition) ? params.rawBranches[0] : params.rawBranches[1]
        if (!selectedBranch) {
          return ''
        }

        return resolveNodeLike(selectedBranch, params.context, params.registry)
      },
    }),
  ]
}
