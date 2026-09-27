export type RoleplayCast = { playerName: string; counterpartName: string }
// maxCharacters is the stored field name; it is an advisory target, not an output cap.
export type RoleplayTurn = RoleplayCast & { storyGuidance: string; dialogue: string; maxCharacters: number; dialogueOnly?: boolean; generationOptions?: RoleplayGenerationOptions }
export type RoleplayScriptBlock = { type: 'narration' | 'player' | 'counterpart' | 'player_thought' | 'counterpart_thought'; text: string }
export type RoleplayScript = RoleplayCast & { blocks: RoleplayScriptBlock[]; dialogueOnly?: boolean }
export type RoleplayCharacterOption = { name: string; protagonist: boolean }

export const ROLEPLAY_DEFAULT_LENGTH = 600
export const ROLEPLAY_DIALOGUE_ONLY_DEFAULT_LENGTH = 300

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseRoleplayCast(value: unknown): RoleplayCast | null {
  const input = record(value)
  if (!input || typeof input.playerName !== 'string' || typeof input.counterpartName !== 'string') return null
  const playerName = input.playerName.trim()
  const counterpartName = input.counterpartName.trim()
  if (!playerName || !counterpartName || playerName.length > 80 || counterpartName.length > 80 || playerName === counterpartName) return null
  return { playerName, counterpartName }
}

export function parseRoleplayTurn(value: unknown, options: { allowEmptyInput?: boolean } = {}): RoleplayTurn | null {
  const input = record(value)
  const cast = parseRoleplayCast(value)
  if (!input || !cast || typeof input.storyGuidance !== 'string' || typeof input.dialogue !== 'string') return null
  const storyGuidance = input.storyGuidance.trim()
  const dialogue = input.dialogue.trim()
  if ((!options.allowEmptyInput && !storyGuidance && !dialogue) || storyGuidance.length > 10000 || dialogue.length > 10000) return null
  const maxCharacters = input.maxCharacters
  if (typeof maxCharacters !== 'number' || !Number.isInteger(maxCharacters) || maxCharacters < 100 || maxCharacters > 4000) return null
  const generationOptions = input.generationOptions === undefined ? undefined : parseRoleplayGenerationOptions(input.generationOptions)
  if (generationOptions === null) return null
  if (input.dialogueOnly !== undefined && typeof input.dialogueOnly !== 'boolean') return null
  return { ...cast, storyGuidance, dialogue, maxCharacters, ...(input.dialogueOnly !== undefined ? { dialogueOnly: input.dialogueOnly } : {}), ...(generationOptions ? { generationOptions } : {}) }
}

function parseBlocks(value: unknown): RoleplayScriptBlock[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 200) return null
  const blocks: RoleplayScriptBlock[] = []
  for (const item of value) {
    const block = record(item)
    if (!block || !['narration', 'player', 'counterpart', 'player_thought', 'counterpart_thought'].includes(String(block.type)) || typeof block.text !== 'string' || !block.text.trim()) return null
    blocks.push({ type: block.type as RoleplayScriptBlock['type'], text: block.text.trim() })
  }
  return mergeRoleplayNarrationBlocks(blocks)
}

export function mergeRoleplayNarrationBlocks(blocks: readonly RoleplayScriptBlock[]): RoleplayScriptBlock[] {
  const merged: RoleplayScriptBlock[] = []
  for (const block of blocks) {
    const previous = merged.at(-1)
    if (block.type === 'narration' && previous?.type === 'narration') {
      previous.text += `\n\n${block.text}`
    } else {
      merged.push({ ...block })
    }
  }
  return merged
}

export function parseRoleplayScript(value: unknown): RoleplayScript | null {
  const input = record(value)
  const cast = parseRoleplayCast(value)
  const blocks = parseBlocks(input?.blocks)
  if (!cast || !blocks) return null
  if (input?.dialogueOnly !== undefined && typeof input.dialogueOnly !== 'boolean') return null
  return { ...cast, blocks, ...(input?.dialogueOnly ? { dialogueOnly: true } : {}) }
}

