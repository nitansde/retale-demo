export type Novel = {
  id: string
  title: string
  summary: string
  tags: string[]
  updatedAt: string
  wordCount: number
  chapterCount: number
}

export type LocalNovelMeta = {
  id: string
  title: string
  summary: string
  tags: string[]
}

export type ChapterStatus = 'draft' | 'review' | 'done'
export type ChapterKind = 'main' | 'branch'

export type Chapter = {
  id: string
  novelId: string
  title: string
  order: number
  content: string
  /** Client workspace summary only; the server preserves this chapter's stored text on save. */
  contentLoaded?: false
  originalContent?: string
  status: ChapterStatus
  wordCount: number
  updatedAt: string
  kind?: ChapterKind
  parentChapterId?: string
  branchLabel?: string
  trajectory?: string[]
}

export type KnowledgeRebuildChapterRange = {
  startChapter?: number
  endChapter?: number
}

export type OutlineType = 'main' | 'side' | 'foreshadow' | 'conflict' | 'climax'

export type OutlineItem = {
  id: string
  novelId: string
  title: string
  type: OutlineType
  summary: string
  relatedChapterIds: string[]
}

export type Character = {
  id: string
  novelId: string
  name: string
  role: string
  goal: string
  trait: string
  note: string
  profile?: CharacterRoleCardProfile
  aliases?: string[]
  importanceTier?: 'protagonist' | 'important' | 'arc' | 'candidate' | 'ignored' | null
  classificationKey?: 'tier0' | 'tier1' | 'tier2' | 'candidate' | 'ignored' | null
  classificationLabel?: string | null
}

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

export type CharacterRelation = {
  id: string
  novelId: string
  fromCharacterId: string
  toCharacterId: string
  label: string
  strength: 'weak' | 'medium' | 'strong'
  status: 'active' | 'strained' | 'hidden' | 'resolved'
  note: string
  chapterIds: string[]
}

export type WorldEntryType = 'location' | 'scene' | 'organization' | 'rule' | 'item' | 'history'

export type WorldEntry = {
  id: string
  novelId: string
  title: string
  type: WorldEntryType
  content: string
}

export type TimelineEvent = {
  id: string
  novelId: string
  title: string
  phase: string
  worldline: string
  summary: string
  order: number
  chapterIds: string[]
}

export type HelperTab = 'ai' | 'references' | 'trajectory' | 'stats'
export type WorkspaceTab = 'editor' | 'rewrite' | 'outline' | 'characters' | 'world'

export const PRODUCT_SURFACE_IDS = ['rewrite', 'future_jump', 'roleplay'] as const
export type ProductSurfaceId = (typeof PRODUCT_SURFACE_IDS)[number]

export const PRODUCT_ACTION_IDS = ['save', 'continue', 'regenerate'] as const
export type RewriteMode =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'perspective'
  | 'relationship'
  | 'branch'
  | 'dialogue'
  | 'compression'

export type RewriteTone =
  | 'keep'
  | 'dramatic'
  | 'dark'
  | 'romantic'
  | 'light-novel'
  | 'colder'
  | 'cinematic'

export type RewriteOutput = 'candidate' | 'replace' | 'branch' | 'insert'
export type RewriteScope = 'chapter' | 'paragraph' | 'selection'
export type ConstraintStrength = 'off' | 'soft' | 'strict'
export type ThoughtLevel = 'none' | 'medium' | 'long'

export type RewriteConstraint = {
  id: string
  label: string
  enabled: boolean
  strength: ConstraintStrength
}

export type RewritePreset = {
  id: string
  name: string
  mode: RewriteMode
  tone: RewriteTone
  prompt: string
}

export type RewriteCandidate = {
  id: string
  batchId: string
  title: string
  summary: string
  content: string
  mode: RewriteMode
  tone: RewriteTone
  selected: boolean
  createdAt: string
  prompt: string
  sourceExcerpt: string
  actions: Array<'apply' | 'insert' | 'branch' | 'continue'>
}

