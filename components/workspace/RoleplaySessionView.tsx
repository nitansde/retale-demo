"use client"

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { ChevronDown, GitBranch, LoaderCircle, MessageCircle, RefreshCcw, SendHorizonal, SlidersHorizontal, Trash2, Wand2, X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeSavedRoleplayReply, readRoleplayReplyContent } from '@/lib/roleplay-response'
import type { RoleplayMessageRecord, RoleplaySessionDetail } from '@/lib/story-branch-types'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { readRewriteStream, REWRITE_STREAM_CONTENT_TYPE } from '@/lib/rewrite-stream'
import { cn } from '@/lib/utils'
import { RoleplayCastPicker } from './RoleplayCastPicker'
import { RoleplayScriptBlocks } from './RoleplayScriptBlocks'
import { RoleplayGenerationPanel } from './RoleplayGenerationPanel'
import { RoleplayBranchSwitch } from './RoleplayBranchSwitch'
import { RoleplayBranchMenu } from './RoleplayBranchMenu'
import { buildRoleplayMessageTree, getRoleplayBranchDeletionIds, getRoleplayBranchTip, getRoleplayMessagePath as buildMessagePath } from '@/lib/roleplay-branches'
import { defaultRoleplayGenerationOptions } from '@/lib/roleplay-generation'
import { createWritingSkillRuntimeSeed } from '@/lib/writing-skill-selection'
import { parseRoleplayTurn, readGeneratedRoleplayScript, roleplayScriptText, roleplayTurnText, ROLEPLAY_DEFAULT_LENGTH, ROLEPLAY_DIALOGUE_ONLY_DEFAULT_LENGTH, type RoleplayCast, type RoleplayTurn, type RoleplayScript, type RoleplayCharacterOption } from '@/lib/roleplay-script'

type RoleplayMessagePayload = RoleplayMessageRecord & {
  variantMetadata: {
    turnIndex: number
    variantIndex: number
    variantGroupId: string | null
  }
  forkMetadata: {
    parentMessageId: string | null
    forkedFromMessageId: string | null
  }
}

type RoleplaySessionDetailPayload = Omit<RoleplaySessionDetail, 'messages'> & {
  sourceSnapshot: {
    chapterId: string | null
    chapterNo: number
    chapterTitle: string | null
    timelineNodeId: string | null
    timelineNodeType: string | null
    selectedText: string
    textSnapshot: string
    selectedLineStart: number | null
    selectedLineEnd: number | null
  }
  messages: RoleplayMessagePayload[]
  characterOptions?: RoleplayCharacterOption[]
}

const ROLEPLAY_STICKY_BOTTOM_THRESHOLD = 80

async function loadRoleplaySessionDetail(input: {
  novelId: string
  branchId: string
  sessionId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as RoleplaySessionDetailPayload & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay session load failed')
  }
  return data
}

async function appendRoleplayMessage(input: {
  novelId: string
  branchId: string
  sessionId: string
  role: 'user' | 'assistant'
  turn?: RoleplayTurn
  script?: RoleplayScript
  content: string
  parentMessageId?: string | null
  forkedFromMessageId?: string | null
}) {
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const data = await response.json() as RoleplayMessagePayload & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay message append failed')
  }
  return data
}

async function createLatestAssistantVariant(input: {
  sourceMessageId: string
  script?: RoleplayScript
  novelId: string
  branchId: string
  sessionId: string
  content: string
  parentMessageId?: string | null
  forkedFromMessageId?: string | null
}) {
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      mode: 'latest-turn-variant',
      role: 'assistant',
    }),
  })

  const data = await response.json() as RoleplayMessagePayload & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay variant creation failed')
  }
  return data
}

async function streamRoleplayReply(payload: Record<string, unknown>, onChunk: (chunk: string) => void, signal: AbortSignal) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: REWRITE_STREAM_CONTENT_TYPE },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || 'Roleplay streaming request failed')
    }

    throw new Error('Roleplay streaming request failed')
  }

  if (response.headers.get('content-type')?.includes('application/json')) {
    const data: unknown = await response.json().catch(() => null)
    const content = readRoleplayReplyContent(data)
    if (!content) throw new Error('Roleplay streaming response body is empty')
    onChunk(content)
    return
  }

  await readRewriteStream(response, onChunk)
}

