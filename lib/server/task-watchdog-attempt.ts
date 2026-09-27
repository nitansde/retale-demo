import { safeParseJsonObject } from '@/lib/server/json-parse'
import { uid } from '@/lib/utils'

export type TaskWatchdogPayload = Record<string, unknown> & {
  taskWatchdog?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseTaskWatchdogPayload(payloadJson: string | null) {
  return (safeParseJsonObject(payloadJson) ?? {}) as TaskWatchdogPayload
}

export function getTaskWatchdogState(payload: unknown) {
  if (!isRecord(payload)) {
    return {} as Record<string, unknown>
  }

  return isRecord(payload.taskWatchdog) ? payload.taskWatchdog : {}
}

export function getTaskWatchdogAttemptId(payload: unknown) {
  const attemptId = getTaskWatchdogState(payload).attemptId
  return typeof attemptId === 'string' && attemptId.trim() ? attemptId.trim() : null
}

export function createTaskWatchdogAttemptId() {
  return uid('task-attempt')
}

export function mergeTaskWatchdogState<T extends Record<string, unknown>>(
  payload: T,
  taskWatchdogUpdates: Record<string, unknown>,
) {
  return {
    ...payload,
    taskWatchdog: {
      ...getTaskWatchdogState(payload),
      ...taskWatchdogUpdates,
    },
  } satisfies T & TaskWatchdogPayload
}

export function parseTaskWatchdogPayloadAttemptId(payloadJson: string | null) {
  return getTaskWatchdogAttemptId(parseTaskWatchdogPayload(payloadJson))
}