export type RewriteHistoryEntry = {
  id: string
  batchId: string
  chapterId: string
  scope: RewriteScope
  sourceExcerpt: string
  mode: RewriteMode
  tone: RewriteTone
  createdAt: string
  candidateIds: string[]
}

export type TrajectoryEntry = {
  id: string
  chapterId: string
  type: 'rewrite' | 'apply' | 'branch' | 'insert' | 'continue' | 'note'
  title: string
  detail: string
  createdAt: string
}

export type AIProvider = 'openai-compatible' | 'ollama'

export type OpenAICompatibleProviderSettings = {
  baseUrl: string
  apiKey: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
  model: string
  configured?: boolean
}

export type OllamaProviderSettings = {
  baseUrl: string
  model: string
  configured?: boolean
}

export type KnowledgeExtractionOpenAICompatibleProviderSettings = OpenAICompatibleProviderSettings & {
  parallelism: number
}

export type KnowledgeExtractionOllamaProviderSettings = OllamaProviderSettings & {
  parallelism: number
}

export type AIScenarioSettings = {
  provider: AIProvider
  openAICompatible: OpenAICompatibleProviderSettings
  ollama: OllamaProviderSettings
}

export type KnowledgeExtractionScenarioSettings = {
  provider: AIProvider
  openAICompatible: KnowledgeExtractionOpenAICompatibleProviderSettings
  ollama: KnowledgeExtractionOllamaProviderSettings
}

export type EmbeddingsScenarioSettings = AIScenarioSettings & {
  embeddingBatchSize: number
}

import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'

export type AISettings = {
  rewrite: AIScenarioSettings
  knowledgeExtraction: KnowledgeExtractionScenarioSettings
  embeddings: EmbeddingsScenarioSettings
}

export type AIScenarioKey = keyof AISettings

export const PRESET_COMPAT_SESSION_PHASES = [
  'new_chat',
  'new_group_chat',
  'new_example_chat',
  'continue',
] as const

export type PresetCompatSessionPhase = (typeof PRESET_COMPAT_SESSION_PHASES)[number]

export type PresetCompatSessionWorkspaceSelection =
  | {
      kind: 'chapter'
      chapterId: string
    }
  | {
      kind: 'rewrite'
      nodeId: string
      continueBlockId: string
      anchorChapterNo: number
    }
  | {
      kind: 'continue_block'
      nodeId: string
      continueBlockId: string
      anchorChapterNo: number
    }
  | {
      kind: 'what_if'
      nodeId: string
      sessionId: string
      anchorChapterNo: number
    }
  | {
      kind: 'future_jump'
      nodeId: string
      runId: string
      sourceChapterNo: number
      targetChapterNo: number
    }
  | {
      kind: 'roleplay_session'
      nodeId: string
      roleplaySessionId: string
      anchorChapterNo: number
    }

export type PresetCompatSessionEntry = {
  surfaceId: PresetCompatSurfaceId
  phase: PresetCompatSessionPhase
  resetPending: boolean
}

export type PresetCompatSessionState = Record<string, PresetCompatSessionEntry>

export type PersistedNovelState = {
  currentNovelId: string
  currentChapterId: string
  currentTab: WorkspaceTab
  helperTab: HelperTab
  localNovels: LocalNovelMeta[]
  localChapters: Chapter[]
  localOutlines: OutlineItem[]
  localCharacters: Character[]
  localCharacterRelations: CharacterRelation[]
  localWorldEntries: WorldEntry[]
  localTimelineEvents: TimelineEvent[]
  rewriteCandidates: RewriteCandidate[]
  rewriteHistory: RewriteHistoryEntry[]
  trajectories: TrajectoryEntry[]
  rewriteMode: RewriteMode
  rewriteTone: RewriteTone
  rewriteOutput: RewriteOutput
  rewriteScope: RewriteScope
  selectionText: string
  selectedParagraphIndex: number | null
  thinkingLevel: ThoughtLevel
  autoContinue: boolean
  keepCanon: boolean
  promptText: string
  selectedPresetId: string
  presets: RewritePreset[]
  constraints: RewriteConstraint[]
  focusMode: boolean
  presetCompatSessionState: PresetCompatSessionState
  aiSettings?: AISettings
}
