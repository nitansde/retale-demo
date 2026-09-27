"use client"

import { useEffect, useRef } from 'react'
import { DialogSurface } from '@/components/ui/DialogSurface'

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
}) {
  const confirmAttemptedRef = useRef(false)

  useEffect(() => {
    if (!open || !busy) confirmAttemptedRef.current = false
  }, [busy, open])

  function handleConfirm() {
    if (busy || confirmAttemptedRef.current) return
    confirmAttemptedRef.current = true
    onConfirm()
  }

  return (
    <DialogSurface open={open} onClose={onClose} title={title} description={description} closeDisabled={busy} busy={busy}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => {
            if (!busy) onClose()
          }}
          disabled={busy}
          className="min-h-11 rounded-xl border border-line/10 bg-overlay/[0.04] px-4 text-sm text-zinc-300 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          className="min-h-11 rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 text-sm font-medium text-rose-50 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </DialogSurface>
  )
}
