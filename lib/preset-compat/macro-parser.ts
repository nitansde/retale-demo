import type { PresetCompatMacroDiagnosticCode } from '@/lib/preset-compat/macro-types'

export type PresetCompatMacroSourceRange = {
  start: number
  end: number
}

export type PresetCompatMacroDiagnostic = {
  code: PresetCompatMacroDiagnosticCode
  message: string
  range: PresetCompatMacroSourceRange
  raw: string
}

export type PresetCompatMacroTextNode = {
  type: 'text'
  value: string
  raw: string
  range: PresetCompatMacroSourceRange
}

export type PresetCompatMacroArgument = {
  raw: string
  separator: 'space' | 'double-colon' | 'single-colon'
  segments: PresetCompatMacroNode[]
}

export type PresetCompatMacroNode =
  | PresetCompatMacroTextNode
  | PresetCompatParsedMacroNode
  | PresetCompatMalformedMacroNode

export type PresetCompatParsedMacroNode = {
  type: 'macro'
  form: 'inline' | 'block'
  raw: string
  range: PresetCompatMacroSourceRange
  openTagRange: PresetCompatMacroSourceRange
  closeTagRange: PresetCompatMacroSourceRange | null
  rawName: string
  normalizedName: string
  whitespaceControl: '#' | null
  args: PresetCompatMacroArgument[]
  children: PresetCompatMacroNode[]
  elseChildren: PresetCompatMacroNode[] | null
}

export type PresetCompatMalformedMacroNode = {
  type: 'malformed-macro'
  raw: string
  range: PresetCompatMacroSourceRange
  rawName: string | null
  normalizedName: string | null
}

export type PresetCompatMacroParseResult = {
  nodes: PresetCompatMacroNode[]
  diagnostics: PresetCompatMacroDiagnostic[]
}

type ParsedTag = {
  type: 'open' | 'close' | 'else' | 'malformed'
  raw: string
  range: PresetCompatMacroSourceRange
  rawName: string | null
  normalizedName: string | null
  whitespaceControl: '#' | null
  args: PresetCompatMacroArgument[]
}

type ParseSequenceStop = 'eof' | 'else' | 'close'

type ParseSequenceResult = {
  nodes: PresetCompatMacroNode[]
  diagnostics: PresetCompatMacroDiagnostic[]
  stop: ParseSequenceStop
  stopTag: ParsedTag | null
  nextIndex: number
}

type ParseOptions = {
  allowElse: boolean
  terminatorName: string | null
}

type ParseContext = {
  tags: Map<number, ParsedTag>
  lastClosingTagStarts: Map<string, number>
  blocks: Map<number, PresetCompatParsedMacroNode | null>
}

function isEscaped(source: string, index: number) {
  let backslashCount = 0

  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1
  }

  return backslashCount % 2 === 1
}

function decodeEscapedDelimiters(raw: string) {
  return raw.replaceAll('\\{\\{', '{{').replaceAll('\\}\\}', '}}')
}

function createRange(start: number, end: number, baseOffset: number): PresetCompatMacroSourceRange {
  return {
    start: baseOffset + start,
    end: baseOffset + end,
  }
}

function createTextNode(raw: string, start: number, end: number, baseOffset: number): PresetCompatMacroTextNode | null {
  if (!raw) {
    return null
  }

  return {
    type: 'text',
    raw,
    value: decodeEscapedDelimiters(raw),
    range: createRange(start, end, baseOffset),
  }
}

function createMalformedDiagnostic(
  raw: string,
  start: number,
  end: number,
  baseOffset: number,
  message: string
): PresetCompatMacroDiagnostic {
  return {
    code: 'MALFORMED_MACRO',
    message,
    raw,
    range: createRange(start, end, baseOffset),
  }
}

function createMalformedNode(
  tag: ParsedTag
): PresetCompatMalformedMacroNode {
  return {
    type: 'malformed-macro',
    raw: tag.raw,
    range: tag.range,
    rawName: tag.rawName,
    normalizedName: tag.normalizedName,
  }
}

function findTagEnd(source: string, startIndex: number) {
  let depth = 1

  for (let index = startIndex + 2; index < source.length - 1; index += 1) {
    if (source.startsWith('{{', index) && !isEscaped(source, index)) {
      depth += 1
      index += 1
      continue
    }

    if (source.startsWith('}}', index) && !isEscaped(source, index)) {
      depth -= 1
      if (depth === 0) {
        return index + 2
      }

      index += 1
    }
  }

  return null
}

