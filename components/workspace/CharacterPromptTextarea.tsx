"use client"

import { useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Users } from 'lucide-react'
import { getCharacterCompletion, type PromptCharacter } from '@/lib/character-prompt-completion'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue'> & {
  value: string
  onValueChange: (value: string) => void
  characters?: PromptCharacter[]
}

export function CharacterPromptTextarea({ value, onValueChange, characters = [], ...props }: Props) {
  const { t } = useI18n()
  const id = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const pendingCaretRef = useRef<number | null>(null)
  const caretRef = useRef({ start: value.length, end: value.length })
  const [query, setQuery] = useState<{ value: string; start: number; end: number; browse: boolean } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const completion = query?.value === value && !props.disabled && !props.readOnly
    ? getCharacterCompletion(value, query.start, query.end, characters, query.browse)
    : null
  const index = Math.min(activeIndex, (completion?.characters.length ?? 1) - 1)
  const enabled = characters.some((character) => character.name.trim()) && !props.disabled && !props.readOnly

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    if (caret === null || !inputRef.current) return
    inputRef.current.focus()
    inputRef.current.setSelectionRange(caret, caret)
    caretRef.current = { start: caret, end: caret }
    pendingCaretRef.current = null
  }, [value])

  function updateQuery(input: HTMLTextAreaElement, force = false) {
    const { selectionStart: start, selectionEnd: end } = input
    const changed = start !== caretRef.current.start || end !== caretRef.current.end
    caretRef.current = { start, end }
    if (composingRef.current || pendingCaretRef.current !== null) return
    if (force || changed) {
      setQuery({ value: input.value, start, end, browse: false })
      setActiveIndex(0)
    }
  }

  function insertCharacter(character: PromptCharacter) {
    if (!completion) return
    const name = character.name.trim()
    const nextValue = value.slice(0, completion.start) + name + value.slice(completion.end)
    if (props.maxLength !== undefined && props.maxLength >= 0 && nextValue.length > props.maxLength) return
    const caret = completion.start + name.length
    setQuery(null)
    caretRef.current = { start: caret, end: caret }
    // Also restore focus when replacing selected text with the same name.
    pendingCaretRef.current = caret
    if (nextValue === value) {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
      pendingCaretRef.current = null
    } else {
      onValueChange(nextValue)
    }
  }

  return <div className="min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setQuery(null)
  }}>
    <textarea
      {...props}
      ref={inputRef}
      value={value}
      aria-autocomplete={enabled ? 'list' : undefined}
      aria-controls={completion ? `${id}-list` : undefined}
      aria-activedescendant={completion ? `${id}-option-${index}` : undefined}
      aria-describedby={[props['aria-describedby'], enabled ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined}
      onChange={(event) => {
        onValueChange(event.target.value)
        updateQuery(event.currentTarget, true)
      }}
      onFocus={(event) => { updateQuery(event.currentTarget, true); props.onFocus?.(event) }}
      onSelect={(event) => { updateQuery(event.currentTarget); props.onSelect?.(event) }}
      onCompositionStart={(event) => { composingRef.current = true; setQuery(null); props.onCompositionStart?.(event) }}
      onCompositionEnd={(event) => { composingRef.current = false; updateQuery(event.currentTarget, true); props.onCompositionEnd?.(event) }}
      onKeyDown={(event) => {
        if (completion && !composingRef.current && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((index + (event.key === 'ArrowDown' ? 1 : -1) + completion.characters.length) % completion.characters.length)
            return
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            insertCharacter(completion.characters[index])
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setQuery(null)
            return
          }
        }
        props.onKeyDown?.(event)
      }}
    />
    {enabled ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" aria-expanded={Boolean(completion)} aria-controls={completion ? `${id}-list` : undefined} aria-haspopup="listbox" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs text-violet-300 hover:text-violet-200 focus-visible:outline-2 focus-visible:outline-violet-400" onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (completion) { setQuery(null); return }
        inputRef.current?.focus()
        setQuery({ value, ...caretRef.current, browse: true })
        setActiveIndex(0)
      }}><Users aria-hidden="true" className="h-3.5 w-3.5" />{t('characterPrompt.insert')}</button>
      <span id={`${id}-hint`} className="text-xs text-zinc-500">{t('characterPrompt.hint')}</span>
    </div> : null}
    {completion ? <div className="mt-1 rounded-xl border border-line/15 bg-surface p-1 shadow-lg">
      <div id={`${id}-list`} role="listbox" aria-label={t('characterPrompt.suggestions')} className="max-h-44 overflow-y-auto overscroll-contain">
        {completion.characters.map((character, optionIndex) => <button
          key={character.name}
          id={`${id}-option-${optionIndex}`}
          role="option"
          type="button"
          aria-selected={index === optionIndex}
          tabIndex={-1}
          ref={(node) => { if (index === optionIndex) node?.scrollIntoView?.({ block: 'nearest' }) }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertCharacter(character)}
          className={cn('flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-overlay/5', index === optionIndex && 'bg-violet-500/15 text-violet-200')}
        ><span className="min-w-0 break-words">{character.name}</span>{character.aliases?.length ? <span className="max-w-[55%] truncate text-xs text-zinc-500">{character.aliases.join(' · ')}</span> : null}</button>)}
      </div>
      <p className="px-3 py-1 text-xs text-zinc-500">{t('characterPrompt.keyboardHint')}</p>
    </div> : null}
  </div>
}
