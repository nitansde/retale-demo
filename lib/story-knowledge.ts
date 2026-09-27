import { htmlToPlainText } from '@/lib/utils'
import type { Chapter, Character, CharacterRelation, OutlineItem, TimelineEvent, WorldEntry } from '@/lib/types'

export type CharacterRoleCardFacet = {
  content?: string
  summary?: string
  note?: string
  evidence?: string
}

export type CharacterRoleCardProfile = {
  personality?: CharacterRoleCardFacet
  gender?: CharacterRoleCardFacet
  identity?: CharacterRoleCardFacet
  capability?: CharacterRoleCardFacet
  appearance?: CharacterRoleCardFacet
  body?: CharacterRoleCardFacet
  clothing?: CharacterRoleCardFacet
  speakingStyle?: CharacterRoleCardFacet
  likes?: CharacterRoleCardFacet
}

export const CHARACTER_ROLE_CARD_KEYS = [
  'personality',
  'gender',
  'identity',
  'capability',
  'appearance',
  'body',
  'clothing',
  'speakingStyle',
  'likes',
] as const

export type CharacterRoleCardKey = typeof CHARACTER_ROLE_CARD_KEYS[number]

const CHARACTER_ROLE_CARD_LABELS: Record<CharacterRoleCardKey, string> = {
  personality: '性格',
  gender: '性别',
  identity: '身份',
  capability: '能力',
  appearance: '外形',
  body: '体态',
  clothing: '衣着',
  speakingStyle: '说话风格',
  likes: '偏好',
}

export type KnownCharacterUpdate = {
  name: string
  descriptionDelta: string
  profile: CharacterRoleCardProfile
  evidence: KnowledgeEvidence[]
}

export type UnknownCharacterObservation = {
  surfaceText: string
  observation: string
  profile: CharacterRoleCardProfile
  evidence: KnowledgeEvidence[]
}

export type AliasDiscovery = {
  alias: string
  target: string
}

export type KnowledgeEvidence = {
  quote: string
  lineStart: number
  lineEnd: number
}

export type ExtractedChapterCharacter = {
  name: string
  aliases: string[]
  status: string
  descriptionDelta: string
  profile: CharacterRoleCardProfile
  evidence: KnowledgeEvidence[]
}

export type ExtractedChapterRelation = {
  source: string
  target: string
  type: string
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed'
  strength: number
  change: string
  validFromChapter: number
  evidence: KnowledgeEvidence[]
}

export type ExtractedChapterEvent = {
  name: string
  summary: string
  eventType: string
  participants: Array<{ name: string; role: string }>
  consequences: string
  importance: number
  evidence: KnowledgeEvidence[]
}

export type ExtractedWorldbuilding = {
  term: string
  category: string
  definition: string
  evidence: KnowledgeEvidence[]
}

export type ExtractedOpenThread = {
  name: string
  description: string
  evidence: KnowledgeEvidence[]
}

export type ChapterKnowledgeExtraction = {
  chapterNo: number
  summary: string
  characters: ExtractedChapterCharacter[]
  knownCharacterUpdates: KnownCharacterUpdate[]
  unknownCharacterObservations: UnknownCharacterObservation[]
  aliasDiscoveries: AliasDiscovery[]
  relations: ExtractedChapterRelation[]
  events: ExtractedChapterEvent[]
  worldbuilding: ExtractedWorldbuilding[]
  openThreads: ExtractedOpenThread[]
}

