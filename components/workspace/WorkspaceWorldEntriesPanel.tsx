"use client"

import { Pencil, Plus, Trash2 } from 'lucide-react'
import { WORLD_TYPE_LABELS } from '@/components/workspace/selection-novel-studio-helpers'
import { useI18n } from '@/lib/i18n/provider'
import type { WorkspaceRefTab } from '@/components/workspace/use-workspace-pane-state'
import { useNovelStore } from '@/store/novel-store'
import type { WorldEntryType } from '@/lib/types'

type WorldEntry = ReturnType<typeof useNovelStore.getState>['localWorldEntries'][number]

type EditState = {
  type: 'char' | 'outline' | 'world' | 'relation' | 'timeline' | null
  id: string | null
  form: Record<string, string>
}

type Props = {
  refTab: WorkspaceRefTab
  tab: WorkspaceRefTab
  entries: WorldEntry[]
  emptyMessage: string
  addLabel: string
  defaultType: WorldEntryType
  currentNovelId: string
  editState: EditState
  setEditState: React.Dispatch<React.SetStateAction<EditState>>
  knowledgePanelReadOnly: boolean
}

export function WorkspaceWorldEntriesPanel({ refTab, tab, entries, emptyMessage, addLabel, defaultType, currentNovelId, editState, setEditState, knowledgePanelReadOnly }: Props) {
  const { t } = useI18n()
  if (refTab !== tab) return null

  return (
    <>
      {entries.length === 0 && <p className="text-xs text-zinc-500 text-center py-4">{emptyMessage}</p>}
      {entries.map((entry) => {
        const isEditing = editState.type === 'world' && editState.id === entry.id
        const ef = editState.form
        const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
        return (
          <div key={entry.id} className="rounded-2xl border border-line/8 bg-shade/20 p-3">
            {isEditing ? (
              <>
                <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.titlePlaceholder')} />
                <select value={ef.type ?? entry.type} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none">
                  <option value="location">{WORLD_TYPE_LABELS.location}</option>
                  <option value="scene">{WORLD_TYPE_LABELS.scene}</option>
                  <option value="organization">{WORLD_TYPE_LABELS.organization}</option>
                  <option value="rule">{WORLD_TYPE_LABELS.rule}</option>
                  <option value="item">{WORLD_TYPE_LABELS.item}</option>
                  <option value="history">{WORLD_TYPE_LABELS.history}</option>
                </select>
                <textarea value={ef.content ?? ''} onChange={(e) => setF('content', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.summaryPlaceholder')} />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => {
                    useNovelStore.getState().updateWorldEntry(entry.id, { title: ef.title ?? '', type: (ef.type ?? entry.type) as WorldEntryType, content: ef.content ?? '' })
                    setEditState({ type: null, id: null, form: {} })
                  }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.save')}</button>
                  <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-line/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">{entry.title}</p>
                    <span className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-500">{WORLD_TYPE_LABELS[entry.type]}</span>
                  </div>
                  {!knowledgePanelReadOnly ? (
                    <div className="flex gap-1">
                      <button onClick={() => setEditState({ type: 'world', id: entry.id, form: { title: entry.title, type: entry.type, content: entry.content } })} className="rounded-lg border border-line/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                      <button onClick={() => { useNovelStore.getState().deleteWorldEntry(entry.id) }} className="rounded-lg border border-line/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  ) : null}
                </div>
                <p className="text-xs leading-6 text-zinc-400 line-clamp-3">{entry.content}</p>
              </>
            )}
          </div>
        )
      })}
      {!knowledgePanelReadOnly ? <button onClick={() => setEditState({ type: 'world', id: '__new__', form: { title: '', type: defaultType, content: '' } })} className="w-full rounded-2xl border border-dashed border-line/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-overlay/[0.04]"><Plus className="h-3.5 w-3.5 inline mr-1" /> {addLabel}</button> : null}
      {!knowledgePanelReadOnly && editState.type === 'world' && editState.id === '__new__' && (
        <div className="rounded-2xl border border-line/8 bg-shade/20 p-3">
          <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.titlePlaceholder')} />
          <select value={editState.form.type ?? defaultType} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none">
            <option value="location">{WORLD_TYPE_LABELS.location}</option>
            <option value="scene">{WORLD_TYPE_LABELS.scene}</option>
            <option value="organization">{WORLD_TYPE_LABELS.organization}</option>
            <option value="rule">{WORLD_TYPE_LABELS.rule}</option>
            <option value="item">{WORLD_TYPE_LABELS.item}</option>
            <option value="history">{WORLD_TYPE_LABELS.history}</option>
          </select>
          <textarea value={editState.form.content ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, content: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.summaryPlaceholder')} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => {
              useNovelStore.getState().addWorldEntry(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? defaultType) as WorldEntryType, content: editState.form.content ?? '' })
              setEditState({ type: null, id: null, form: {} })
            }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.create')}</button>
            <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-line/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
          </div>
        </div>
      )}
    </>
  )
}
