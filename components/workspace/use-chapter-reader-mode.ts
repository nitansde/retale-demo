'use client'

import { useLayoutEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

export function useChapterReaderMode(editor: Editor | null, scope: string | null, save: () => Promise<boolean>) {
  const [mode, setMode] = useState({ scope, isEditing: false, isSaving: false })

  // A new chapter or a different view always starts in reading mode.
  if (mode.scope !== scope) setMode({ scope, isEditing: false, isSaving: false })
  const isEditing = mode.scope === scope && mode.isEditing
  const isSaving = mode.scope === scope && mode.isSaving

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return
    // Switching modes must not emit a document update or trigger an autosave.
    editor.setEditable(isEditing && !isSaving, false)
  }, [editor, isEditing, isSaving])

  function startEditing() {
    if (!scope || !editor || editor.isDestroyed || isSaving) return
    editor.setEditable(true, false)
    setMode({ scope, isEditing: true, isSaving: false })
    editor.commands.focus('start', { scrollIntoView: false })
  }

  async function finishEditing() {
    if (!isEditing || isSaving) return
    const pending = { ...mode, isSaving: true }
    setMode(pending)
    const saved = await save().catch(() => false)
    // A completed save must not change the mode of a newly opened chapter.
    setMode((current) => current === pending
      ? { ...pending, isEditing: !saved, isSaving: false }
      : current)
  }

  return { isEditing, isSaving, startEditing, finishEditing }
}