const NO_CHANGE_PROFILE_KEYS = new Set<CharacterRoleCardKey>(['appearance', 'body', 'clothing'])
const TRANSIENT_ROLE_CARD_STATE_PATTERN = /(?:脸色|面色|面上|神色|表情|眼神|眼眶|面颊).*(?:苍白|惨白|发白|病态苍白|焦急|担心|紧张|认真|平静|惊讶|焦虑|恐惧|痛苦|愤怒|悲伤|温和笑意|通红|红肿)|(?:通红|红肿).*面颊|(?:担心|紧张|认真|焦急|平静).*表情|红肿.*眼眶|温和笑意|(?:皮肤|右手|手臂|左肩|胸部|胸口|左侧胸口|左臂|右臂|小腹).*(?:苍白|惨白|发白|病态苍白|绷带|脱臼|伤势|重伤|受伤|伤口|疼痛|痛苦|流血|血迹|裂开|瘦弱|无法动弹|不能动弹|动弹不得|无法活动|不能活动|活动受限|穿透)|(?:已|已经)?死亡|尸体|尸身|遗体|全身.*(?:软|无力)|动作不够灵活|但和普通人没什么两样|无法站起|无法动弹|不能动弹|动弹不得|无法活动|不能活动|活动受限|站不起来|跌坐|跪倒|倒地|击飞|撞在|卡在|穿透|断裂的木桩|昏迷|昏倒|眩晕|颤抖|发抖|喘息|气喘|呼吸困难|呼吸均匀|已好转|好转|疼痛|痛苦|伤口|受伤|流血|血迹|裂开|疲惫|虚弱|脱力|麻木|双手.*(?:紧握|紧抓|抓紧|抓着|抓住)|捂着.*面颊|后被发现身影|被发现.*身影|打哈欠|闭目养神|靠在|汗珠|腿肚子发颤|脱臼|伤势严重/
const STABLE_VISUAL_DETAIL_PATTERN = /(?:眼|眸|眉|鼻|唇|发|马尾|疤|痣|纹|身形|体形|肩背|步伐|手指|四肢|戒指|耳环|项链|徽章|白袍|长袍|盔甲|披风|斗篷|袖口)/

function isNoChangeText(value?: string) {
  const normalized = value?.trim() ?? ''
  return normalized === '没有变化'
    || normalized === '无变化'
    || normalized === '未变化'
    || normalized === '没有新增变化'
}

export function getCharacterRoleCardFacetContent(facet?: CharacterRoleCardFacet | null) {
  return facet?.content?.trim() || facet?.summary?.trim() || ''
}

function hasMajorVisualChange(value: string) {
  return /(换上|换成|改穿|改为|变成|变为|化作|不再|新(?:的)?|伤|断|残|毁|破|裂|血|烧|焦|撕|脱下|摘下|失去)/.test(value)
}

function hasStableVisualDetail(value: string) {
  return STABLE_VISUAL_DETAIL_PATTERN.test(value)
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, '').replace(/[，,。；;、｜]/g, '')
}

function textContainsMeaning(left: string, right: string) {
  const normalizedLeft = normalizeComparableText(left)
  const normalizedRight = normalizeComparableText(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft.includes(normalizedRight))
}

