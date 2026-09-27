"use client"

import Image from 'next/image'
import { useState } from 'react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { Ellipsis, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { LibraryKnowledgeStatus } from '@/lib/library-knowledge-status'
import type { LibrarySummary } from '@/store/novel-store-types'

const knowledgeStatusStyles: Record<LibraryKnowledgeStatus, string> = {
  ready: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  building: 'border-sky-400/20 bg-sky-400/10 text-sky-300',
  missing: 'border-zinc-400/15 bg-zinc-400/5 text-zinc-400',
  partial: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  paused: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  failed: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
  unknown: 'border-zinc-400/15 bg-zinc-400/5 text-zinc-400',
}

export function ProjectCard({
  novel,
  onOpen,
  onEdit,
  onDelete,
  opening,
  deleting,
  disabled,
}: {
  novel: LibrarySummary
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  opening?: boolean
  deleting?: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const knowledgeStatus = novel.knowledgeStatus ?? 'unknown'

  return (
    <article className="group relative border-b border-line/10 py-4 transition sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
      <button type="button" aria-label={t('library.cardOptionsAria', { title: novel.title })} onClick={() => setMenuOpen(true)} disabled={deleting || opening || disabled} className="absolute right-0 top-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 disabled:opacity-50 sm:hidden"><Ellipsis className="h-4 w-4" aria-hidden="true" /></button>
      <div className="absolute right-7 top-7 z-10 hidden gap-2 sm:right-8 sm:top-8 sm:flex">
        <button
          type="button"
          onClick={onEdit}
          disabled={deleting || opening || disabled}
          className="rounded-2xl border border-line/15 bg-shade/55 p-2 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-indigo-500/70 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('library.cardEditAria', { title: novel.title })}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || opening || disabled}
          className="rounded-2xl border border-rose-300/20 bg-shade/55 p-2 text-rose-100 shadow-lg backdrop-blur transition hover:bg-rose-500/70 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('library.cardDeleteAria', { title: novel.title })}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onOpen}
        disabled={opening || disabled}
        aria-busy={opening}
        className="flex w-full gap-4 text-left disabled:cursor-progress sm:block"
      >
          <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg sm:mb-4 sm:h-40 sm:w-auto bg-[radial-gradient(circle_at_top_left,_rgba(124,156,255,0.45),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.25),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.01))] sm:mb-5 sm:h-48 sm:rounded-[22px]">
            {novel.coverImage ? (
              <Image
                src={novel.coverImage}
                alt={t('library.metadataCoverPreview', { title: novel.title })}
                fill
                unoptimized
                sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                className="object-cover transition duration-500 group-hover:scale-[1.025]"
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
            <div>
              <h2 className="break-words pr-10 text-base font-medium tracking-tight text-zinc-100 sm:pr-0 sm:text-lg group-hover:text-heading">
                {novel.title}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {novel.author
                  ? t('library.cardAuthor', { author: novel.author })
                  : t('library.cardUnknownAuthor')}
              </p>
            </div>

            <div className="flex items-center sm:border-t sm:border-line/[0.06] sm:pt-3">
              <span
                role="status"
                className={`inline-flex items-center gap-2 rounded-full text-xs font-medium max-sm:border-0 max-sm:bg-transparent sm:border sm:px-2.5 sm:py-1 ${knowledgeStatusStyles[knowledgeStatus]}`}
              >
                {knowledgeStatus === 'building' ? (
                  <LoaderCircle aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
                ) : (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
                {t('library.cardKnowledgeStatus', { status: t(`library.knowledgeStatus.${knowledgeStatus}`) })}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>{t('library.cardChapterCount', { count: novel.chapterCount })}</span>
              <span>{t('library.cardWordCount', { count: novel.wordCount.toLocaleString() })}</span>
              <span className="hidden sm:inline">{novel.updatedAt}</span>
            </div>

            {opening ? (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-200" />
                <span>{t('library.cardOpening')}</span>
              </div>
            ) : null}
          </div>
      </button>
      <DialogSurface open={menuOpen} onClose={() => setMenuOpen(false)} title={novel.title} closeLabel={t('common.close')} placement="bottom">
        <div className="grid divide-y divide-line/10">
          <button type="button" onClick={() => { setMenuOpen(false); onEdit() }} className="flex min-h-12 items-center gap-3 text-left text-sm text-zinc-200" aria-label={t('library.cardEditAria', { title: novel.title })}><Pencil className="h-4 w-4" />{t('library.cardEditAria', { title: novel.title })}</button>
          <button type="button" onClick={() => { setMenuOpen(false); onDelete() }} className="flex min-h-12 items-center gap-3 text-left text-sm text-rose-300" aria-label={t('library.cardDeleteAria', { title: novel.title })}><Trash2 className="h-4 w-4" />{t('library.cardDeleteAria', { title: novel.title })}</button>
        </div>
      </DialogSurface>
    </article>
  )
}