function getNameTokenEnd(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (/\s/.test(char) || char === ':') {
      return index
    }
  }

  return value.length
}

function parseNestedSegments(raw: string, absoluteStart: number) {
  return parseSequence(raw, absoluteStart, {
    allowElse: false,
    terminatorName: null,
  })
}

function createArgument(
  raw: string,
  separator: PresetCompatMacroArgument['separator'],
  absoluteStart: number
): PresetCompatMacroArgument {
  const nested = parseNestedSegments(raw, absoluteStart)

  return {
    raw,
    separator,
    segments: nested.nodes,
  }
}

function parseArguments(content: string, baseOffset: number) {
  if (!content) {
    return {
      rawName: null,
      normalizedName: null,
      args: [] as PresetCompatMacroArgument[],
    }
  }

  if (content.startsWith('//')) {
    const remainder = content.slice(2).trimStart()
    const spacingPrefixLength = content.slice(2).length - remainder.length
    return {
      rawName: '//',
      normalizedName: '//',
      args: remainder
        ? [createArgument(remainder, 'space', baseOffset + 2 + spacingPrefixLength)]
        : [],
    }
  }

  const nameEnd = getNameTokenEnd(content)
  const rawName = content.slice(0, nameEnd)
  const normalizedName = rawName.toLowerCase()
  const remainder = content.slice(nameEnd)

  if (!rawName) {
    return {
      rawName: null,
      normalizedName: null,
      args: [] as PresetCompatMacroArgument[],
    }
  }

  if (remainder.includes('::')) {
    const firstSeparatorIndex = content.indexOf('::', rawName.length)
    const argsSource = content.slice(firstSeparatorIndex + 2)
    const rawArgs = argsSource.split('::')
    let cursor = firstSeparatorIndex + 2
    const args = rawArgs.map((rawArg, index) => {
      if (index > 0) {
        cursor += 2
      }

      const argument = createArgument(rawArg, 'double-colon', baseOffset + cursor)
      cursor += rawArg.length
      return argument
    })

    return {
      rawName,
      normalizedName,
      args,
    }
  }

  if (content.includes(':')) {
    const parts = content.split(':')
    if (parts.length > 1 && !parts.some((part) => /\s/.test(part))) {
      let cursor = rawName.length + 1
      const args = parts.slice(1).map((rawArg, index) => {
        if (index > 0) {
          cursor += 1
        }

        const argument = createArgument(rawArg, 'single-colon', baseOffset + cursor)
        cursor += rawArg.length
        return argument
      })

      return {
        rawName: parts[0],
        normalizedName: parts[0].toLowerCase(),
        args,
      }
    }
  }

  const trimmedRemainder = remainder.trimStart()
  if (trimmedRemainder) {
    const remainderOffset = remainder.length - trimmedRemainder.length
    return {
      rawName,
      normalizedName,
      args: [createArgument(trimmedRemainder, 'space', baseOffset + nameEnd + remainderOffset)],
    }
  }

  return {
    rawName,
    normalizedName,
    args: [] as PresetCompatMacroArgument[],
  }
}

