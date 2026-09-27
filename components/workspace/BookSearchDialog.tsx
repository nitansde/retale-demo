'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { BOOK_SEARCH_QUERY_LIMIT, type BookSearchMatch, type BookSearchMode, type BookSearchResult } from '@/lib/book-search'
import { useI18n } from '@/lib/i18n/provider'

export function BookSearchDialog({ novelId, onClose, onSelect }: {
  novelId: string
  onClose: () => void
  onSelect: (match: BookSearchMatch) => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<BookSearchMode>('semantic')
  const [result, setResult] = useState<BookSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [semanticAvailable, setSemanticAvailable] = useState<boolean | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/novels/${encodeURIComponent(novelId)}/search?capabilities=1`, {
      signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) return
      const data = await response.json() as { semanticAvailable?: boolean }
      if (!controller.signal.aborted && typeof data.semanticAvailable === 'boolean') {
        setSemanticAvailable(data.semanticAvailable)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [novelId])

  function changeQuery(value: string) {
    requestRef.current?.abort()
    setQuery(value)
    setResult(null)
    setError(false)
    setLoading(false)
  }

  function changeMode(value: BookSearchMode) {
    requestRef.current?.abort()
    setMode(value)
    setResult(null)
    setError(false)
    setLoading(false)
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    setLoading(true)
    setError(false)
    setResult(null)
    try {
      const response = await fetch(`/api/novels/${encodeURIComponent(novelId)}/search?${new URLSearchParams({ q: query.trim(), mode })}`, {
        signal: request.signal, cache: 'no-store',
      })
      if (!response.ok) throw new Error('Search failed')
      const payload: BookSearchResult = await response.json()
      if (!request.signal.aborted) {
        setResult(payload)
        if (payload.mode === 'semantic') setSemanticAvailable(true)
        if (payload.fallbackReason === 'missing_embedding') setSemanticAvailable(false)
      }
    } catch {
      if (!request.signal.aborted) setError(true)
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }

  function highlight(text: string) {
    const terms = (result?.mode === 'exact' ? [result.query] : (result?.query ?? '').split(/\s+/u)).filter(Boolean)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length)
    if (!terms.length) return text
    return text.split(new RegExp(`(${terms.join('|')})`, 'giu')).map((part, index) => index % 2
      ? <mark key={index} className="rounded bg-violet-400/25 text-violet-100">{part}</mark>
      : part)
  }

  return (
    <DialogSurface open onClose={onClose} title={t('bookSearch.title')} description={t('bookSearch.description')}
      closeLabel={t('bookSearch.close')} initialFocusRef={inputRef} className="max-w-2xl">
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm text-zinc-400">{t('bookSearch.mode')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['semantic', 'exact'] as const).map((value) => (
            <label key={value} className="relative cursor-pointer">
              <input type="radio" name="book-search-mode" value={value} checked={mode === value}
                onChange={() => changeMode(value)} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
              <span className="flex min-h-11 items-center justify-center rounded-xl border border-line/10 bg-overlay/[0.03] px-3 text-sm text-zinc-400 transition peer-checked:border-violet-300/40 peer-checked:bg-violet-500/20 peer-checked:text-violet-100 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-300/70">
                {t(value === 'semantic' ? 'bookSearch.semantic' : 'bookSearch.exact')}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <form onSubmit={(event) => { void search(event) }} className="flex gap-2" role="search">
        <input ref={inputRef} type="search" value={query} onChange={(event) => changeQuery(event.target.value)}
          maxLength={BOOK_SEARCH_QUERY_LIMIT} aria-label={t('bookSearch.query')}
          placeholder={t(mode === 'semantic' ? 'bookSearch.placeholder' : 'bookSearch.exactPlaceholder')}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line/15 bg-shade/20 px-3 text-sm outline-none focus:border-violet-300/60" />
        <button type="submit" disabled={loading || !query.trim()}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-violet-500/20 px-4 text-sm text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50">
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {t('bookSearch.submit')}
        </button>
      </form>
      <div className="mt-4 text-sm text-zinc-400" role="status" aria-live="polite">
        {loading ? t('bookSearch.loading') : result ? (
          <>
            <span className="mr-2 rounded-full border border-violet-300/20 px-2 py-1 text-xs text-violet-200">
              {t(result.mode === 'semantic' ? 'bookSearch.semantic' : 'bookSearch.exact')}
            </span>
            {t(result.limited ? 'bookSearch.limited' : 'bookSearch.count', { count: result.matches.length })}
          </>
        ) : t(mode === 'semantic' ? 'bookSearch.hint' : 'bookSearch.exactHint')}
      </div>
      {result?.fallback || (mode === 'semantic' && semanticAvailable === false) ? (
        <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-100">
          {t(result?.fallback
            ? result.fallbackReason === 'missing_embedding' ? 'bookSearch.missingEmbedding' : 'bookSearch.fallback'
            : 'bookSearch.missingEmbeddingBeforeSearch')}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-sm text-rose-200">{t('bookSearch.error')}</p> : null}
      {result?.matches.length === 0 ? <p className="py-8 text-center text-sm text-zinc-400">{t('bookSearch.empty')}</p> : null}
      {result && result.matches.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {result.matches.map((match, index) => (
            <li key={`${match.chapterId}:${index}`}>
              <button type="button" onClick={() => onSelect(match)}
                className="w-full rounded-2xl border border-line/10 bg-overlay/[0.03] p-4 text-left transition hover:border-violet-300/30 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{t('bookSearch.chapter', { count: match.chapterNo })}</span>
                  {match.sourceType === 'rewrite' || match.sourceType === 'continue_block' ? (
                    <span className="text-fuchsia-200">{t(match.sourceType === 'rewrite' ? 'bookSearch.rewrite' : 'bookSearch.continuation')}</span>
                  ) : null}
                  <span>{t(match.kind === 'semantic' ? 'bookSearch.semanticMatch' : 'bookSearch.exactMatch')}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-200">{highlight(match.chapterTitle)}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{highlight(match.text)}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </DialogSurface>
  )
}
