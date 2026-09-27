"use client"

import type { ReactNode } from 'react'
import { mergeRoleplayNarrationBlocks, type RoleplayScript } from '@/lib/roleplay-script'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

function renderInlineThoughts(text: string, enabled: boolean) {
  if (!enabled) return text
  const marker = /（([^（）\n]+)）|\(([^()\n]+)\)/g
  const children: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = marker.exec(text))) {
    if (match.index > cursor) children.push(text.slice(cursor, match.index))
    children.push(<span key={`thought-${index++}`} className="italic text-zinc-400" data-roleplay-inline-thought>{match[1] ?? match[2]}</span>)
    cursor = match.index + match[0].length
  }
  if (!children.length) return text
  if (cursor < text.length) children.push(text.slice(cursor))
  return children
}

export function RoleplayScriptBlocks({ script }: { script: RoleplayScript }) {
  const { t } = useI18n()
  return <div className="space-y-5" data-testid="roleplay-script">
    {mergeRoleplayNarrationBlocks(script.blocks).map((block, index) => {
      const narration = block.type === 'narration'
      const player = block.type === 'player' || block.type === 'player_thought'
      const thought = block.type === 'player_thought' || block.type === 'counterpart_thought'
      return <div key={index} data-roleplay-block={block.type} className={cn(
        narration ? 'mx-2 border-l-2 border-line/15 py-1 pl-4 sm:mx-6' : 'max-w-[90%] rounded-2xl border px-4 py-3 sm:max-w-[85%]',
        !narration && (player ? 'ml-auto border-violet-400/20 bg-violet-500/10' : 'mr-auto border-emerald-400/20 bg-emerald-500/[0.08]'),
        thought && 'border-dashed',
      )}>
        {!narration ? <p className={cn('mb-1 text-xs font-medium', player ? 'text-violet-300' : 'text-emerald-300')}>
          {player ? `${script.playerName} · ${t('roleplay.you')}` : script.counterpartName}
          {thought ? <span className="ml-2 rounded bg-overlay/5 px-1.5 py-0.5 text-[11px] font-normal text-zinc-400">{t('roleplay.innerThought')}</span> : null}
        </p> : null}
        <p className={cn('whitespace-pre-wrap break-words text-[15px] leading-8 [overflow-wrap:anywhere]', thought ? 'italic text-zinc-400' : narration ? 'text-zinc-400' : 'text-zinc-100')}>{renderInlineThoughts(block.text, Boolean(script.dialogueOnly) || thought)}</p>
      </div>
    })}
  </div>
}