export function readGeneratedRoleplayScript(content: string, turn: RoleplayTurn): RoleplayScript | null {
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const value: unknown = JSON.parse(clean)
    const blocks = parseBlocks(Array.isArray(value) ? value : record(value)?.blocks)
    if (!blocks || !blocks.some((block) => block.type === 'counterpart')) return null
    if (turn.dialogueOnly && (blocks.length !== 1 || blocks[0]?.type !== 'counterpart')) return null
    return { playerName: turn.playerName, counterpartName: turn.counterpartName, blocks, ...(turn.dialogueOnly ? { dialogueOnly: true } : {}) }
  } catch { return null }
}

export function roleplayScriptText(script: RoleplayScript) {
  return script.blocks.map((block) => {
    const name = block.type === 'narration' ? '旁白' : block.type === 'player' || block.type === 'player_thought' ? script.playerName : script.counterpartName
    const thought = block.type === 'player_thought' || block.type === 'counterpart_thought'
    return `${name}${thought ? '（心声，未说出口）' : ''}：${block.text}`
  }).join('\n\n')
}

export function roleplayTurnText(turn: RoleplayTurn) {
  return [turn.storyGuidance && `故事引导：${turn.storyGuidance}`, turn.dialogue && `${turn.playerName}对${turn.counterpartName}说：${turn.dialogue}`].filter(Boolean).join('\n')
}

export const ROLEPLAY_SCRIPT_SYSTEM_PROMPT = [
  '你负责生成双角色互动内容。本次输出必须遵守角色互动输出格式，返回含 narration、player、counterpart 的 JSON blocks。允许代写双方后续台词与行动旁白。',
  '已有 RP 历史是当前故事进度，优先承接其中最新的场景、人物状态和对话。原章节仅提供初始背景；即使预设要求魔改原文，也不要将本轮当作重新开场或重写原章节。只生成接下来发生的新内容。',
].join('\n')

export function buildRoleplaySystemPrompt(turn: Pick<RoleplayTurn, 'dialogueOnly'>) {
  if (!turn.dialogueOnly) return ROLEPLAY_SCRIPT_SYSTEM_PROMPT
  return [
    '你负责生成双角色的纯对话。本次为「仅对话」模式：只返回对方角色的一个 counterpart JSON block，不要返回 player、narration 或任何其他 block。',
    '这是对方角色的一次完整长回复：允许写成大段连续对白或第一人称自述，可以有多个自然段。不要压缩成日常聊天的一句一答，也不要只回复一两句；让角色通过正在说出口的话充分表达，并推进一段完整情节。',
    '禁止旁白、场景说明、第三人称动作和格式说明。对方可以用第一人称把自己正在做的事、注意到的变化、打算和感受自然地说给用户听，用说出口的内容推进情节，保持单方口述感。不要替用户写回复。',
    '心声完全可选，偶尔需要时直接写在同一个 text 的括号内，例如（我其实有点紧张）；不要另起段落、不要另建 block、不要每次都写。',
    '已有 RP 历史是当前进度，承接最新对话与关系；原章节仅提供初始背景。即使历史、预设或写作技巧含旁白或要求描写，本轮仍遵守仅对话格式，不重新开场或重写章节。',
  ].join('\n')
}

