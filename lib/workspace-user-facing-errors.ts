import { getMessage, type Locale, type TranslationKey } from '@/lib/i18n/messages'

const MAX_USER_FACING_DIAGNOSTIC_LENGTH = 1_000
const REDACTED_DIAGNOSTIC_VALUE = '[REDACTED]'
const REDACTED_LOCAL_PATH = '[local path]'

function findQuotedValueEnd(value: string, start: number, quote: string) {
  let cursor = start + 1
  while (cursor < value.length) {
    if (value[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (value[cursor] === quote) return cursor + 1
    cursor += 1
  }
  return value.length
}

function findStructuredValueEnd(value: string, start: number) {
  const openingCharacter = value[start]
  const closingCharacter = openingCharacter === '[' ? ']' : '}'
  let depth = 0
  let cursor = start

  while (cursor < value.length) {
    const character = value[cursor]
    if (character === '"' || character === "'" || character === '`') {
      cursor = findQuotedValueEnd(value, cursor, character)
      continue
    }
    if (character === openingCharacter) depth += 1
    if (character === closingCharacter) {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
    cursor += 1
  }

  return value.length
}

function findSensitiveValueEnd(value: string, start: number) {
  const firstCharacter = value[start]
  if (firstCharacter === '"' || firstCharacter === "'" || firstCharacter === '`') {
    return findQuotedValueEnd(value, start, firstCharacter)
  }
  if (firstCharacter === '[' || firstCharacter === '{') {
    return findStructuredValueEnd(value, start)
  }

  let cursor = start
  while (cursor < value.length && value[cursor] !== '\n' && value[cursor] !== '\r' && value[cursor] !== '}' && value[cursor] !== ']') {
    cursor += 1
  }
  return cursor
}

function isSensitiveDiagnosticKey(key: string) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalizedKey === 'authorization'
    || normalizedKey === 'cookie'
    || normalizedKey === 'setcookie'
    || normalizedKey === 'privatekey'
    || normalizedKey === 'connectsid'
    || normalizedKey.endsWith('authorization')
    || normalizedKey.endsWith('apikey')
    || normalizedKey.endsWith('clientkey')
    || normalizedKey.includes('token')
    || normalizedKey.includes('secret')
    || normalizedKey.includes('password')
    || normalizedKey.includes('passwd')
    || normalizedKey.includes('passphrase')
    || normalizedKey.includes('session')
}

function isNumericTokenCount(key: string, value: string) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return /^(?:(?:max|maximum|input|output|prompt|completion|requested|total|context|allowed)?tokens|tokenlimit|tokencount|maxtokencount|numtokens)$/.test(normalizedKey)
    && /^\d+(?:\.\d+)?(?=[,;\s}\]]|$)/.test(value)
}

