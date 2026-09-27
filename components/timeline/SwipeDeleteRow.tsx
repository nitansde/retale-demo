"use client"

import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type PointerEvent } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

const DELETE_REVEAL_WIDTH = 80

export function SwipeDeleteRow({ children, onDelete, deleteLabel, deleting, className, ...rowProps }: ComponentPropsWithoutRef<'div'> & {
  onDelete?: () => void
  deleteLabel: string
  deleting?: boolean
}) {
  const { t } = useI18n()
  const rowRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    x: number
    y: number
    origin: number
    offset: number
    axis: 'horizontal' | 'vertical' | null
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const deleteRevealed = offset < 0

  useEffect(() => {
    if (!deleteRevealed) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !rowRef.current?.contains(event.target)) setOffset(0)
    }
    const close = () => setOffset(0)
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('resize', close)
    }
  }, [deleteRevealed])

  const finishSwipe = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setDragging(false)
    if (gesture.axis === 'horizontal') {
      suppressClickRef.current = true
      setOffset(cancelled ? gesture.origin : gesture.offset <= -DELETE_REVEAL_WIDTH / 2 ? -DELETE_REVEAL_WIDTH : 0)
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      {...rowProps}
      ref={rowRef}
      data-delete-revealed={deleteRevealed ? 'true' : 'false'}
      className={cn('relative flex min-w-0 items-start overflow-hidden rounded-xl lg:gap-2 lg:overflow-visible', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && deleteRevealed) {
          event.stopPropagation()
          setOffset(0)
        }
      }}
    >
      <div
        className={cn('relative z-10 flex min-w-0 flex-1 touch-pan-y items-start gap-1 bg-raised lg:!transform-none', !dragging && 'transition-transform duration-150 motion-reduce:transition-none')}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(event) => {
          suppressClickRef.current = false
          if (!onDelete || deleting || event.pointerType === 'mouse' || !event.isPrimary) return
          gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: offset, offset, axis: null }
        }}
        onPointerMove={(event) => {
          const gesture = gestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId) return
          const dx = event.clientX - gesture.x
          const dy = event.clientY - gesture.y
          if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
            gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'
          }
          if (gesture.axis !== 'horizontal') return
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          gesture.offset = Math.min(0, Math.max(-DELETE_REVEAL_WIDTH, gesture.origin + dx))
          setDragging(true)
          setOffset(gesture.offset)
        }}
        onPointerUp={(event) => finishSwipe(event)}
        onPointerCancel={(event) => finishSwipe(event, true)}
        onClickCapture={(event) => {
          if (!suppressClickRef.current && !deleteRevealed) return
          if (!suppressClickRef.current) setOffset(0)
          suppressClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
      </div>
      {onDelete ? <button
        type="button"
        disabled={deleting}
        onClick={() => { setOffset(0); onDelete() }}
        aria-label={deleteLabel}
        title={deleteLabel}
        className={cn('absolute inset-y-0 right-0 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-rose-400/20 bg-rose-500/15 p-2 text-rose-200 transition hover:bg-rose-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-300/70 disabled:cursor-not-allowed disabled:opacity-60 lg:static lg:inline-flex lg:min-h-11 lg:w-11', deleteRevealed ? 'flex' : 'hidden')}
      >
        {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        <span className="text-xs lg:hidden">{t('workspace.timeline.deleteAction')}</span>
      </button> : null}
    </div>
  )
}
