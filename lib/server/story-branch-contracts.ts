import { z } from 'zod'

const positiveInt = z.number().int().positive()
const optionalNullableString = z.string().nullable().optional()
const optionalNullableInt = z.number().int().nonnegative().nullable().optional()
const writingSkillCardIds = z.array(z.string().trim().min(1)).default([]).transform((values) => Array.from(new Set(values)))
const writingSkillExampleCount = z.number().int().min(1).max(10).default(5)

export const timelineSelectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chapter'),
    chapterId: z.string().min(1),
    chapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('rewrite'),
    nodeId: z.string().min(1),
    continueBlockId: z.string().min(1),
    anchorChapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('continue_block'),
    nodeId: z.string().min(1),
    continueBlockId: z.string().min(1),
    anchorChapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('what_if'),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    anchorChapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('future_jump'),
    nodeId: z.string().min(1),
    runId: z.string().min(1),
    sourceChapterNo: positiveInt,
    targetChapterNo: positiveInt,
  }),
  z.object({
    kind: z.literal('roleplay_session'),
    nodeId: z.string().min(1),
    roleplaySessionId: z.string().min(1),
    anchorChapterNo: positiveInt,
  }),
])

export const roleplaySessionCreateSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  sourceChapterId: z.string().nullable(),
  sourceChapterNo: positiveInt,
  sourceChapterTitle: z.string().nullable().optional(),
  sourceTimelineNodeId: z.string().nullable().optional(),
  sourceTimelineNodeType: z.enum(['chapter', 'rewrite', 'continue_block', 'what_if', 'future_jump', 'roleplay_session']).nullable().optional(),
  sourceSelectedText: z.string(),
  sourceTextSnapshot: z.string(),
  sourceSelectedLineStart: optionalNullableInt,
  sourceSelectedLineEnd: optionalNullableInt,
  status: z.string().min(1).default('active'),
})

export const roleplayMessageCreateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  messageIndex: positiveInt,
  turnIndex: positiveInt,
  variantIndex: positiveInt.default(1),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  parentMessageId: z.string().nullable().optional(),
  forkedFromMessageId: z.string().nullable().optional(),
  variantGroupId: z.string().nullable().optional(),
  status: z.string().min(1).default('active'),
})

export const whatIfDeltaSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  deltaType: z.string().min(1),
  subjectName: z.string().nullable(),
  targetName: z.string().nullable(),
  subjectEntityId: z.string().nullable(),
  targetEntityId: z.string().nullable(),
  key: z.string().min(1),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  validFromChapter: positiveInt.nullable(),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().min(1),
})

export const whatIfSessionCreateSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  baseBranchId: z.string().min(1),
  sourceChapterNo: positiveInt,
  title: z.string().min(1),
  premise: z.string().min(1),
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string(),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  status: z.string().min(1).default('active'),
})

export const whatIfDeltaCreateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  deltaType: z.string().min(1),
  subjectName: optionalNullableString,
  targetName: optionalNullableString,
  subjectEntityId: optionalNullableString,
  targetEntityId: optionalNullableString,
  key: z.string().min(1),
  oldValue: optionalNullableString,
  newValue: optionalNullableString,
  validFromChapter: positiveInt.nullable().optional(),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
})

export const whatIfCreateRequestSchema = z.object({
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  sourceChapterNo: positiveInt,
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string().min(1),
  userInstruction: z.string().min(1),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  titleHint: z.string().nullable().optional(),
  subtitleHint: z.string().nullable().optional(),
})

export const whatIfDeltaExtractionSchema = z.object({
  deltas: z.array(z.object({
    delta_type: z.string().min(1),
    subject_name: optionalNullableString,
    target_name: optionalNullableString,
    key: z.string().min(1),
    old_value: optionalNullableString,
    new_value: optionalNullableString,
    valid_from_chapter: positiveInt.nullable().optional(),
    description: z.string().min(1),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })),
})

export const whatIfCreateResponseSchema = z.object({
  sessionId: z.string().min(1),
  timelineNodeId: z.string().min(1),
  generatedText: z.string().min(1),
  deltas: z.array(whatIfDeltaSchema).min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
})

export const futureJumpRevisionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  revisionNo: positiveInt,
  revisionKind: z.string().min(1),
  userFeedback: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  createdAt: z.string().min(1),
})