function splitMergeTerms(value: string) {
  return value
    .split(/[｜；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitVisualFragments(value: string) {
  return value
    .split(/[｜；;，,。]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isTransientRoleCardState(value: string) {
  return TRANSIENT_ROLE_CARD_STATE_PATTERN.test(value.trim())
}

function sanitizeRoleCardContent(key: CharacterRoleCardKey, value: string) {
  const trimmed = value.trim()
  if (!trimmed || isNoChangeText(trimmed)) return trimmed
  const isVisualFacet = NO_CHANGE_PROFILE_KEYS.has(key)
  const fragments = isVisualFacet ? splitVisualFragments(trimmed) : splitMergeTerms(trimmed)
  return fragments
    .filter((fragment) => !isTransientRoleCardState(fragment))
    .join(isVisualFacet ? '，' : '；')
}

function sanitizeVisualContent(value: string) {
  return sanitizeRoleCardContent('appearance', value)
}

function similarityScore(left: string, right: string) {
  const leftChars = Array.from(new Set(normalizeComparableText(left)))
  const rightChars = Array.from(new Set(normalizeComparableText(right)))
  if (!leftChars.length || !rightChars.length) return 0
  const rightSet = new Set(rightChars)
  const overlap = leftChars.filter((char) => rightSet.has(char)).length
  return overlap / Math.min(leftChars.length, rightChars.length)
}

function areSimilarTerms(left: string, right: string) {
  return textContainsMeaning(left, right) || textContainsMeaning(right, left) || similarityScore(left, right) >= 0.68
}

function chooseDetailedTerm(left: string, right: string) {
  return normalizeComparableText(right).length > normalizeComparableText(left).length ? right : left
}

function mergeDedupeText(existing?: string, incoming?: string) {
  const left = existing?.trim() || ''
  const right = incoming?.trim() || ''
  if (!left) return right
  if (!right) return left
  if (left === right) return left

  const terms: string[] = []
  for (const term of [...splitMergeTerms(left), ...splitMergeTerms(right)]) {
    const existingIndex = terms.findIndex((item) => areSimilarTerms(item, term))
    if (existingIndex < 0) {
      terms.push(term)
      continue
    }
    terms[existingIndex] = chooseDetailedTerm(terms[existingIndex], term)
  }
  return terms.join('；')
}

function mergeVisualDedupeText(existing?: string, incoming?: string) {
  const left = sanitizeVisualContent(existing?.trim() || '')
  const right = sanitizeVisualContent(incoming?.trim() || '')
  if (!left) return right
  if (!right || isNoChangeText(right)) return left

  const terms: string[] = []
  for (const term of splitMergeTerms(left)) {
    terms.push(term)
  }
  for (const term of splitVisualFragments(right)) {
    const existingIndex = terms.findIndex((item) => areSimilarTerms(item, term))
    if (existingIndex < 0) {
      if (
        normalizeComparableText(term).length > Math.max(12, normalizeComparableText(left).length * 0.35)
        || hasMajorVisualChange(term)
        || hasStableVisualDetail(term)
      ) {
        terms.push(term)
      }
      continue
    }
    terms[existingIndex] = chooseDetailedTerm(terms[existingIndex], term)
  }
  return terms.join('；')
}

function chooseVisualContent(existing?: string, incoming?: string) {
  const left = sanitizeVisualContent(existing?.trim() || '')
  const right = sanitizeVisualContent(incoming?.trim() || '')
  if (!left) return right
  if (!right || isNoChangeText(right)) return left
  if (left === right) return left
  if (textContainsMeaning(left, right)) return left
  if (textContainsMeaning(right, left)) return right

  return mergeVisualDedupeText(left, right)
}

function normalizeRoleCardFacetValue(key: CharacterRoleCardKey, raw: unknown): CharacterRoleCardFacet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const rawContent = typeof record.content === 'string'
    ? record.content.trim()
    : typeof record.summary === 'string'
      ? record.summary.trim()
      : ''
  const content = sanitizeRoleCardContent(key, rawContent)
  if (!content) return undefined
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : ''
  return {
    content,
    ...(note ? { note } : {}),
    ...(evidence ? { evidence } : {}),
  }
}

export function normalizeCharacterRoleCardProfile(raw: unknown): CharacterRoleCardProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const profile: CharacterRoleCardProfile = {}
  for (const key of CHARACTER_ROLE_CARD_KEYS) {
    const facet = normalizeRoleCardFacetValue(key, record[key])
    if (facet && getCharacterRoleCardFacetContent(facet)) {
      profile[key] = facet
    }
  }
  return profile
}

export function hasCharacterRoleCardProfile(profile: CharacterRoleCardProfile | null | undefined) {
  return CHARACTER_ROLE_CARD_KEYS.some((key) => Boolean(getCharacterRoleCardFacetContent(profile?.[key])))
}

function chooseLeanText(existing?: string, incoming?: string) {
  const left = existing?.trim() || ''
  const right = incoming?.trim() || ''
  if (!left) return right
  if (!right) return left
  if (left === right) return left
  if (left.includes(right)) return right
  if (right.includes(left)) return left
  return left.length <= right.length ? left : right
}

export function mergeCharacterRoleCardProfiles(
  base: CharacterRoleCardProfile | null | undefined,
  incoming: CharacterRoleCardProfile | null | undefined,
): CharacterRoleCardProfile {
  const next: CharacterRoleCardProfile = { ...(base ?? {}) }
  for (const key of CHARACTER_ROLE_CARD_KEYS) {
    const left = base?.[key]
    const right = incoming?.[key]
    const leftContent = getCharacterRoleCardFacetContent(left)
    const rightContent = getCharacterRoleCardFacetContent(right)
    if (NO_CHANGE_PROFILE_KEYS.has(key) && isNoChangeText(rightContent)) {
      if (leftContent) {
        next[key] = { ...left }
      }
      continue
    }
    const content = NO_CHANGE_PROFILE_KEYS.has(key)
      ? chooseVisualContent(leftContent, rightContent)
      : mergeDedupeText(sanitizeRoleCardContent(key, leftContent), sanitizeRoleCardContent(key, rightContent))
    const note = mergeDedupeText(left?.note, right?.note)
    const evidence = mergeDedupeText(left?.evidence, right?.evidence)
    if (content) {
      next[key] = {
        content,
        ...(note ? { note } : {}),
        ...(evidence ? { evidence } : {}),
      }
    }
  }
  return next
}

export function buildCharacterDescriptionDelta(profile: CharacterRoleCardProfile, fallback = '') {
  const identity = getCharacterRoleCardFacetContent(profile.identity)
  const capability = getCharacterRoleCardFacetContent(profile.capability)
  const personality = getCharacterRoleCardFacetContent(profile.personality)
  return [identity, capability, personality, fallback.trim()].filter(Boolean).slice(0, 3).join('｜')
}

export function buildCharacterRoleCardLines(profile: CharacterRoleCardProfile, options?: { includeEvidence?: boolean; includeNotes?: boolean }) {
  const includeEvidence = options?.includeEvidence ?? false
  const includeNotes = options?.includeNotes ?? true
  return CHARACTER_ROLE_CARD_KEYS.flatMap((key) => {
    const facet = profile[key]
    const content = getCharacterRoleCardFacetContent(facet)
    if (!facet || !content) return []
    const parts = [content]
    if (includeNotes && facet.note?.trim()) parts.push(`注：${facet.note.trim()}`)
    if (includeEvidence && facet.evidence?.trim()) parts.push(`证：${facet.evidence.trim()}`)
    return [`${CHARACTER_ROLE_CARD_LABELS[key]}：${parts.join('｜')}`]
  })
}

export function buildCharacterPromptCard(character: Character) {
  const profile = character.profile
  const profileLines = profile && hasCharacterRoleCardProfile(profile)
    ? buildCharacterRoleCardLines(profile)
    : []
  const fallbackLines = [
    character.role.trim() ? `角色：${character.role.trim()}` : '',
    character.goal.trim() ? `目标：${character.goal.trim()}` : '',
    character.trait.trim() ? `性格：${character.trait.trim()}` : '',
    character.note.trim() ? `备注：${character.note.trim()}` : '',
  ].filter(Boolean)
  return `- ${character.name}｜${(profileLines.length ? profileLines : fallbackLines).join('｜')}`
}

export function buildGenerationContext(params: {
  currentChapter: Chapter
  chapters: Chapter[]
  selectionText?: string
  characters: Character[]
  relations: CharacterRelation[]
  worldEntries: WorldEntry[]
  timelineEvents: TimelineEvent[]
  outlines: OutlineItem[]
  recentChapterCount?: number
}) {
  const { currentChapter } = params
  const recentChapterCount = params.recentChapterCount ?? 3
  const sorted = params.chapters.slice().sort((a, b) => a.order - b.order)
  const currentIndex = sorted.findIndex((item) => item.id === currentChapter.id)
  const recent = sorted.slice(Math.max(0, currentIndex - recentChapterCount), currentIndex + 1)

  const relatedTimeline = params.timelineEvents.filter((item) => item.chapterIds.includes(currentChapter.id)).slice(0, 6)
  const relatedOutlines = params.outlines.filter((item) => item.relatedChapterIds.includes(currentChapter.id)).slice(0, 6)
  const relatedRelations = params.relations.filter((item) => item.chapterIds.includes(currentChapter.id)).slice(0, 8)

  return [
    `当前章节：${currentChapter.title}`,
    params.selectionText?.trim() ? `当前处理片段：${params.selectionText.trim()}` : '',
    '',
    '【最近章节上下文】',
    ...recent.map((chapter) => `- ${chapter.title}：${htmlToPlainText(chapter.content).slice(0, 280)}`),
    '',
    '【人物卡】',
    ...params.characters.slice(0, 16).map((char) => buildCharacterPromptCard(char)),
    '',
    '【人物关系网】',
    ...relatedRelations.map((rel) => `- ${params.characters.find((c) => c.id === rel.fromCharacterId)?.name ?? rel.fromCharacterId} -> ${params.characters.find((c) => c.id === rel.toCharacterId)?.name ?? rel.toCharacterId}｜${rel.label}｜${rel.status}｜${rel.note}`),
    '',
    '【世界设定 / 场景设定】',
    ...params.worldEntries.slice(0, 24).map((entry) => `- ${entry.title}｜${entry.type}｜${entry.content}`),
    '',
    '【时间线】',
    ...relatedTimeline.map((event) => `- ${event.order}. ${event.title}｜${event.phase}｜${event.summary}`),
    '',
    '【剧情大纲】',
    ...relatedOutlines.map((item) => `- ${item.title}｜${item.type}｜${item.summary}`),
  ].filter(Boolean).join('\n')
}
