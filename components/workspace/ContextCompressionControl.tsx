'use client'

import { useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, FileText, LoaderCircle } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { CONTEXT_WARNING_TOKENS, estimateCompressionSavings, estimateSavedCompressionTokens, type ContextCompressionPreview } from '@/lib/context-compression'
import { redactUserFacingDiagnostic } from '@/lib/workspace-user-facing-errors'

function CompressionHistoryStatus({ preview }: { preview: ContextCompressionPreview }) {
  const { t, locale } = useI18n()
  const range = (start: number, end: number) => start === end ? t('compression.singleChapter', { count: start }) : t('compression.chapterRange', { start, end })
  return <div className="space-y-2" data-testid="compression-history-status">
    <p className="text-sm leading-6 text-zinc-300">{t('compression.count', { total: preview.totalChapters, count: preview.compressedChapters, remaining: preview.totalChapters - preview.compressedChapters })}</p>
    {preview.compressedChapters > 0 ? <p data-testid="compression-saved-tokens" className="text-xs text-emerald-300">{t('compression.savedTokens', { count: estimateSavedCompressionTokens(preview).toLocaleString(locale) })}</p> : null}
    {preview.compressedChapters > 0 ? <details className="group rounded-xl border border-violet-400/20 bg-violet-500/5 p-3">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm text-violet-200 [&::-webkit-details-marker]:hidden"><Archive aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{t('compression.compressedRange', { range: range(1, preview.compressedChapters) })}<span className="mt-1 block text-xs text-zinc-400">{t('compression.summary')}</span></span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
      <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{preview.summary}</p>
    </details> : null}
    {preview.compressedChapters < preview.totalChapters ? <p className="flex items-center gap-2 rounded-xl border border-line/10 p-3 text-sm text-zinc-300"><FileText aria-hidden="true" className="h-4 w-4 shrink-0" />{t('compression.fullTextRange', { range: range(preview.compressedChapters + 1, preview.totalChapters) })}</p> : <p className="text-xs leading-6 text-zinc-400">{t('compression.allCompressed')}</p>}
  </div>
}

export function ContextCompressionWarning({ preview, tokenEstimate }: {
  preview?: ContextCompressionPreview | null
  tokenEstimate?: number | null
}) {
  const { t } = useI18n()
  if ((tokenEstimate ?? 0) <= CONTEXT_WARNING_TOKENS) return null
  return <p role="alert" className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm leading-6 text-amber-200">
    {t('compression.warning', { count: Math.round(tokenEstimate ?? 0).toLocaleString() })}{' '}
    {preview?.totalChapters ? t(preview.compressedChapters >= preview.totalChapters ? 'compression.warningAllCompressed' : 'compression.warningAction') : t('compression.noHistory')}
  </p>
}