export const futureJumpRunCreateSchema = z.object({
  id: z.string().min(1),
  sourceTextSnapshot: z.string(),
  baseBranchId: z.string().min(1),
  parentTimelineNodeId: z.string().nullable(),
  sourceContext: z.object({
    nodeId: z.string().min(1).nullable(),
    nodeType: z.enum(['chapter', 'rewrite', 'continue_block', 'what_if', 'future_jump', 'roleplay_session']),
    chapterId: z.string().min(1).nullable(),
    chapterNo: positiveInt,
    whatIfSessionId: z.string().min(1).nullable(),
  }),
  targetOutlineNodeId: z.string().min(1),
  targetOutlineChapterId: z.string().min(1),
  sourceChapterNo: positiveInt,
  targetChapterNo: positiveInt,
  userDirection: z.string(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  latestRevisionNo: positiveInt.default(1),
  errorMessage: z.string().nullable().default(null),
  status: z.string().min(1),
})

export const futureJumpCreateRequestSchema = z.object({
  novelId: z.string().min(1),
  sourceContext: z.object({
    nodeId: z.string().min(1).nullable(),
    nodeType: z.enum(['chapter', 'rewrite', 'continue_block', 'what_if', 'future_jump', 'roleplay_session']),
    chapterId: z.string().min(1).nullable(),
    chapterNo: positiveInt,
    whatIfSessionId: z.string().min(1).nullable(),
  }).strict(),
  targetOutlineNodeId: z.string().min(1),
  targetOutlineChapterId: z.string().min(1),
  parentTimelineNodeId: z.string().nullable().optional(),
  userDirection: z.string().nullable().optional(),
}).strict()

export const futureJumpMutationResponseSchema = z.object({
  runId: z.string().min(1),
  timelineNodeId: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
  presetCompat: z.object({
    warnings: z.array(z.string()),
    promptAssembly: z.unknown(),
    fieldStatuses: z.array(z.unknown()),
    providerControlIntents: z.array(z.unknown()),
    contextWindow: z.unknown().nullable(),
    streamPolicy: z.unknown().nullable(),
  }).nullable().optional(),
})

export const futureJumpReviseRequestSchema = z.object({
  novelId: z.string().min(1),
  userFeedback: z.string().min(1),
})

export const futureJumpReviseSchema = z.object({
  runId: z.string().min(1),
  revisionKind: z.enum(['initial', 'revise', 'retry']),
  userFeedback: z.string().nullable(),
  bridgeSummary: z.string().min(1),
  generatedTargetText: z.string().min(1),
})

export const continueBlockRevisionSchema = z.object({
  id: z.string().min(1),
  continueBlockId: z.string().min(1),
  revisionNo: positiveInt,
  revisionKind: z.string().min(1),
  userInstruction: z.string(),
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string().min(1),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  createdAt: z.string().min(1),
})

export const continueBlockCreateRequestSchema = z.object({
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  sourceChapterNo: positiveInt,
  parentTimelineNodeId: z.string().nullable().optional(),
  selectedText: z.string(),
  originalText: z.string(),
  generatedText: z.string().min(1),
  userInstruction: z.string().min(1),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  writingSkillCardIds,
  writingSkillExampleCount,
  titleHint: z.string().nullable().optional(),
  subtitleHint: z.string().nullable().optional(),
})

export const continueBlockRegenerateRequestSchema = z.object({
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  continueBlockId: z.string().min(1),
  generatedText: z.string().min(1),
  userInstruction: z.string().min(1),
  selectedText: z.string(),
  originalText: z.string(),
  inputTokens: optionalNullableInt,
  outputTokens: optionalNullableInt,
  writingSkillCardIds,
  writingSkillExampleCount,
  titleHint: z.string().nullable().optional(),
  subtitleHint: z.string().nullable().optional(),
})

export const continueBlockMutationResponseSchema = z.object({
  continueBlockId: z.string().min(1),
  timelineNodeId: z.string().min(1),
  nodeType: z.enum(['rewrite', 'continue_block']),
  readableLabel: z.string().min(1).optional(),
  readableLineageLabel: z.string().min(1).optional(),
  generatedText: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  latestRevisionNo: positiveInt,
  writingSkillCardIds,
  writingSkillExampleCount,
})

export const bridgeSummaryGenerationSchema = z.object({
  bridgeSummary: z.string().min(1),
})

export const targetRewriteGenerationSchema = z.object({
  generatedTargetText: z.string().min(1),
  titleHint: z.string().min(1).optional(),
  subtitleHint: z.string().min(1).optional(),
})
