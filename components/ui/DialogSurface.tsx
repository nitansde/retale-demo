"use client"

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type DialogPlacement = 'center' | 'left' | 'right' | 'bottom'

const PLACEMENT_STYLES: Record<DialogPlacement, string> = {
  center: 'm-auto max-h-[88vh] w-[calc(100%-2rem)] max-w-xl rounded-[30px]',
  left: 'mr-auto h-full w-[86vw] max-w-sm rounded-r-[30px]',
  right: 'ml-auto h-full w-[86vw] max-w-sm rounded-l-[30px]',
  bottom: 'mt-auto max-h-[88vh] w-full rounded-t-[30px]',
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const openSurfaces: HTMLElement[] = []
let modalCount = 0
let originalBodyOverflow = ''

function focusableElements(surface: HTMLElement) {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    for (let parent: HTMLElement | null = element; parent && parent !== surface; parent = parent.parentElement) {
      if (parent.hidden || getComputedStyle(parent).display === 'none' || getComputedStyle(parent).visibility === 'hidden') return false
      if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector('summary')?.contains(element)) return false
    }
    return true
  })
}

const subscribeToHydration = () => () => {}

export function DialogSurface({
  open,
  onClose,
  title,
  description,
  children,
  placement = 'center',
  modal = true,
  closeOnBackdrop = true,
  closeDisabled = false,
  closeLabel,
  busy = false,
  initialFocusRef,
  backdropTestId,
  surfaceTestId,
  backdropClassName,
  titleClassName,
  contentClassName,
  className,
  footer,
  mobileFullscreen = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  placement?: DialogPlacement
  modal?: boolean
  closeOnBackdrop?: boolean
  closeDisabled?: boolean
  closeLabel?: string
  busy?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  backdropTestId?: string
  surfaceTestId?: string
  backdropClassName?: string
  titleClassName?: string
  contentClassName?: string
  className?: string
  footer?: ReactNode
  mobileFullscreen?: boolean
}) {
  const mounted = useSyncExternalStore(subscribeToHydration, () => true, () => false)
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    closeDisabledRef.current = closeDisabled
  }, [closeDisabled])

  useEffect(() => {
    if (!open || !mounted) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (modal) {
      if (modalCount === 0) originalBodyOverflow = document.body.style.overflow
      modalCount += 1
      document.body.style.overflow = 'hidden'
    }

    const surface = surfaceRef.current
    if (surface) openSurfaces.push(surface)
    const requestedFocus = initialFocusRef?.current
    const focusable = requestedFocus && surface?.contains(requestedFocus)
      ? requestedFocus
      : surface ? focusableElements(surface)[0] : null
    ;(focusable ?? surface)?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (openSurfaces.at(-1) !== surface) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (closeDisabledRef.current) return
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !surface) return

      const elements = focusableElements(surface)
      if (elements.length === 0) {
        event.preventDefault()
        surface.focus()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!surface || openSurfaces.at(-1) !== surface || surface.contains(event.target as Node)) return
      const firstFocusable = focusableElements(surface)[0]
      ;(firstFocusable ?? surface).focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      if (surface) {
        const index = openSurfaces.indexOf(surface)
        if (index >= 0) openSurfaces.splice(index, 1)
      }
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      if (modal) {
        modalCount -= 1
        if (modalCount === 0) document.body.style.overflow = originalBodyOverflow
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [initialFocusRef, modal, mounted, open])

  if (!open || !mounted) return null

  return createPortal(
    <div
      data-testid={backdropTestId}
      className={cn('dialog-backdrop fixed inset-0 z-[70] flex bg-scrim/72 backdrop-blur-md backdrop-saturate-150', backdropClassName)}
      onClick={(event) => {
        if (!closeDisabled && closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={surfaceRef}
        data-testid={surfaceTestId}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cn(
          'dialog-surface flex min-h-0 flex-col overflow-hidden border border-line/10 bg-panel px-5 pt-5 text-zinc-100 shadow-[0_30px_120px_rgb(0_0_0/calc(0.58*var(--shadow-strength)))] outline-none',
          PLACEMENT_STYLES[placement],
          className,
          mobileFullscreen && 'max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-4">
          <h2 id={titleId} className={cn('min-w-0 text-lg font-semibold text-zinc-100', titleClassName)}>{title}</h2>
          {closeLabel ? (
            <button
              type="button"
              aria-label={closeLabel}
              disabled={closeDisabled}
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-overlay/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {description ? <p id={descriptionId} className="mt-2 shrink-0 text-sm leading-6 text-zinc-400">{description}</p> : null}
        <div data-testid="dialog-content" className={cn('mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5', !footer && 'pb-[max(1.25rem,env(safe-area-inset-bottom))]', contentClassName)}>{children}</div>
        {footer ? <div className="-mx-5 shrink-0 border-t border-line/10 bg-panel px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
