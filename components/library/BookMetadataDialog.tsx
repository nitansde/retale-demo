"use client"

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import type { LibrarySummary } from '@/store/novel-store-types'

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_COVER_BYTES = 5 * 1024 * 1024

export function BookMetadataDialog({
  novel,
  onClose,
  onSaved,
}: {
  novel: LibrarySummary
  onClose: () => void
  onSaved: (title: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState(novel.title)
  const [author, setAuthor] = useState(novel.author ?? '')
  const [coverSelection, setCoverSelection] = useState<{ file: File; previewUrl: string } | null>(null)
  const [removeCover, setRemoveCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (coverSelection) URL.revokeObjectURL(coverSelection.previewUrl)
    }
  }, [coverSelection])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError(t('library.metadataTitleRequired'))
      return
    }

    const body = new FormData()
    body.set('title', cleanTitle)
    body.set('author', author.trim())
    body.set('removeCover', removeCover ? '1' : '0')
    if (coverSelection) body.set('cover', coverSelection.file)

    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/novels/${encodeURIComponent(novel.id)}`, { method: 'PATCH', body })
      if (!response.ok) throw new Error('metadata update failed')
      await onSaved(cleanTitle)
    } catch {
      setError(t('library.metadataSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const displayedCover = coverSelection?.previewUrl || (!removeCover ? novel.coverImage ?? '' : '')

  return (
    <DialogSurface
      open
      onClose={onClose}
      title={t('library.metadataTitle')}
      description={t('library.metadataDescription')}
      closeLabel={t('library.metadataClose')}
      closeDisabled={saving}
      busy={saving}
      initialFocusRef={titleInputRef}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
          <div>
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line/10 bg-overlay/[0.04]">
              {displayedCover ? (
                <Image src={displayedCover} alt={t('library.metadataCoverPreview', { title: title || novel.title })} fill unoptimized sizes="140px" className="object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                  <ImagePlus className="h-7 w-7" aria-hidden="true" />
                  {t('library.metadataNoCover')}
                </div>
              )}
            </div>
            <label className="mt-3 block cursor-pointer rounded-xl border border-indigo-300/20 bg-indigo-500/10 px-3 py-2 text-center text-xs text-indigo-100">
              {displayedCover ? t('library.metadataReplaceCover') : t('library.metadataChooseCover')}
              <input
                type="file"
                accept={COVER_TYPES.join(',')}
                disabled={saving}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  if (!COVER_TYPES.includes(file.type)) {
                    setError(t('library.metadataCoverInvalidType'))
                    return
                  }
                  if (file.size > MAX_COVER_BYTES) {
                    setError(t('library.metadataCoverTooLarge'))
                    return
                  }
                  setCoverSelection({ file, previewUrl: URL.createObjectURL(file) })
                  setRemoveCover(false)
                  setError('')
                }}
              />
            </label>
            {displayedCover ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setCoverSelection(null)
                  setRemoveCover(true)
                }}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('library.metadataRemoveCover')}
              </button>
            ) : null}
          </div>

          <div className="space-y-4">
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block">{t('library.metadataTitleLabel')}</span>
              <input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={saving} className="min-h-11 w-full rounded-xl border border-line/10 bg-shade/25 px-3 outline-none focus:border-indigo-300/45" />
            </label>
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block">{t('library.metadataAuthorLabel')}</span>
              <input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={200} disabled={saving} placeholder={t('library.metadataAuthorPlaceholder')} className="min-h-11 w-full rounded-xl border border-line/10 bg-shade/25 px-3 outline-none focus:border-indigo-300/45" />
            </label>
            <p className="text-xs leading-5 text-zinc-500">{t('library.metadataCoverHint')}</p>
          </div>
        </div>

        {error ? <div role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-xl border border-line/10 px-4 text-sm text-zinc-300">{t('common.close')}</button>
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? t('library.metadataSaving') : t('library.metadataSave')}
          </button>
        </div>
      </form>
    </DialogSurface>
  )
}