export function ContextCompressionControl({ preview, disabled, onContextChanged, onBusyChange }: {
  preview?: ContextCompressionPreview | null
  disabled?: boolean
  onContextChanged: () => void | Promise<void>
  onBusyChange?: (busy: boolean) => void
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(1)
  const [operation, setOperation] = useState<'compress' | 'expand' | null>(null)
  const busy = operation !== null
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [current, setCurrent] = useState<ContextCompressionPreview | null>(null)
  // Show the saved state immediately while the parent refreshes its full prompt.
  // A new preview (including a different branch) supersedes this local response.
  const [saved, setSaved] = useState<{ source: ContextCompressionPreview; data: ContextCompressionPreview } | null>(null)
  const activePreview = saved && saved.source === preview ? saved.data : preview
  const history = open ? current ?? activePreview : activePreview
  const remaining = (history?.totalChapters ?? 0) - (history?.compressedChapters ?? 0)
  const compressed = history?.compressedChapters ?? 0
  const targetCount = compressed + count
  const validCount = Boolean(history && Number.isInteger(count) && count >= 1 && count <= remaining)
  const dialogTitle = t(compressed > 0 ? 'compression.continueTitle' : 'compression.title')
  const savings = history && validCount ? estimateCompressionSavings(history, count) : null

  const show = () => {
    setCurrent(activePreview ?? null)
    setCount(Math.max(1, Math.ceil(((activePreview?.totalChapters ?? 0) - (activePreview?.compressedChapters ?? 0)) / 2)))
    setError(''); setSuccess(''); setOpen(true)
  }
  const updateContext = async (action: 'compress' | 'expand') => {
    if (!history || busy || disabled || (action === 'compress' ? !validCount : history.compressedChapters <= 0)) return
    const failureKey = action === 'compress' ? 'compression.failed' : 'compression.expandFailed'
    setOperation(action); onBusyChange?.(true); setError(''); setSuccess('')
    try {
      const response = await fetch('/api/context/compress', {
        method: action === 'compress' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: history.scope, fingerprint: history.fingerprint, ...(action === 'compress' ? { count: targetCount } : {}) }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || t(failureKey))
      setCurrent(data.compression)
      if (preview) setSaved({ source: preview, data: data.compression })
      setOpen(false)
      await onContextChanged()
      setSuccess(action === 'expand' ? t('compression.expanded', { count: compressed }) : t(compressed > 0 ? 'compression.successMore' : 'compression.success', { count: targetCount, added: count }))
    } catch (reason) {
      setError(reason instanceof Error ? redactUserFacingDiagnostic(reason.message) || t(failureKey) : t(failureKey))
    } finally { setOperation(null); onBusyChange?.(false) }
  }

  if (!activePreview?.totalChapters) return null
  const allCompressed = activePreview.compressedChapters === activePreview.totalChapters
  return <div className="space-y-2" data-testid="context-compression-control">
    <CompressionHistoryStatus preview={activePreview} />
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={show} disabled={disabled || busy || allCompressed} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-400/25 px-3 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"><Archive className="h-4 w-4 shrink-0" />{t(allCompressed ? 'compression.complete' : activePreview.compressedChapters > 0 ? 'compression.continueTitle' : 'compression.title')}</button>
      {activePreview.compressedChapters > 0 ? <button type="button" onClick={() => void updateContext('expand')} disabled={disabled || busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/15 px-3 text-sm text-zinc-200 hover:bg-overlay/5 disabled:opacity-50">{operation === 'expand' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}{t(operation === 'expand' ? 'compression.expanding' : 'compression.expand')}</button> : null}
    </div>
    {activePreview.compressedChapters > 0 ? <p className="text-xs leading-6 text-zinc-400">{t('compression.expandHint', { count: activePreview.compressedChapters })}</p> : null}
    {success ? <p role="status" className="text-xs text-emerald-300">{success}</p> : null}
    {!open && error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    <DialogSurface open={open} onClose={() => setOpen(false)} closeDisabled={busy} busy={busy} closeLabel={t('common.close')} title={dialogTitle} description={t('compression.description')} backdropClassName="z-[80] bg-scrim/65" footer={<button type="button" onClick={() => void updateContext('compress')} disabled={busy || disabled || !validCount || remaining <= 0} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-sm text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}{t(busy ? 'compression.pending' : compressed > 0 ? 'compression.confirmMore' : 'compression.confirm')}</button>}>
      {history ? <div className="mb-5"><CompressionHistoryStatus preview={history} /></div> : null}
      {remaining > 0 ? <>
        <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-3 text-sm text-zinc-200">{t(compressed > 0 ? 'compression.rangeMore' : 'compression.range')}<input type="number" aria-label={t(compressed > 0 ? 'compression.rangeMore' : 'compression.range')} min={1} max={remaining} step={1} value={Number.isNaN(count) ? '' : count} disabled={busy} onChange={(event) => setCount(event.target.valueAsNumber)} className="min-h-11 w-20 rounded-lg border border-line/15 bg-inset px-3" />{t('compression.chapters')}</label>
          {remaining > 1 ? <button type="button" onClick={() => setCount(remaining)} disabled={busy} className="min-h-11 px-1 text-xs text-violet-200 underline decoration-violet-400/40 underline-offset-4 disabled:opacity-50">{t('compression.selectRemaining', { count: remaining })}</button> : null}
        </div>
        <p className="mt-2 text-xs leading-6 text-zinc-400">{t('compression.startFrom', { count: compressed + 1 })}</p>
        {validCount ? <div data-testid="compression-selection" className="mt-3 space-y-2 rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 text-sm leading-6 text-zinc-300">
          <p>{t('compression.selectedRange', { range: count === 1 ? t('compression.singleChapter', { count: targetCount }) : t('compression.chapterRange', { start: compressed + 1, end: targetCount }), count })}</p>
          <p className="break-words text-xs text-zinc-400">{history?.chapters[compressed]?.label}{count > 1 ? ` → ${history?.chapters[targetCount - 1]?.label}` : ''}</p>
          {compressed > 0 ? <p className="text-xs text-zinc-400">{t('compression.mergeHint', { count: compressed })}</p> : null}
          <p className="text-xs">{t('compression.selection', { count: targetCount, remaining: remaining - count })}</p>
          {savings ? <div data-testid="compression-estimated-savings" aria-live="polite" className="space-y-1 border-t border-violet-400/15 pt-2">
            <p className="font-medium text-emerald-300">{t('compression.estimatedSavings', { count: savings.savedTokens.toLocaleString(locale) })}</p>
            <p className="text-xs text-zinc-400">{t('compression.tokenComparison', { before: savings.beforeTokens.toLocaleString(locale), after: savings.summaryTokens.toLocaleString(locale) })}</p>
            <p className="text-xs text-zinc-500">{t('compression.estimateHint')}</p>
          </div> : null}
        </div> : null}
      </> : <p className="text-sm text-zinc-400">{t('compression.allCompressed')}</p>}
      {busy ? <p role="status" className="mt-3 text-sm text-zinc-400">{t('compression.pendingHint')}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
    </DialogSurface>
  </div>
}