function redactSensitiveValues(value: string) {
  const keyPattern = /(?:(?:[A-Za-z_$][A-Za-z0-9_$]*\s*)?\[\s*(["'`])([A-Za-z][A-Za-z0-9_. -]*)\1\s*\]|\\(["'`])([A-Za-z][A-Za-z0-9_. -]*)\\\3|(["'`])([A-Za-z][A-Za-z0-9_. -]*)\5|([A-Za-z][A-Za-z0-9_. -]*?))(\s*(?:=>|[:=])\s*|\s*,\s*)/g
  let redacted = ''
  let cursor = 0
  let match = keyPattern.exec(value)

  while (match) {
    const key = match[2] ?? match[4] ?? match[6] ?? match[7]
    const tupleEntry = match[8].includes(',')
    const quotedKey = Boolean(match[1] || match[3] || match[5])
    // Preserve numeric model limits, while still redacting credentials named "tokens".
    if (isNumericTokenCount(key, value.slice(keyPattern.lastIndex)) || !isSensitiveDiagnosticKey(key) || (tupleEntry && !quotedKey)) {
      match = keyPattern.exec(value)
      continue
    }

    redacted += value.slice(cursor, match.index)
    redacted += `${match[0]}${REDACTED_DIAGNOSTIC_VALUE}`
    cursor = findSensitiveValueEnd(value, keyPattern.lastIndex)
    keyPattern.lastIndex = cursor
    match = keyPattern.exec(value)
  }

  return redacted + value.slice(cursor)
}

function redactUrlUserinfo(value: string) {
  const schemePattern = /\b[a-z][a-z0-9+.-]*:\/\//gi
  let redacted = ''
  let cursor = 0
  let match = schemePattern.exec(value)

  while (match) {
    const authorityStart = schemePattern.lastIndex
    let authorityEnd = authorityStart
    while (authorityEnd < value.length && !/[\s/?#"'`<>]/.test(value[authorityEnd])) authorityEnd += 1

    const authority = value.slice(authorityStart, authorityEnd)
    const userinfoEnd = authority.lastIndexOf('@')
    if (userinfoEnd !== -1) {
      redacted += value.slice(cursor, match.index)
      redacted += `${match[0]}${REDACTED_DIAGNOSTIC_VALUE}@${authority.slice(userinfoEnd + 1)}`
      cursor = authorityEnd
    }

    schemePattern.lastIndex = authorityEnd
    match = schemePattern.exec(value)
  }

  return redacted + value.slice(cursor)
}

function redactHttpUrlLocalPaths(url: string) {
  const suffixStart = url.search(/[?#]/)
  if (suffixStart === -1) return url
  return url.slice(0, suffixStart) + redactLocalPaths(url.slice(suffixStart))
}

function isLocalPathBoundary(value: string, index: number) {
  const previousCharacter = value[index - 1]
  return index === 0
    || /\s/.test(previousCharacter)
    || ['(', '"', "'", '`', '<', '=', ':', '{', '[', '?', '#', '&', ',', ';'].includes(previousCharacter)
}

function isLocalPathStart(value: string) {
  return /^[a-z]:[\\/]/i.test(value)
    || value.startsWith('\\\\')
    || (value.startsWith('//') && !/[\s/]/.test(value[2] ?? ''))
    || (value[0] === '/' && !/[\s/]/.test(value[1] ?? '') && !/^\/api(?:\/|$|[?#])/i.test(value))
    || (value.startsWith('~/') && !/\s/.test(value[2] ?? ''))
    || (value.startsWith('./') && !/\s/.test(value[2] ?? ''))
    || (value.startsWith('../') && !/\s/.test(value[3] ?? ''))
}

function redactEncodedLocalPaths(value: string) {
  return value.replace(/(?:%[0-9a-f]{2}|[a-z0-9._~:\/\\-])+/gi, (candidate) => {
    if (!/%[0-9a-f]{2}/i.test(candidate)) return candidate

    try {
      const decodedCandidate = decodeURIComponent(candidate)
      return isLocalPathStart(decodedCandidate) || /^file:\/\//i.test(decodedCandidate)
        ? REDACTED_LOCAL_PATH
        : candidate
    } catch {
      return candidate
    }
  })
}

function findLocalPathEnd(value: string, pathStart: number, tokenStart: number) {
  const delimiter = value[tokenStart - 1]
  if (delimiter === '"' || delimiter === "'" || delimiter === '`') {
    return findQuotedValueEnd(value, tokenStart - 1, delimiter) - 1
  }
  if (delimiter === '<') {
    const angleEnd = value.indexOf('>', pathStart)
    return angleEnd === -1 ? value.length : angleEnd
  }

  let cursor = pathStart
  while (cursor < value.length && !/[\r\n,;)}>\]]/.test(value[cursor])) cursor += 1
  return cursor
}

function redactLocalPaths(value: string) {
  let redacted = ''
  let cursor = 0

  while (cursor < value.length) {
    const remaining = value.slice(cursor)
    const httpUrl = remaining.match(/^https?:\/\/[^\s"'`<>]+/i)?.[0]
    if (httpUrl) {
      redacted += redactHttpUrlLocalPaths(httpUrl)
      cursor += httpUrl.length
      continue
    }

    const redactedFileUrl = `file://${REDACTED_LOCAL_PATH}`
    if (remaining.startsWith(redactedFileUrl)) {
      redacted += redactedFileUrl
      cursor += redactedFileUrl.length
      continue
    }

    if (/^file:\/\//i.test(remaining)) {
      const pathStart = cursor + 'file://'.length
      redacted += redactedFileUrl
      cursor = findLocalPathEnd(value, pathStart, cursor)
      continue
    }

    if (isLocalPathBoundary(value, cursor)) {
      if (isLocalPathStart(remaining)) {
        redacted += REDACTED_LOCAL_PATH
        cursor = findLocalPathEnd(value, cursor, cursor)
        continue
      }
    }

    redacted += value[cursor]
    cursor += 1
  }

  return redacted
}

export function redactUserFacingDiagnostic(value: string | null | undefined) {
  if (!value) return ''

  const withoutStacks = value
    .replace(/^\s*at\s+(?:async\s+)?(?:.+?\s+\()?[^()\s]+:\d+:\d+\)?\s*$/gm, '')
    .replace(/^[\t ]*File[\t ]+["'][^"'\r\n]+["'],[\t ]+line[\t ]+\d+(?:,[\t ]+in[\t ]+.*)?[\t ]*(?:\r?\n|$)/gm, '')
    .replace(/^\s*at\s+[\w$<>./]+\([^()\r\n]+:\d+\)\s*$/gm, '')
    .replace(/^\s*at\s+.+\s+in\s+.+:line\s+\d+\s*$/gm, '')
    .replace(/^\s*from\s+.+:\d+(?::in\s+.*)?\s*$/gm, '')
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, REDACTED_DIAGNOSTIC_VALUE)

  const withoutCredentials = redactUrlUserinfo(redactSensitiveValues(withoutStacks))
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_DIAGNOSTIC_VALUE}`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9._-]{20,}|xox[a-z]-[A-Za-z0-9-]{16,}|xapp-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|glrt-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{16,}|[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,})\b/g, REDACTED_DIAGNOSTIC_VALUE)

  const redacted = redactLocalPaths(redactEncodedLocalPaths(withoutCredentials))
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (redacted.length <= MAX_USER_FACING_DIAGNOSTIC_LENGTH) return redacted
  return `${redacted.slice(0, MAX_USER_FACING_DIAGNOSTIC_LENGTH - 3).trimEnd()}...`
}

const ERROR_MESSAGE_KEYS: Record<string, TranslationKey> = {
  preset_not_found: 'errors.preset_not_found',
  standalone_regex_not_found: 'errors.standalone_regex_not_found',
  builtin_system_prompt_not_found: 'errors.builtin_system_prompt_not_found',
  load_failed: 'errors.load_failed',
  revision_mismatch: 'errors.revision_mismatch',
  invalid_import_kind: 'errors.invalid_import_kind',
  'Failed to load preset compat library': 'errors.failedLoadPresetCompatLibrary',
  'Failed to save preset compat library': 'errors.failedSavePresetCompatLibrary',
  'Refusing to overwrite a recoverable workspace with an empty payload': 'errors.refuseOverwriteWorkspace',
  'Workspace restore timed out': 'errors.workspaceRestoreTimedOut',
  'Failed to restore workspace': 'errors.failedRestoreWorkspace',
  'Workspace endpoint returned invalid JSON': 'errors.workspaceInvalidJson',
  'Failed to load AI settings': 'errors.failedLoadAISettings',
  'Failed to save AI settings': 'errors.failedSaveAISettings',
  'Continue block load failed': 'errors.continueBlockLoadFailed',
  'Roleplay session load failed': 'errors.roleplaySessionLoadFailed',
  'Roleplay message append failed': 'errors.roleplayMessageAppendFailed',
  'Roleplay variant creation failed': 'errors.roleplayVariantCreationFailed',
  'Roleplay streaming request failed': 'errors.roleplayStreamingRequestFailed',
  'Roleplay streaming response body is empty': 'errors.roleplayStreamingResponseEmpty',
  'What-if session load failed': 'errors.whatIfSessionLoadFailed',
  'Future jump run load failed': 'errors.futureJumpRunLoadFailed',
  'Future jump revise failed': 'errors.futureJumpReviseFailed',
}

const WORKSPACE_OPERATION_MESSAGE_KEYS = {
  'workspace-restore': 'errors.failedRestoreWorkspace',
  'story-timeline-load': 'workspace.storyTimeline.loadFailed',
  'chapter-graph-load': 'workspace.chapterGraph.loadFailed',
  'context-preview': 'workspace.action.contextPreviewFailed',
  'graph-assembly': 'workspace.action.graphAssemblyFailed',
  'graph-relation-update': 'workspace.action.graphRelationUpdateFailed',
  'ollama-model-load': 'workspace.action.loadLocalOllamaModelsFailed',
  'roleplay-session-create': 'workspace.actionError.createRoleplaySessionFailed',
  'roleplay-session-load': 'errors.roleplaySessionLoadFailed',
  'roleplay-send': 'errors.roleplayMessageAppendFailed',
  'roleplay-delete': 'errors.roleplayRequestDeleteFailed',
  'roleplay-branch-delete': 'errors.roleplayBranchDeleteFailed',
  'roleplay-regenerate': 'errors.roleplayVariantCreationFailed',
  'roleplay-stream': 'errors.roleplayStreamingRequestFailed',
  'timeline-node-delete': 'workspace.actionError.deleteTimelineNodeFailed',
  'knowledge-rebuild': 'workspace.action.knowledgeFailed',
  'retrieval-index-rebuild': 'workspace.action.retrievalStartFailed',
  'knowledge-pause': 'workspace.action.pauseKnowledgeFailed',
  'knowledge-abort': 'workspace.action.abortKnowledgeFailed',
  'knowledge-graph-delete': 'workspace.action.deleteKnowledgeGraphFailed',
  'hanlp-cache-delete': 'workspace.action.deleteHanlpCacheFailed',
  'extraction-cache-delete': 'workspace.action.deleteExtractionCacheFailed',
  'embedding-cache-delete': 'workspace.action.deleteEmbeddingCacheFailed',
  'rewrite-create': 'workspace.actionError.createRecoverableRewriteJobFailed',
  'rewrite-abort': 'workspace.actionError.abortGenerationFailed',
  'rewrite-restore': 'workspace.action.restoreRecoverableRewriteJobFailed',
  'rewrite-refresh': 'workspace.action.refreshRecoverableRewriteJobFailed',
  'rewrite-job-failed': 'workspace.action.rewriteFailed',
  'continue-block-load': 'errors.continueBlockLoadFailed',
  'continue-block-save': 'workspace.actionError.saveContinueBlockFailed',
  'what-if-session-load': 'errors.whatIfSessionLoadFailed',
  'what-if-create': 'workspace.actionError.createWhatIfFailed',
  'future-map-load': 'errors.futureMapLoadFailed',
  'future-jump-create': 'errors.futureJumpCreateFailed',
  'future-jump-load': 'errors.futureJumpRunLoadFailed',
  'future-jump-revise': 'errors.futureJumpReviseFailed',
} satisfies Record<string, TranslationKey>

export type WorkspaceErrorOperation = keyof typeof WORKSPACE_OPERATION_MESSAGE_KEYS

const WRITING_ERROR_OPERATIONS = new Set<WorkspaceErrorOperation>([
  'context-preview', 'rewrite-create', 'rewrite-job-failed', 'what-if-create',
  'roleplay-send', 'roleplay-regenerate', 'roleplay-stream',
  'future-jump-create', 'future-jump-revise',
])

function isContextWindowError(message: string) {
  return [
    /context[_\s-]*(?:length|window)?[^\n]{0,100}(?:exceed|limit|maximum|too (?:large|long)|overflow)/i,
    /(?:exceed|maximum|too (?:large|long)|overflow)[^\n]{0,100}context/i,
    /(?:prompt|input|sequence)(?: length)?(?: is)? too (?:large|long)/i,
    /(?:prompt|input|sequence)[^\n]{0,60}(?:length|tokens)[^\n]{0,60}(?:exceed|maximum|limit)/i,
    /(?:超出|超过)[^\n]{0,60}(?:上下文|输入长度|提示词长度)/,
    /(?:上下文|输入|提示词)[^\n]{0,60}(?:过长|过大|超限|上限|超出|超过)/,
  ].some((pattern) => pattern.test(message))
}

function trimMessage(message: string) {
  return message.trim()
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return trimMessage(error.message)
  }

  return typeof error === 'string' ? trimMessage(error) : ''
}

export function toUserFacingError(message: string, locale: Locale = 'zh') {
  const normalizedMessage = trimMessage(message)
  const key = ERROR_MESSAGE_KEYS[normalizedMessage]
  return key ? getMessage(locale, key) : normalizedMessage
}

const PRESET_COMPAT_OPERATION_MESSAGE_KEYS = {
  load: 'errors.failedLoadPresetCompatLibrary',
  save: 'errors.failedSavePresetCompatLibrary',
  'import-preset': 'preset.importPresetFailed',
  'import-regex': 'preset.importRegexFailed',
  'delete-save': 'preset.deleteAfterSaveFailed',
  'export-preset': 'preset.exportMissingSelected',
} satisfies Record<string, TranslationKey>

export type PresetCompatErrorOperation = keyof typeof PRESET_COMPAT_OPERATION_MESSAGE_KEYS

export function toUserFacingPresetCompatError(
  operation: PresetCompatErrorOperation,
  error: unknown,
  locale: Locale = 'zh'
) {
  const key = ERROR_MESSAGE_KEYS[extractErrorMessage(error)] ?? PRESET_COMPAT_OPERATION_MESSAGE_KEYS[operation]
  return getMessage(locale, key)
}

export function resolveWorkspaceUserFacingError(
  operation: WorkspaceErrorOperation,
  error: unknown,
  locale: Locale = 'zh'
) {
  const message = extractErrorMessage(error)
  const knownKey = ERROR_MESSAGE_KEYS[message]
  const fallback = getMessage(locale, knownKey ?? WORKSPACE_OPERATION_MESSAGE_KEYS[operation])
  if (knownKey || !WRITING_ERROR_OPERATIONS.has(operation)) return fallback
  const diagnostic = redactUserFacingDiagnostic(message)
  if (!diagnostic) return fallback
  return `${fallback}\n${diagnostic}${isContextWindowError(message) ? `\n${getMessage(locale, 'errors.contextWindowExceeded')}` : ''}`
}

export function toUserFacingWorkspaceError(error: unknown, locale: Locale = 'zh') {
  return resolveWorkspaceUserFacingError('workspace-restore', error, locale)
}
