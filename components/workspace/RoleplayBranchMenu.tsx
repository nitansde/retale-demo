"use client"

import { useState } from 'react'
import { Check, GitBranch, LoaderCircle, Trash2 } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { cn } from '@/lib/utils'

type BranchOption = { id: string; label: string; deleteCount: number }

export function RoleplayBranchMenu({ branches, selectedId, disabled, onSelect, onDelete }: {
  branches: BranchOption[]
  selectedId: string | null
  disabled: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
}) {
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<BranchOption | null>(null)
  const [error, setError] = useState('')
  const close = () => { setOpen(false); setTarget(null); setError('') }
  const confirmDelete = async () => {
    if (!target || disabled) return
    setError('')
    try {
      await onDelete(target.id)
      setTarget(null)
    } catch (reason) {
      setError(resolveWorkspaceUserFacingError('roleplay-branch-delete', reason, locale))
    }
  }

  return <>
    <button type="button" disabled={disabled} onClick={() => setOpen(true)} aria-label={t('roleplay.currentBranch')} aria-haspopup="dialog" aria-expanded={open} title={t('roleplay.currentBranch')} data-testid="roleplay-branch-picker" data-selected-branch={selectedId ?? ''} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-violet-300 hover:bg-overlay/5 focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:opacity-40">
      <GitBranch className="h-4 w-4" aria-hidden="true" />
    </button>
    <DialogSurface open={open} onClose={close} closeDisabled={disabled} closeLabel={t('common.close')} title={t(target ? 'roleplay.deleteBranchTitle' : 'roleplay.currentBranch')} className="max-w-md">
      {target ? <div className="space-y-4">
        <p className="break-words text-sm text-zinc-200">{target.label}</p>
        <p className="text-sm leading-7 text-zinc-400">{t('roleplay.deleteBranchHint', { count: target.deleteCount })}</p>
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={disabled} onClick={() => { setTarget(null); setError('') }} className="min-h-11 rounded-xl px-4 text-sm text-zinc-300 disabled:opacity-40">{t('workspace.shell.cancel')}</button>
          <button type="button" disabled={disabled} onClick={() => void confirmDelete()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-500 px-4 text-sm text-white disabled:opacity-40">{disabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{t('roleplay.confirmDeleteBranch')}</button>
        </div>
      </div> : <div className="space-y-1">
        {branches.map((branch, index) => <div key={branch.id} className={cn('flex items-center gap-1 rounded-xl', branch.id === selectedId ? 'bg-violet-500/10' : 'hover:bg-overlay/5')}>
          <button type="button" disabled={disabled} aria-pressed={branch.id === selectedId} data-testid={`roleplay-select-branch-${branch.id}`} onClick={() => { onSelect(branch.id); close() }} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 disabled:opacity-40">
            <span className="min-w-0 flex-1 break-words">{branch.label}</span>
            {branch.id === selectedId ? <Check className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" /> : null}
          </button>
          <button type="button" disabled={disabled || !branch.deleteCount} aria-label={t('roleplay.deleteBranch', { index: index + 1 })} title={t('roleplay.deleteBranch', { index: index + 1 })} onClick={() => setTarget(branch)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>)}
      </div>}
    </DialogSurface>
  </>
}
