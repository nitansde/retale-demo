"use client"

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useI18n } from '@/lib/i18n/provider'
import { toUserFacingError } from '@/lib/workspace-user-facing-errors'

export function TaskAbortButton({ jobId, novelId, onAborted }: {
  jobId: string
  novelId: string
  onAborted?: () => void
}) {
  const { locale, t } = useI18n()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleAbort = () => {
    setErrorMessage(null)

    startTransition(async () => {
      try {
        const response = await fetch('/api/task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jobId, novelId }),
        })

        const payload = (await response.json().catch(() => null)) as { error?: string } | null

        if (!response.ok) {
          throw new Error(payload?.error ?? t('task.abortFailed'))
        }

        onAborted?.()
        router.refresh()
      } catch (error) {
        const fallback = t('task.abortFailed')
        setErrorMessage(toUserFacingError(error instanceof Error ? error.message : fallback, locale))
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-2 lg:min-w-56 lg:items-end">
      <button
        type="button"
        onClick={handleAbort}
        disabled={isPending}
        className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? t('task.aborting') : t('task.abort')}
      </button>

      {errorMessage ? <p className="text-xs text-rose-200">{errorMessage}</p> : null}
    </div>
  )
}
