import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, CircleAlert, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NoticeVariant = 'info' | 'success' | 'warning' | 'error'

const VARIANT_STYLES: Record<NoticeVariant, string> = {
  info: 'border-sky-400/20 bg-sky-500/10 text-sky-50',
  success: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50',
  warning: 'border-amber-400/20 bg-amber-500/10 text-amber-50',
  error: 'border-rose-400/20 bg-rose-500/10 text-rose-50',
}

const VARIANT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  error: AlertCircle,
} satisfies Record<NoticeVariant, typeof Info>

export function Notice({
  variant = 'info',
  title,
  children,
  action,
  className,
}: {
  variant?: NoticeVariant
  title?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const Icon = VARIANT_ICONS[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm', VARIANT_STYLES[variant], className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn('leading-6 opacity-80', title && 'mt-1')}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
