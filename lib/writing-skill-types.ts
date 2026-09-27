export const WRITING_SKILL_CARD_STATUSES = ['ACTIVE', 'STALE', 'ARCHIVED'] as const
export type WritingSkillCardStatus = (typeof WRITING_SKILL_CARD_STATUSES)[number]

export const WRITING_SKILL_JOB_STATUSES = [
  'PENDING',
  'INSPECTING_LIBRARY',
  'SAMPLING_MATERIAL',
  'SCANNING_MATERIAL',
  'CHECKING_COVERAGE',
  'FETCHING_EVIDENCE',
  'DISTILLING_SKILL',
  'VALIDATING_RESULT',
  'SAVING_SKILL_CARD',
  'COMPLETED',
  'FAILED',
  'INSUFFICIENT_EVIDENCE',
  'CANCELLED',
] as const
export type DistillationJobStatus = (typeof WRITING_SKILL_JOB_STATUSES)[number]

export type ParagraphRangeRef = {
  libraryId: string
  libraryVersion: string
  workId: string
  chapterId: string
  startParagraphId: string
  endParagraphId: string
}

export const WRITING_SKILL_SOURCE_TYPES = ['LIBRARY', 'UPLOAD'] as const
export type WritingSkillSourceType = (typeof WRITING_SKILL_SOURCE_TYPES)[number]

export type WritingSkillSourceRef = {
  sourceType: WritingSkillSourceType
  sourceId: string
}

export type WritingSkillCardSource = WritingSkillSourceRef & {
  sourceVersion: string
  sourceName: string
  sourceOrder: number
}

export type WritingSkillMaterialSourceSummary = WritingSkillSourceRef & {
  title: string
  author: string | null
  chapterCount: number
  estimatedTokens: number
  createdAt: string | null
  updatedAt: string | null
}

export type MaterialParagraph = {
  id: string
  libraryId: string
  libraryVersion: string
  workId: string
  chapterId: string
  chapterIndex: number
  paragraphIndex: number
  anonymizedText: string
  estimatedTokens: number
  displayRef: string
}

export type WritingSkillRule = {
  text: string
  evidenceRefs: string[]
}

export type WritingSkillCard = {
  id: string
  libraryId: string
  libraryVersion: string
  libraryName: string
  title: string
  userInstruction: string
  summary: string
  applicationScope: string
  rules: WritingSkillRule[]
  avoid: string[]
  defaultExampleCount: number
  modelConfigId: string
  status: WritingSkillCardStatus
  sourceJobId: string | null
  createdAt: string
  updatedAt: string
  exampleCount?: number
  sources?: WritingSkillCardSource[]
}

export type WritingSkillExample = {
  id: string
  skillCardId: string
  rangeRef: ParagraphRangeRef
  displayRef: string
  score: number
  enabled: boolean
  createdAt: string
}

export type SampledRangeRecord = {
  round: number
  seed: number
  chapterIds: string[]
  displayRefs: string[]
  estimatedTokens: number
  mode: 'full' | 'sampled'
}

export type WritingSkillDistillationJob = {
  id: string
  libraryId: string
  libraryVersion: string | null
  userInstruction: string
  modelConfigId: string
  status: DistillationJobStatus
  message: string
  randomSeed: number
  roundCount: number
  sampledRanges: SampledRangeRecord[]
  candidateRefs: string[]
  candidateCount: number
  inputTokens: number
  outputTokens: number
  errorMessage: string | null
  resultCardId: string | null
  createdAt: string
  updatedAt: string
  card?: WritingSkillCard | null
}

export type MaterialScanResult = {
  normalizedTopic: string
  coverage: 'sufficient' | 'insufficient'
  candidates: Array<{
    startRef: string
    endRef: string
  }>
}

export type SkillDistillationResult = {
  title: string
  summary: string
  rules: WritingSkillRule[]
  applicationScope: string
  avoid: string[]
}

export type WritingSkillRuntimeRecord = {
  skillCardId: string
  exampleCount: number
  seed: number
  selectedExampleRefs: string[]
}

export type ResolvedSkillExample = WritingSkillExample & {
  anonymizedText: string
}

export type WritingSkillCardDetail = WritingSkillCard & {
  examples: Array<WritingSkillExample & {
    anonymizedText?: string | null
  }>
}