function normalizeMessage(message: RoleplayMessagePayload): RoleplayMessagePayload {
  return {
    ...message,
    content: message.role === 'assistant' ? normalizeSavedRoleplayReply(message.content) : message.content,
    variantMetadata: message.variantMetadata ?? {
      turnIndex: message.turnIndex,
      variantIndex: message.variantIndex,
      variantGroupId: message.variantGroupId,
    },
    forkMetadata: message.forkMetadata ?? {
      parentMessageId: message.parentMessageId,
      forkedFromMessageId: message.forkedFromMessageId,
    },
  }
}

export type RoleplaySessionControls = { openCastPicker: () => void }

export function RoleplaySessionView(props: {
  novelId: string
  branchId: string
  sessionId: string
  anchorChapterNo: number
  nodeTitle?: string | null
  nodeSubtitle?: string | null
  readableLineageLabel?: string | null
  controlsRef?: Ref<RoleplaySessionControls>
  onRequestsChange?: () => void
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { locale, t } = useI18n()
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<RoleplaySessionDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cast, setCast] = useState<RoleplayCast | null>(null)
  const [editingCast, setEditingCast] = useState(false)
  const [dialogue, setDialogue] = useState('')
  const [storyGuidance, setStoryGuidance] = useState('')
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [storyTargetCharacters, setStoryTargetCharacters] = useState(ROLEPLAY_DEFAULT_LENGTH)
  const [dialogueOnlyTargetCharacters, setDialogueOnlyTargetCharacters] = useState(ROLEPLAY_DIALOGUE_ONLY_DEFAULT_LENGTH)
  const [dialogueOnly, setDialogueOnly] = useState(false)
  const [forkMessageId, setForkMessageId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null)
  const [pendingScript, setPendingScript] = useState<RoleplayScript | null>(null)
  const [contextCompressing, setContextCompressing] = useState(false)
  const [generationPanel, setGenerationPanel] = useState<'context' | 'skills' | null>(null)
  const [generationOptions, setGenerationOptions] = useState(() => defaultRoleplayGenerationOptions(createWritingSkillRuntimeSeed()))
  const contextSnapshotRef = useRef<string | null>(null)
  const handleContextSnapshot = useCallback((id: string | null) => { contextSnapshotRef.current = id }, [])
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const messageElementsRef = useRef(new Map<string, HTMLElement>())
  const pendingReplyRef = useRef<HTMLDivElement | null>(null)
  const replyScrollTargetRef = useRef<{ messageId: string | null } | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  useImperativeHandle(props.controlsRef, () => ({
    openCastPicker: () => { if (detail && cast && !busyRef.current) setEditingCast(true) },
  }), [detail, cast])
  const branchStorageKey = `retale:roleplay-branch:${props.novelId}:${props.branchId}:${props.sessionId}`
  const lengthStorageKey = `retale:roleplay-length:${props.novelId}:${props.branchId}:${props.sessionId}`
  const { messagesById, childrenByParentId, leaves } = useMemo(() => buildRoleplayMessageTree(detail?.messages ?? []), [detail?.messages])
  const latestMessage = getRoleplayBranchTip(childrenByParentId, messagesById.get(selectedMessageId ?? '') ?? detail?.messages.at(-1)) ?? null
  const activeMessages = useMemo(() => buildMessagePath(messagesById, latestMessage?.id), [messagesById, latestMessage?.id])
  const forkMessage = forkMessageId ? messagesById.get(forkMessageId) ?? null : null
  const visibleMessages = useMemo(() => forkMessage ? buildMessagePath(messagesById, forkMessage.id) : activeMessages, [messagesById, forkMessage, activeMessages])
  const branchOptions = useMemo(() => leaves.map((leaf, index) => {
    const path = buildMessagePath(messagesById, leaf.id)
    const fork = [...path].reverse().find((message) => (childrenByParentId.get(message.parentMessageId)?.length ?? 0) > 1) ?? leaf
    const preview = (fork.turn?.dialogue || fork.turn?.storyGuidance || fork.content).replace(/\s+/g, ' ').slice(0, 36)
    return { id: leaf.id, label: t('roleplay.branchOption', { index: index + 1, text: preview }), deleteCount: getRoleplayBranchDeletionIds(detail?.messages ?? [], leaf.id).length }
  }), [leaves, messagesById, childrenByParentId, detail?.messages, t])

  const refreshDetail = useCallback(async () => {
    const next = await loadRoleplaySessionDetail({ novelId: props.novelId, branchId: props.branchId, sessionId: props.sessionId })
    const normalized = { ...next, messages: next.messages.filter((message) => message.turn || message.script).map(normalizeMessage) }
    setDetail(normalized)
    return normalized
  }, [props.novelId, props.branchId, props.sessionId])

  useEffect(() => {
    let cancelled = false
    void loadRoleplaySessionDetail({ novelId: props.novelId, branchId: props.branchId, sessionId: props.sessionId }).then((next) => {
      if (cancelled) return
      const messages = next.messages.filter((message) => message.turn || message.script).map(normalizeMessage)
      setDetail({ ...next, messages })
      let savedMessageId: string | null = null
      let savedLengths: { story?: number; dialogueOnly?: number } = {}
      try {
        savedMessageId = window.localStorage.getItem(branchStorageKey)
        const parsed = JSON.parse(window.localStorage.getItem(lengthStorageKey) ?? '{}') as unknown
        if (parsed && typeof parsed === 'object') {
          const values = parsed as Record<string, unknown>
          if (typeof values.story === 'number' && Number.isInteger(values.story) && values.story >= 100 && values.story <= 4000) savedLengths.story = values.story
          if (typeof values.dialogueOnly === 'number' && Number.isInteger(values.dialogueOnly) && values.dialogueOnly >= 100 && values.dialogueOnly <= 4000) savedLengths.dialogueOnly = values.dialogueOnly
        }
      } catch { /* Branch and length preferences still work without browser storage. */ }
      if (savedLengths.story !== undefined) setStoryTargetCharacters(savedLengths.story)
      if (savedLengths.dialogueOnly !== undefined) setDialogueOnlyTargetCharacters(savedLengths.dialogueOnly)
      const tree = buildRoleplayMessageTree(messages)
      const selected = getRoleplayBranchTip(tree.childrenByParentId, tree.messagesById.get(savedMessageId ?? '') ?? messages.at(-1))
      setSelectedMessageId(selected?.id ?? null)
      setForkMessageId(null)
      const lastTurn = buildMessagePath(tree.messagesById, selected?.id).reverse().find((message) => message.turn)?.turn
      setDialogueOnly(lastTurn?.dialogueOnly ?? false)
      if (lastTurn) {
        setCast(lastTurn)
        if (lastTurn.dialogueOnly) {
          if (savedLengths.dialogueOnly === undefined) setDialogueOnlyTargetCharacters(lastTurn.maxCharacters)
        } else if (savedLengths.story === undefined) {
          setStoryTargetCharacters(lastTurn.maxCharacters)
        }
        if (lastTurn.generationOptions) setGenerationOptions(lastTurn.generationOptions)
      }
    }).catch((reason) => {
      if (!cancelled) setError(resolveWorkspaceUserFacingError('roleplay-session-load', reason, locale))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controllerRef.current?.abort() }
  }, [props.novelId, props.branchId, props.sessionId, locale, branchStorageKey, lengthStorageKey])

  useEffect(() => {
    if (loading || detail?.id !== props.sessionId) return
    try {
      if (latestMessage) window.localStorage.setItem(branchStorageKey, latestMessage.id)
      else window.localStorage.removeItem(branchStorageKey)
    } catch { /* Saving a view preference must not interrupt the conversation. */ }
  }, [loading, detail?.id, props.sessionId, branchStorageKey, latestMessage])

  useEffect(() => {
    if (loading || detail?.id !== props.sessionId) return
    try {
      window.localStorage.setItem(lengthStorageKey, JSON.stringify({ story: storyTargetCharacters, dialogueOnly: dialogueOnlyTargetCharacters }))
    } catch { /* Saving a preference must not interrupt the conversation. */ }
  }, [loading, detail?.id, props.sessionId, lengthStorageKey, storyTargetCharacters, dialogueOnlyTargetCharacters])

  useEffect(() => {
    const last = visibleMessages.at(-1)
    onMetricsChange?.({ currentText: last?.content ?? '', inputTokens: null, outputTokens: null })
  }, [visibleMessages, onMetricsChange])

  useLayoutEffect(() => {
    const list = messageListRef.current
    if (!list) return
    const target = replyScrollTargetRef.current
    if (target) {
      const reply = target.messageId ? messageElementsRef.current.get(target.messageId) : pendingReplyRef.current
      if (reply) {
        stickToBottomRef.current = false
        list.scrollTop += reply.getBoundingClientRect().top - list.getBoundingClientRect().top - parseFloat(getComputedStyle(list).paddingTop || '0')
        // Saving replaces the pending reply; leaving the busy state also restores
        // branch controls above it. Align once more after that final layout.
        if (!busy && target.messageId) replyScrollTargetRef.current = null
      }
      return
    }
    if (stickToBottomRef.current) list.scrollTop = list.scrollHeight
  }, [visibleMessages, busy, pendingScript])

  useEffect(() => {
    const list = messageListRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (stickToBottomRef.current) list.scrollTop = list.scrollHeight })
    observer.observe(list)
    return () => observer.disconnect()
  }, [loading, detail?.id, cast, editingCast])

  const targetCharacters = dialogueOnly ? dialogueOnlyTargetCharacters : storyTargetCharacters
  const turnInput = { ...cast, storyGuidance, dialogue, maxCharacters: targetCharacters, dialogueOnly, generationOptions }
  const turn = parseRoleplayTurn(turnInput)
  const previewTurn = parseRoleplayTurn(turnInput, { allowEmptyInput: true })
  const mutating = contextCompressing || busy || deletingMessageId !== null || deletingBranchId !== null
  const canSend = Boolean(turn && !mutating)
  const retryUser = latestMessage?.role === 'user' && latestMessage.turn ? latestMessage : null
  const latestAssistant = latestMessage?.role === 'assistant' ? latestMessage : null
  const latestRequest = retryUser ?? (latestAssistant?.parentMessageId ? messagesById.get(latestAssistant.parentMessageId) : null)

  const buildGenerationRequest = (requestTurn: RoleplayTurn, history: RoleplayMessagePayload[]) => detail ? {
      novelId: props.novelId, branchId: props.branchId, chapterId: detail.sourceSnapshot.chapterId,
      selectedText: detail.sourceSnapshot.selectedText || detail.sourceSnapshot.textSnapshot,
      sourceText: detail.sourceSnapshot.textSnapshot || detail.sourceSnapshot.selectedText,
      roleplaySessionId: detail.id, roleplayLeafMessageId: history.at(-1)?.id ?? null,
      operationType: 'roleplay', roleplayTurn: requestTurn, userInstruction: roleplayTurnText(requestTurn),
      ...requestTurn.generationOptions,
      roleplayMessages: history.map((message) => ({ role: message.role, content: message.turn ? roleplayTurnText(message.turn) : message.script ? roleplayScriptText(message.script) : message.content })),
      scope: 'chapter', mode: 'dialogue', tone: 'dramatic',
      presetCompatRuntimeContext: {
        sessionPhase: history.length ? 'continue' : 'new_chat', hasImpersonationContext: true,
        namedTranscript: { kind: 'roleplay', userName: requestTurn.playerName, assistantName: requestTurn.counterpartName },
      },
    } : null

  const generate = async (user: RoleplayMessagePayload, regenerateFrom?: RoleplayMessagePayload) => {
    if (!detail || !user.turn) return
    const history = buildMessagePath(messagesById, user.parentMessageId)
    const controller = new AbortController()
    controllerRef.current = controller
    let content = ''
    await streamRoleplayReply({ ...buildGenerationRequest(user.turn, history), contextSnapshotId: contextSnapshotRef.current }, (chunk) => { content += chunk }, controller.signal)
    if (controller.signal.aborted) return
    const script = readGeneratedRoleplayScript(content, user.turn)
    if (!script) throw new Error(t('roleplay.invalidScript'))
    stickToBottomRef.current = false
    replyScrollTargetRef.current = { messageId: null }
    setPendingScript(script)
    const input = {
      novelId: props.novelId, branchId: props.branchId, sessionId: detail.id,
      content: roleplayScriptText(script), script, parentMessageId: user.id,
      forkedFromMessageId: regenerateFrom?.id ?? user.forkedFromMessageId,
    }
    const reply = regenerateFrom
      ? await createLatestAssistantVariant({ ...input, sourceMessageId: regenerateFrom.id })
      : await appendRoleplayMessage({ ...input, role: 'assistant' })
    replyScrollTargetRef.current = { messageId: reply.id }
    await refreshDetail()
    setSelectedMessageId(reply.id)
    setPendingScript(null)
  }

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(''); stickToBottomRef.current = true; replyScrollTargetRef.current = null
    try { await action() }
    catch (reason) {
      replyScrollTargetRef.current = null
      if (controllerRef.current?.signal.aborted) return
      setError(reason instanceof Error && reason.message === t('roleplay.invalidScript') ? reason.message : resolveWorkspaceUserFacingError('roleplay-stream', reason, locale))
      await refreshDetail().catch(() => undefined)
    } finally { setBusy(false); busyRef.current = false; setPendingScript(null) }
  }

  const handleSend = () => run(async () => {
    if (!detail || !turn) return
    const anchor = forkMessage ?? latestMessage
    const user = normalizeMessage(await appendRoleplayMessage({
      novelId: props.novelId, branchId: props.branchId, sessionId: detail.id,
      role: 'user', turn, content: turn.dialogue || turn.storyGuidance,
      parentMessageId: anchor?.id ?? null, forkedFromMessageId: forkMessage?.id ?? null,
    }))
    setDetail((current) => current ? { ...current, messages: [...current.messages, user] } : current)
    props.onRequestsChange?.()
    setSelectedMessageId(user.id)
    setDialogue(''); setStoryGuidance(''); setForkMessageId(null); setComposerExpanded(false)
    await generate(user)
  })

  const handleRegenerate = () => run(async () => {
    if (latestRequest?.turn) await generate(latestRequest, latestAssistant ?? undefined)
  })

  const handleDelete = async (message: RoleplayMessagePayload) => {
    if (!detail || busyRef.current) return
    busyRef.current = true
    setDeletingMessageId(message.id)
    setError('')
    try {
      const response = await fetch(`/api/roleplay/sessions/${detail.id}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId: props.novelId, branchId: props.branchId, messageId: message.id }),
      })
      const data = await response.json() as { deletedMessageIds: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || 'Failed to delete roleplay request')
      props.onRequestsChange?.()
      const deletedIds = new Set(data.deletedMessageIds)
      if (latestMessage && deletedIds.has(latestMessage.id)) {
        setSelectedMessageId([...activeMessages].reverse().find((item) => !deletedIds.has(item.id))?.id ?? null)
      }
      contextSnapshotRef.current = null
      replyScrollTargetRef.current = null
      setForkMessageId((current) => current && deletedIds.has(current) ? null : current)
      setDetail((current) => current ? {
        ...current,
        messages: current.messages.filter((item) => !deletedIds.has(item.id)).map((item) => {
          const parentMessageId = item.parentMessageId && deletedIds.has(item.parentMessageId) ? message.parentMessageId : item.parentMessageId
          const forkedFromMessageId = item.forkedFromMessageId && deletedIds.has(item.forkedFromMessageId) ? null : item.forkedFromMessageId
          return { ...item, parentMessageId, forkedFromMessageId, forkMetadata: { parentMessageId, forkedFromMessageId } }
        }),
      } : current)
      const refreshed = await refreshDetail()
      const refreshedTree = buildRoleplayMessageTree(refreshed.messages)
      const refreshedSelected = getRoleplayBranchTip(refreshedTree.childrenByParentId, refreshedTree.messagesById.get(selectedMessageId ?? '') ?? refreshed.messages.at(-1))
      const refreshedTurn = buildMessagePath(refreshedTree.messagesById, refreshedSelected?.id).reverse().find((item) => item.turn)?.turn
      setDialogueOnly(refreshedTurn?.dialogueOnly ?? false)
    } catch (reason) {
      setError(resolveWorkspaceUserFacingError('roleplay-delete', reason, locale))
    } finally {
      setDeletingMessageId(null)
      busyRef.current = false
    }
  }

  const handleDeleteBranch = async (messageId: string) => {
    if (!detail || busyRef.current) return
    busyRef.current = true
    setDeletingBranchId(messageId)
    try {
      const response = await fetch(`/api/roleplay/sessions/${detail.id}/messages`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId: props.novelId, branchId: props.branchId, messageId, mode: 'branch' }),
      })
      const data = await response.json() as { deletedMessageIds: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || 'Failed to delete roleplay branch')
      props.onRequestsChange?.()
      const deletedIds = new Set(data.deletedMessageIds)
      const messages = detail.messages.filter((message) => !deletedIds.has(message.id)).map((message) => {
        const forkedFromMessageId = message.forkedFromMessageId && deletedIds.has(message.forkedFromMessageId) ? null : message.forkedFromMessageId
        return { ...message, forkedFromMessageId, forkMetadata: { ...message.forkMetadata, forkedFromMessageId } }
      })
      const tree = buildRoleplayMessageTree(messages)
      const selected = latestMessage && !deletedIds.has(latestMessage.id) ? tree.messagesById.get(latestMessage.id) : tree.leaves.at(-1)
      if (selected?.id !== latestMessage?.id) {
        const lastTurn = buildMessagePath(tree.messagesById, selected?.id).reverse().find((message) => message.turn)?.turn
        setDialogueOnly(lastTurn?.dialogueOnly ?? false)
        if (lastTurn) {
          setCast(lastTurn)
          if (lastTurn.dialogueOnly) setDialogueOnlyTargetCharacters(lastTurn.maxCharacters)
          else setStoryTargetCharacters(lastTurn.maxCharacters)
          setGenerationOptions(lastTurn.generationOptions ?? defaultRoleplayGenerationOptions(createWritingSkillRuntimeSeed()))
        }
        stickToBottomRef.current = true
      }
      setDetail({ ...detail, messages })
      setSelectedMessageId(selected?.id ?? null)
      setForkMessageId((current) => current && deletedIds.has(current) ? null : current)
      contextSnapshotRef.current = null
      replyScrollTargetRef.current = null
      setError('')
    } finally {
      setDeletingBranchId(null)
      busyRef.current = false
    }
  }

  const selectBranch = (messageId: string, scrollToMessage = false) => {
    if (busyRef.current) return
    const selected = getRoleplayBranchTip(childrenByParentId, messagesById.get(messageId))
    if (!selected) return
    const lastTurn = buildMessagePath(messagesById, selected.id).reverse().find((message) => message.turn)?.turn
    setDialogueOnly(lastTurn?.dialogueOnly ?? false)
    if (lastTurn) {
      setCast(lastTurn)
      if (lastTurn.dialogueOnly) setDialogueOnlyTargetCharacters(lastTurn.maxCharacters)
      else setStoryTargetCharacters(lastTurn.maxCharacters)
      setGenerationOptions(lastTurn.generationOptions ?? defaultRoleplayGenerationOptions(createWritingSkillRuntimeSeed()))
    }
    contextSnapshotRef.current = null
    replyScrollTargetRef.current = scrollToMessage ? { messageId } : null
    stickToBottomRef.current = !scrollToMessage
    setSelectedMessageId(selected.id)
    setForkMessageId(null)
    setError('')
  }

  const dialogueOnlyToggle = <label title={t('roleplay.dialogueOnlyHint')} className={cn('flex min-h-8 shrink-0 cursor-pointer items-center gap-2 text-xs', dialogueOnly ? 'text-violet-300' : 'text-zinc-400', mutating && 'cursor-default opacity-40')}>
    <input type="checkbox" checked={dialogueOnly} disabled={mutating} onChange={(event) => { contextSnapshotRef.current = null; setDialogueOnly(event.target.checked) }} className="h-4 w-4 accent-violet-500" />
    {t('roleplay.dialogueOnly')}
  </label>

  return <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="workspace-roleplay-session-view">
    {loading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-400" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{t('roleplay.loading')}</div> : null}
    {error ? <div role="alert" className="shrink-0 whitespace-pre-wrap break-words border-b border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{error}</div> : null}
    {!loading && detail && !cast ? <div className="min-h-0 flex-1 overflow-y-auto"><RoleplayCastPicker initial={cast} options={detail.characterOptions ?? []} onStart={setCast} /></div> : null}
    {!loading && detail && cast ? <section className="flex min-h-0 flex-1 flex-col" data-testid="roleplay-chat-core" aria-label={t('roleplay.sessionMessages')}>
      <div ref={messageListRef} data-testid="roleplay-message-list" onScroll={(event) => { const list = event.currentTarget; stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= ROLEPLAY_STICKY_BOTTOM_THRESHOLD }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          {!detail.messages.length ? <div className="mx-auto max-w-xl py-5" data-testid="roleplay-empty-state">
            <MessageCircle className="mb-4 h-7 w-7 text-violet-300" /><h3 className="text-lg font-medium text-zinc-100">{t('roleplay.emptyTitle')}</h3><p className="mt-2 text-sm leading-7 text-zinc-400">{t(dialogueOnly ? 'roleplay.dialogueOnlyEmptyHint' : 'roleplay.emptyHint')}</p>
            {detail.sourceSnapshot.selectedText ? <blockquote className="mt-5 line-clamp-3 border-l-2 border-violet-400/40 pl-4 text-sm leading-7 text-zinc-400">{detail.sourceSnapshot.selectedText}</blockquote> : null}
          </div> : null}
          {visibleMessages.map((message, index) => <article key={message.id} ref={(element) => { if (element) messageElementsRef.current.set(message.id, element); else messageElementsRef.current.delete(message.id) }} data-testid={`roleplay-message-${message.messageIndex - 1}`} data-roleplay-message-id={message.id} className={cn('min-w-0', forkMessageId === message.id && 'rounded-xl ring-1 ring-violet-400/40')}>
            <RoleplayBranchSwitch messageId={message.id} siblingIds={(childrenByParentId.get(message.parentMessageId) ?? []).map((sibling) => sibling.id)} replyVersions={message.role === 'assistant' && (childrenByParentId.get(message.parentMessageId) ?? []).every((sibling) => sibling.role === 'assistant')} disabled={mutating} onSelect={(id) => selectBranch(id, true)} />
            {message.script ? <RoleplayScriptBlocks script={message.script} /> : message.turn ? <div className="ml-auto max-w-[90%] space-y-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3">
              {message.turn.storyGuidance ? <div><p className="mb-1 text-xs text-zinc-500">{t('roleplay.storyGuidance')}</p><p className="whitespace-pre-wrap break-words text-sm leading-7 text-zinc-400">{message.turn.storyGuidance}</p></div> : null}
              {message.turn.dialogue ? <div><p className="mb-1 text-xs text-violet-300">{message.turn.playerName} · {t('roleplay.you')} → {message.turn.counterpartName}</p><p className="whitespace-pre-wrap break-words text-[15px] leading-8 text-zinc-100">{message.turn.dialogue}</p></div> : null}
            </div> : null}
            {message.turn || index < visibleMessages.length - 1 ? <div className={cn('mt-1 flex flex-wrap items-center gap-1', message.turn && 'justify-end')}>
              {index < visibleMessages.length - 1 ? <button type="button" disabled={mutating} aria-label={t('roleplay.forkFrom', { index: message.messageIndex })} aria-pressed={forkMessageId === message.id} onClick={() => { contextSnapshotRef.current = null; replyScrollTargetRef.current = null; stickToBottomRef.current = true; setForkMessageId(message.id); composerRef.current?.focus({ preventScroll: true }) }} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:bg-overlay/5 disabled:opacity-40"><GitBranch className="h-3.5 w-3.5" />{t('roleplay.forkAction')}</button> : null}
              {!forkMessage && message.turn && message.id === latestRequest?.id ? <button type="button" data-testid="roleplay-regenerate-last" disabled={mutating} onClick={() => void handleRegenerate()} aria-label={t(retryUser ? 'roleplay.retry' : 'roleplay.regenerateLatest')} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:bg-overlay/5 hover:text-violet-300 disabled:opacity-40"><RefreshCcw className="h-3.5 w-3.5" />{t(retryUser ? 'roleplay.retry' : 'roleplay.regenerateLatest')}</button> : null}
              {message.turn ? <button type="button" data-testid={`roleplay-delete-${message.id}`} disabled={mutating} onClick={() => void handleDelete(message)} aria-label={t('roleplay.deleteRequest', { index: message.messageIndex })} title={t('roleplay.deleteRequestHint')} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40">{deletingMessageId === message.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{t('roleplay.delete')}</button> : null}
            </div> : null}
          </article>)}
          {busy ? <div ref={pendingReplyRef} data-testid="roleplay-pending-reply" aria-live="polite" aria-busy="true">{pendingScript ? <RoleplayScriptBlocks script={pendingScript} /> : <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />{t('roleplay.pendingReply')}</p>}</div> : null}
        </div>
      </div>
      <form data-testid="roleplay-composer" data-expanded={composerExpanded} onSubmit={(event) => { event.preventDefault(); if (canSend) void handleSend() }} className="shrink-0 border-t border-line/8 bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-3">
        <div className="mx-auto max-w-3xl">
          {forkMessage ? <div className="mb-2 flex items-center gap-2 text-xs text-violet-300" data-testid="roleplay-fork-point-visual-state"><GitBranch className="h-3.5 w-3.5" /><span data-testid="roleplay-fork-anchor">{t('roleplay.nextForkFrom', { index: forkMessage.messageIndex })}</span><button type="button" disabled={mutating} onClick={() => { contextSnapshotRef.current = null; setForkMessageId(null) }} aria-label={t('roleplay.cancelFork')} className="ml-auto inline-flex h-8 w-8 items-center justify-center"><X className="h-4 w-4" /></button></div> : null}
          <div className={cn('rounded-2xl border border-line/10 bg-inset px-3 py-2 focus-within:border-violet-400/40', composerExpanded && 'sm:p-3')}>
            <div className={cn(composerExpanded ? 'sm:grid sm:grid-cols-2 sm:gap-3' : 'flex items-center gap-3')}>
              {composerExpanded ? <label className="block text-xs text-zinc-500">{t('roleplay.storyGuidance')}<textarea value={storyGuidance} onChange={(event) => setStoryGuidance(event.target.value)} rows={1} maxLength={10000} placeholder={t('roleplay.storyGuidancePlaceholder')} className="mt-1 block max-h-24 min-h-6 w-full resize-y bg-transparent text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-500 sm:min-h-8" /></label> : null}
              <label className={cn('block min-w-0 flex-1 text-xs text-violet-300', composerExpanded && 'mt-2 border-t border-line/8 pt-2 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0')}>
                {composerExpanded ? t('roleplay.dialogueTo', { name: cast.counterpartName }) : null}
                <textarea ref={composerRef} aria-label={t('roleplay.composerLabel')} value={dialogue} onFocus={() => setComposerExpanded(true)} onClick={() => setComposerExpanded(true)} onChange={(event) => setDialogue(event.target.value)} rows={composerExpanded ? 2 : 1} maxLength={10000} placeholder={t(composerExpanded ? 'roleplay.composerPlaceholder' : storyGuidance.trim() ? 'roleplay.composerWithGuidance' : 'roleplay.composerCollapsedPlaceholder')} onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (canSend) void handleSend() } }} className={cn('block max-h-28 min-h-6 w-full bg-transparent text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500', composerExpanded ? 'mt-1 min-h-12 resize-y' : 'resize-none')} />
              </label>
              {!composerExpanded ? dialogueOnlyToggle : null}
            </div>
            {composerExpanded ? <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line/8 pt-2">
              {dialogueOnlyToggle}
              <label className="flex items-center gap-2 text-xs text-zinc-500">{t('roleplay.lengthTarget')}<input type="number" min={100} max={4000} step={100} aria-label={t('roleplay.lengthTarget')} value={Number.isNaN(targetCharacters) ? '' : targetCharacters} onChange={(event) => { const value = event.target.valueAsNumber; if (dialogueOnly) setDialogueOnlyTargetCharacters(value); else setStoryTargetCharacters(value) }} className="min-h-8 w-20 rounded-lg border border-line/10 bg-inset px-2 text-sm text-zinc-200" /><span>{t('roleplay.characters')}</span></label>
            </div> : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2" data-testid="roleplay-composer-actions">
            <div className="flex min-w-0 items-center gap-1">
              {leaves.length ? <RoleplayBranchMenu branches={branchOptions} selectedId={latestMessage?.id ?? null} disabled={mutating} onSelect={selectBranch} onDelete={handleDeleteBranch} /> : null}
              <button type="button" disabled={mutating} onClick={() => setGenerationPanel('context')} aria-label={t('workspace.shell.advancedContext')} title={t('workspace.shell.advancedContext')} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 hover:text-zinc-100 disabled:opacity-40"><SlidersHorizontal className="h-4 w-4" /></button>
              <button type="button" disabled={mutating} onClick={() => setGenerationPanel('skills')} aria-label={`${t('roleplay.writingSkills')}${generationOptions.writingSkillCardIds.length ? ` · ${generationOptions.writingSkillCardIds.length}` : ''}`} title={t('roleplay.writingSkills')} className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-overlay/5 hover:text-zinc-100 disabled:opacity-40', generationOptions.writingSkillCardIds.length ? 'text-violet-300' : 'text-zinc-400')}><Wand2 className="h-4 w-4" /></button>
              {composerExpanded ? <button type="button" onClick={() => setComposerExpanded(false)} aria-label={t('roleplay.collapseComposer')} title={t('roleplay.collapseComposer')} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 hover:text-zinc-100"><ChevronDown className="h-4 w-4" /></button> : null}
            </div>
            <button type="submit" data-testid="roleplay-composer-send" disabled={!canSend} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}{t(dialogueOnly ? 'roleplay.sendDialogue' : 'roleplay.send')}</button>
          </div>
        </div>
      </form>
    </section> : null}
    <RoleplayGenerationPanel disabled={mutating} onBusyChange={setContextCompressing} panel={generationPanel} request={previewTurn ? buildGenerationRequest(previewTurn, buildMessagePath(messagesById, (forkMessage ?? latestMessage)?.id)) : null} options={generationOptions} onChange={setGenerationOptions} onClose={() => setGenerationPanel(null)} onSnapshot={handleContextSnapshot} />
    <DialogSurface open={editingCast && Boolean(cast)} onClose={() => setEditingCast(false)} closeLabel={t('roleplay.closeCast')} title={t('roleplay.chooseCast')} description={t('roleplay.chooseCastHint')} placement="center">
      {detail ? <RoleplayCastPicker hideHeading initial={cast} options={detail.characterOptions ?? []} onStart={(next) => { contextSnapshotRef.current = null; setCast(next); setEditingCast(false) }} /> : null}
    </DialogSurface>
  </div>
}