function parseTag(source: string, startIndex: number, endIndex: number, baseOffset: number): ParsedTag {
  const raw = source.slice(startIndex, endIndex)
  const inner = raw.slice(2, -2)
  let content = inner.trim()
  let whitespaceControl: '#' | null = null

  if (!content) {
    return {
      type: 'malformed',
      raw,
      range: createRange(startIndex, endIndex, baseOffset),
      rawName: null,
      normalizedName: null,
      whitespaceControl,
      args: [],
    }
  }

  if (content.startsWith('#')) {
    whitespaceControl = '#'
    content = content.slice(1).trimStart()
  }

  if (!content) {
    return {
      type: 'malformed',
      raw,
      range: createRange(startIndex, endIndex, baseOffset),
      rawName: null,
      normalizedName: null,
      whitespaceControl,
      args: [],
    }
  }

  if (content.toLowerCase() === 'else') {
    return {
      type: 'else',
      raw,
      range: createRange(startIndex, endIndex, baseOffset),
      rawName: 'else',
      normalizedName: 'else',
      whitespaceControl,
      args: [],
    }
  }

  if (content.startsWith('//')) {
    const parsedArguments = parseArguments(content, startIndex + 2 + inner.indexOf(content) + baseOffset)
    return {
      type: parsedArguments.rawName ? 'open' : 'malformed',
      raw,
      range: createRange(startIndex, endIndex, baseOffset),
      rawName: parsedArguments.rawName,
      normalizedName: parsedArguments.normalizedName,
      whitespaceControl,
      args: parsedArguments.args,
    }
  }

  if (content.startsWith('/')) {
    const { rawName, normalizedName } = parseArguments(content.slice(1).trim(), startIndex + 3 + baseOffset)
    return {
      type: rawName ? 'close' : 'malformed',
      raw,
      range: createRange(startIndex, endIndex, baseOffset),
      rawName,
      normalizedName,
      whitespaceControl,
      args: [],
    }
  }

  const parsedArguments = parseArguments(content, startIndex + 2 + inner.indexOf(content) + baseOffset)

  return {
    type: parsedArguments.rawName ? 'open' : 'malformed',
    raw,
    range: createRange(startIndex, endIndex, baseOffset),
    rawName: parsedArguments.rawName,
    normalizedName: parsedArguments.normalizedName,
    whitespaceControl,
    args: parsedArguments.args,
  }
}

function createParseContext(source: string, baseOffset: number): ParseContext {
  const context: ParseContext = {
    tags: new Map(),
    lastClosingTagStarts: new Map(),
    blocks: new Map(),
  }
  let index = source.indexOf('{{')
  while (index !== -1) {
    if (isEscaped(source, index)) {
      index = source.indexOf('{{', index + 1)
      continue
    }
    const end = findTagEnd(source, index)
    if (end === null) break
    const tag = parseTag(source, index, end, baseOffset)
    context.tags.set(tag.range.start, tag)
    if (tag.type === 'close' && tag.normalizedName) {
      context.lastClosingTagStarts.set(tag.normalizedName, tag.range.start)
    }
    index = source.indexOf('{{', end)
  }
  return context
}

function tryParseBlock(
  source: string,
  tag: ParsedTag,
  afterOpenIndex: number,
  baseOffset: number,
  context: ParseContext,
): PresetCompatParsedMacroNode | null {
  if (!tag.normalizedName || tag.type !== 'open') {
    return null
  }

  // Inline macros cannot form a block without a later closing tag. Previously
  // each one recursively parsed the entire remaining prompt, then discarded it.
  // Adjacent inline macros therefore caused exponential work on long RP prompts.
  if ((context.lastClosingTagStarts.get(tag.normalizedName) ?? -1) < tag.range.end) {
    return null
  }

  const firstPass = parseSequence(source.slice(afterOpenIndex), afterOpenIndex + baseOffset, {
    allowElse: true,
    terminatorName: tag.normalizedName,
  }, context)

  if (firstPass.stop === 'eof') {
    return null
  }

  let closeTag = firstPass.stopTag
  let elseChildren: PresetCompatMacroNode[] | null = null
  let closeIndex = firstPass.nextIndex

  if (firstPass.stop === 'else') {
    const secondPass = parseSequence(source.slice(firstPass.nextIndex - baseOffset), firstPass.nextIndex, {
      allowElse: false,
      terminatorName: tag.normalizedName,
    }, context)

    if (secondPass.stop !== 'close' || !secondPass.stopTag) {
      return null
    }

    elseChildren = secondPass.nodes
    closeTag = secondPass.stopTag
    closeIndex = secondPass.nextIndex
  }

  if (firstPass.stop === 'close' && !closeTag) {
    return null
  }

  return {
    type: 'macro',
    form: 'block',
    raw: source.slice(tag.range.start - baseOffset, closeIndex - baseOffset),
    range: {
      start: tag.range.start,
      end: closeIndex,
    },
    openTagRange: tag.range,
    closeTagRange: closeTag?.range ?? null,
    rawName: tag.rawName ?? '',
    normalizedName: tag.normalizedName,
    whitespaceControl: tag.whitespaceControl,
    args: tag.args,
    children: firstPass.nodes,
    elseChildren,
  }
}