// Keep the contract independent of this turn's input and target length so the
// chapter background and accumulated history can share a stable request prefix.
export function buildRoleplayScriptPrompt(cast: RoleplayCast & Pick<RoleplayTurn, 'dialogueOnly'>) {
  if (cast.dialogueOnly) return [
    '# 双角色互动输出要求（仅对话）',
    `用户扮演：${JSON.stringify(cast.playerName)}；互动对象：${JSON.stringify(cast.counterpartName)}。`,
    '承接用户的开场台词和此前对话，只生成对方角色接下来的一条回复；保持双方身份、性格与已有关系一致，不使用当前章节之后的事实。',
    '只输出对方说出口的内容，禁止旁白、环境说明、动作、神态、第三人称心理描写、括号动作和舞台指示。可以用对方第一人称口述刚刚发生的事来推进情节，但这些内容必须是对方正在说的话。不要生成用户角色的台词。',
    '心声完全可选，偶尔才写，并且必须和对话留在同一个 counterpart text 中，用括号包住，例如（我其实有点紧张）；不要单独成段或单独输出。',
    '回复应当是大段、完整、连贯的一次发言，可以包含多个自然段和较长的第一人称自述；不要写成一问一答的短句合集，也不要替用户生成下一轮回复。',
    '故事引导只作为理解情境和推进对话的背景，不原样输出为台词，不转写为旁白；历史、预设或写作技巧中的叙述风格不得覆盖仅对话要求。',
    '不要输出剧情大纲或格式说明。不要自动应用、改写或续写原章节正文。',
    '只返回 JSON 对象 {"blocks":[{"type":"counterpart","text":"你先留在我身边，我把灯往前挪一点。现在能看清了，门下面有一封信，封口上的印记我见过。你还记得我说过的那间旧书房吗？我在那里找到的盒子上，也有一模一样的印记。我一直以为只是巧合，可这封信上写着我的名字。\\n\\n我先把它拿起来，你帮我留意一下走廊。别担心，我没有打算瞒着你。里面只有一张纸……等等，这上面写的是今晚的时间，还提到了我们刚才经过的那座桥。我想我们得重新考虑接下来去哪儿了，不过在那之前，我有件一直没说的事，要从头告诉你。"}]}。',
    'blocks 必须恰好只有一个 counterpart；不要输出 narration、player 或任何 thought block。不要输出分析、标题或 Markdown 代码围栏。',
  ].join('\n')
  return [
    '# 双角色互动输出要求',
    `用户扮演：${JSON.stringify(cast.playerName)}；互动对象：${JSON.stringify(cast.counterpartName)}。`,
    '根据章节上下文、此前对话和本轮故事引导，生成一段连贯的角色互动，包含对话、行动与旁白。',
    '用户台词是本段引子，先承接它；允许继续编写双方多轮对话和旁白，形成一小段故事。',
    '可以描写场景、人物行动与反应；保持双方身份、性格与已有关系一致，不使用当前章节之后的事实。',
    '故事引导是场景和行动指令，不是角色说出口的话。不要把引导原样当成台词。',
    '连续的旁白段落合并在同一个 narration 块中，用换行保留段落；不要跨过人物对话合并旁白。',
    'player 和 counterpart 块除了说出口的台词，也可以包含该角色的神态、语气、心理反应或伴随的动作描写，让对话自然生动；同一块始终归属于该角色。环境、整体场面或跨角色的行动放在 narration 中。',
    '不要输出剧情大纲或格式说明。不要自动应用、改写或续写原章节正文。',
    '只返回 JSON 对象 {"blocks":[{"type":"narration","text":"雨落在窗沿。\\n\\n屋里的灯晃了一下。"},{"type":"player","text":"他抬眼看向她，声音放轻：“还在等我？”"},{"type":"counterpart","text":"她微微一笑，把伞递过去。“当然。”"}]}。',
    'type 只能是 narration、player、counterpart；人物块不加角色名前缀。可重复任意类型，必须包含对方的台词。不输出分析、标题或 Markdown 代码围栏。',
  ].join('\n')
}

export function buildRoleplayTurnPrompt(turn: RoleplayTurn, hasHistory = false) {
  return [
    '# 任务',
    '操作类型：roleplay',
    hasHistory
      ? '这是继续对话：本轮台词接在历史最后一段之后。延续最后的场景、行动、人物关系和未回答的问题，不回到原章节起点、不重复相遇或已经完成的对话；除非用户明确要求跳转场景。'
      : '这是故事的第一轮：从章节起始片段进入用户指定的场景。',
    turn.dialogueOnly
      ? `本轮开启「仅对话」：只写对方角色的一个 counterpart 回复块，但该回复应当是大段、完整的对白或第一人称自述（目标约 ${turn.maxCharacters} 字，可分成多个自然段）。这是篇幅引导，允许适当超出或不足，以表达完整和自然收尾为先。不要生成我方台词、旁白或独立心声块。`
      : `本次故事的目标字数约为 ${turn.maxCharacters} 字（所有块合计，含标点）。请写到这个长度附近；这是篇幅引导，允许适当超出或不足，以情节和句子完整、自然收尾为先，不要为凑字数拖长或突然中断。`,
    '本轮输入：',
    JSON.stringify({ storyGuidance: turn.storyGuidance, openingDialogue: turn.dialogue }),
  ].join('\n')
}
import { parseRoleplayGenerationOptions, type RoleplayGenerationOptions } from '@/lib/roleplay-generation'
