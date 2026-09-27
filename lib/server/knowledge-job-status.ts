import { waitForCondition } from '@/lib/server/async-control'

type KnowledgeJobSnapshot = {
  status: string
  errorMessage: string | null
}

export async function waitForKnowledgeJobCompletionStatus(params: {
  jobId: string
  timeoutMs?: number
  pollMs?: number
  loadJob: (jobId: string) => Promise<KnowledgeJobSnapshot | null> | KnowledgeJobSnapshot | null
  onTimeout: (jobId: string) => Promise<void> | void
}) {
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000
  const pollMs = params.pollMs ?? 1000
  const result = await waitForCondition({
    timeoutMs,
    pollMs,
    check: () => params.loadJob(params.jobId),
    isDone: (job) => job === null || ['succeeded', 'failed', 'paused', 'aborted'].includes(job.status),
  })

  if (result.timedOut) {
    await params.onTimeout(params.jobId)
    throw new Error('Knowledge rebuild timed out')
  }

  const job = result.value
  if (!job) {
    throw new Error('Knowledge job not found')
  }

  if (job.status === 'failed') {
    throw new Error(job.errorMessage || 'Knowledge rebuild failed')
  }
}

export async function abortKnowledgeRebuildUntilIdle(params: {
  novelId: string
  branchId: string
  abortAttempt: () => Promise<string>
  timeoutMs?: number
  pollMs?: number
}) {
  const timeoutMs = params.timeoutMs ?? 15_000
  const pollMs = params.pollMs ?? 25
  const result = await waitForCondition({
    timeoutMs,
    pollMs,
    check: params.abortAttempt,
    isDone: (status) => status === 'idle',
  })

  if (result.timedOut) {
    throw new Error(`Timed out waiting for knowledge rebuild to become idle for ${params.novelId} (${params.branchId})`)
  }
}