function parseSequence(
  source: string,
  baseOffset: number,
  options: ParseOptions,
  context: ParseContext = createParseContext(source, baseOffset),
): ParseSequenceResult {
  const nodes: PresetCompatMacroNode[] = []
  const diagnostics: PresetCompatMacroDiagnostic[] = []
  let textStart = 0
  let index = 0

  while (index < source.length) {
    if (!source.startsWith('{{', index) || isEscaped(source, index)) {
      index += 1
      continue
    }

    const tag = context.tags.get(baseOffset + index)
    if (!tag) {
      const trailingTextNode = createTextNode(source.slice(textStart), textStart, source.length, baseOffset)
      if (trailingTextNode) {
        nodes.push(trailingTextNode)
      }

      return {
        nodes,
        diagnostics,
        stop: 'eof',
        stopTag: null,
        nextIndex: source.length + baseOffset,
      }
    }

    const textNode = createTextNode(source.slice(textStart, index), textStart, index, baseOffset)
    if (textNode) {
      nodes.push(textNode)
    }

    const tagEnd = tag.range.end - baseOffset

    if (tag.type === 'else') {
      if (options.allowElse) {
        return {
          nodes,
          diagnostics,
          stop: 'else',
          stopTag: tag,
          nextIndex: tag.range.end,
        }
      }

      nodes.push(createMalformedNode(tag))
      index = tagEnd
      textStart = index
      continue
    }

    if (tag.type === 'close') {
      if (options.terminatorName && tag.normalizedName === options.terminatorName) {
        return {
          nodes,
          diagnostics,
          stop: 'close',
          stopTag: tag,
          nextIndex: tag.range.end,
        }
      }

      nodes.push(createMalformedNode(tag))
      index = tagEnd
      textStart = index
      continue
    }

    if (tag.type === 'malformed') {
      nodes.push(createMalformedNode(tag))
      index = tagEnd
      textStart = index
      continue
    }

    // Failed outer blocks can revisit inner tags. Reuse their parse results,
    // including failures, while keeping each argument's parse context separate.
    if (!context.blocks.has(tag.range.start)) {
      context.blocks.set(tag.range.start, tryParseBlock(source, tag, tagEnd, baseOffset, context))
    }
    const blockNode = context.blocks.get(tag.range.start)
    if (blockNode) {
      nodes.push(blockNode)
      index = blockNode.range.end - baseOffset
      textStart = index
      continue
    }

    nodes.push({
      type: 'macro',
      form: 'inline',
      raw: tag.raw,
      range: tag.range,
      openTagRange: tag.range,
      closeTagRange: null,
      rawName: tag.rawName ?? '',
      normalizedName: tag.normalizedName ?? '',
      whitespaceControl: tag.whitespaceControl,
      args: tag.args,
      children: [],
      elseChildren: null,
    })

    index = tagEnd
    textStart = index
  }

  const trailingTextNode = createTextNode(source.slice(textStart), textStart, source.length, baseOffset)
  if (trailingTextNode) {
    nodes.push(trailingTextNode)
  }

  return {
    nodes,
    diagnostics,
    stop: 'eof',
    stopTag: null,
    nextIndex: source.length + baseOffset,
  }
}

function collectDiagnostics(nodes: PresetCompatMacroNode[], diagnostics: PresetCompatMacroDiagnostic[]) {
  for (const node of nodes) {
    if (node.type === 'macro') {
      for (const argument of node.args) {
        collectDiagnostics(argument.segments, diagnostics)
      }
      collectDiagnostics(node.children, diagnostics)
      if (node.elseChildren) {
        collectDiagnostics(node.elseChildren, diagnostics)
      }
      continue
    }

    if (node.type === 'malformed-macro') {
      diagnostics.push({
        code: 'MALFORMED_MACRO',
        message: 'Malformed macro syntax.',
        raw: node.raw,
        range: node.range,
      })
    }
  }
}

export function parsePresetCompatMacroSource(source: string): PresetCompatMacroParseResult {
  const result = parseSequence(source, 0, {
    allowElse: false,
    terminatorName: null,
  })
  const diagnostics = [...result.diagnostics]
  collectDiagnostics(result.nodes, diagnostics)

  return {
    nodes: result.nodes,
    diagnostics,
  }
}
