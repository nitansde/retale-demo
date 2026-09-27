"use client"

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export function RoleplayBranchSwitch(props: {
  messageId: string
  siblingIds: string[]
  replyVersions: boolean
  disabled: boolean
  onSelect: (messageId: string) => void
}) {
  const { t } = useI18n()
  if (props.siblingIds.length < 2) return null
  const index = props.siblingIds.indexOf(props.messageId)
  const label = t(props.replyVersions ? 'roleplay.replyVersions' : 'roleplay.branchChoices')
  return <nav aria-label={label} data-testid={`roleplay-branch-switch-${props.messageId}`} className="mb-2 flex items-center gap-1 text-xs text-zinc-400">
    <button type="button" disabled={props.disabled || index <= 0} onClick={() => props.onSelect(props.siblingIds[index - 1])} aria-label={t('roleplay.previousBranchChoice', { label })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-overlay/5 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
    <span aria-live="polite">{label} {index + 1} / {props.siblingIds.length}</span>
    <button type="button" disabled={props.disabled || index >= props.siblingIds.length - 1} onClick={() => props.onSelect(props.siblingIds[index + 1])} aria-label={t('roleplay.nextBranchChoice', { label })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-overlay/5 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
  </nav>
}
