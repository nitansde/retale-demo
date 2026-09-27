import { z } from 'zod'
import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'

export const materialScanResultSchema = z.object({
  normalizedTopic: z.string().trim().min(1).max(120),
  coverage: z.enum(['sufficient', 'insufficient']),
  candidates: z.array(z.object({
    startRef: z.string().trim().min(1).max(40),
    endRef: z.string().trim().min(1).max(40),
  }).strict()).max(WRITING_SKILL_DEFAULTS.maxCandidatesPerRound),
}).strict()

export const skillDistillationResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(100).max(400),
  rules: z.array(z.object({
    text: z.string().trim().min(1).max(240),
    evidenceRefs: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  }).strict()).min(4).max(8),
  applicationScope: z.string().trim().min(20).max(400),
  avoid: z.array(z.string().trim().min(1).max(180)).min(2).max(5),
}).strict()

export const MATERIAL_SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['normalizedTopic', 'coverage', 'candidates'],
  properties: {
    normalizedTopic: { type: 'string', minLength: 1, maxLength: 120 },
    coverage: { type: 'string', enum: ['sufficient', 'insufficient'] },
    candidates: {
      type: 'array',
      maxItems: WRITING_SKILL_DEFAULTS.maxCandidatesPerRound,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startRef', 'endRef'],
        properties: {
          startRef: { type: 'string' },
          endRef: { type: 'string' },
        },
      },
    },
  },
} as const

function uniqueMaterialRefs(allowedRefs: string[]) {
  return Array.from(new Set(allowedRefs.map((ref) => ref.trim().toUpperCase()).filter(Boolean)))
}

function formatLooseMaterialRef(workIndex: number, chapterIndex: number, paragraphIndex: number) {
  if (workIndex < 1 || chapterIndex < 1 || paragraphIndex < 1) return null
  return `W${String(workIndex).padStart(2, '0')}-C${String(chapterIndex).padStart(3, '0')}-P${String(paragraphIndex).padStart(3, '0')}`
}

function normalizeLooseMaterialRef(value: unknown, allowedRefs: string[]) {
  if (typeof value !== 'string') return null
  const allowed = new Set(allowedRefs)
  const cleaned = value
    .trim()
    .replace(/^[\[【`'\"]+|[\]】`'\"]+$/g, '')
    .replace(/[‐‑‒–—﹘﹣－]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (allowed.has(cleaned)) return cleaned

  const full = cleaned.match(/^W0*(\d+)[-_:]?C0*(\d+)[-_:]?P0*(\d+)$/)
  if (full) {
    const formatted = formatLooseMaterialRef(
      Number.parseInt(full[1], 10),
      Number.parseInt(full[2], 10),
      Number.parseInt(full[3], 10),
    )
    return formatted && allowed.has(formatted) ? formatted : null
  }

  const withoutWork = cleaned.match(/^C0*(\d+)[-_:]?P0*(\d+)$/)
  if (!withoutWork) return null
  const suffix = `-C${String(Number.parseInt(withoutWork[1], 10)).padStart(3, '0')}-P${String(Number.parseInt(withoutWork[2], 10)).padStart(3, '0')}`
  const matches = allowedRefs.filter((ref) => ref.endsWith(suffix))
  return matches.length === 1 ? matches[0] : null
}

export function normalizeMaterialScanParsedOutput(value: unknown, allowedRefs: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.candidates)) return value
  const refs = uniqueMaterialRefs(allowedRefs)
  const candidates = record.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [candidate]
    const candidateRecord = candidate as Record<string, unknown>
    const startRef = normalizeLooseMaterialRef(candidateRecord.startRef, refs)
    const endRef = normalizeLooseMaterialRef(candidateRecord.endRef, refs)
    if (!startRef || !endRef) return []
    return [{ ...candidateRecord, startRef, endRef }]
  })
  return {
    ...record,
    coverage: record.coverage === 'sufficient' && candidates.length === 0
      ? 'insufficient'
      : record.coverage,
    candidates,
  }
}

export function buildMaterialScanJsonSchema(allowedRefs: string[]) {
  const refs = uniqueMaterialRefs(allowedRefs)
  if (refs.length > 128) return MATERIAL_SCAN_JSON_SCHEMA
  return {
    ...MATERIAL_SCAN_JSON_SCHEMA,
    properties: {
      ...MATERIAL_SCAN_JSON_SCHEMA.properties,
      candidates: {
        ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates,
        items: {
          ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates.items,
          properties: {
            ...MATERIAL_SCAN_JSON_SCHEMA.properties.candidates.items.properties,
            startRef: { type: 'string', enum: refs },
            endRef: { type: 'string', enum: refs },
          },
        },
      },
    },
  }
}

export function buildMaterialScanRuntimeSchema(allowedRefs: string[]) {
  const refs = new Set(uniqueMaterialRefs(allowedRefs))
  return materialScanResultSchema.superRefine((result, context) => {
    if (result.coverage === 'sufficient' && result.candidates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'coverage 为 sufficient 时必须返回至少一组候选段落',
      })
    }
    for (const [index, candidate] of result.candidates.entries()) {
      if (!refs.has(candidate.startRef.trim().toUpperCase())) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'startRef'],
          message: '必须逐字使用输入中存在的段落编号',
        })
      }
      if (!refs.has(candidate.endRef.trim().toUpperCase())) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'endRef'],
          message: '必须逐字使用输入中存在的段落编号',
        })
      }
    }
  })
}

export const SKILL_DISTILLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'rules',
    'applicationScope',
    'avoid',
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 100, maxLength: 400 },
    rules: {
      type: 'array',
      minItems: 4,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidenceRefs'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 240 },
          evidenceRefs: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'string' },
          },
        },
      },
    },
    applicationScope: { type: 'string', minLength: 20, maxLength: 400 },
    avoid: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 180 },
    },
  },
} as const

function uniqueAllowedEvidenceRefs(allowedEvidenceRefs: string[]) {
  return Array.from(new Set(allowedEvidenceRefs.map((ref) => ref.trim()).filter(Boolean)))
}

export function buildSkillDistillationJsonSchema(allowedEvidenceRefs: string[]) {
  const allowedRefs = uniqueAllowedEvidenceRefs(allowedEvidenceRefs)
  return {
    ...SKILL_DISTILLATION_JSON_SCHEMA,
    properties: {
      ...SKILL_DISTILLATION_JSON_SCHEMA.properties,
      rules: {
        ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules,
        items: {
          ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items,
          properties: {
            ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items.properties,
            evidenceRefs: {
              ...SKILL_DISTILLATION_JSON_SCHEMA.properties.rules.items.properties.evidenceRefs,
              items: { type: 'string', enum: allowedRefs },
            },
          },
        },
      },
    },
  }
}

export function buildSkillDistillationRuntimeSchema(allowedEvidenceRefs: string[]) {
  const allowedRefs = new Set(uniqueAllowedEvidenceRefs(allowedEvidenceRefs))
  return skillDistillationResultSchema.superRefine((result, context) => {
    for (const [ruleIndex, rule] of result.rules.entries()) {
      for (const [refIndex, ref] of rule.evidenceRefs.entries()) {
        if (!allowedRefs.has(ref)) {
          context.addIssue({
            code: 'custom',
            path: ['rules', ruleIndex, 'evidenceRefs', refIndex],
            message: `必须使用允许的核心证据范围编号：${Array.from(allowedRefs).join(', ')}`,
          })
        }
      }
    }
  })
}

export function buildMaterialScanPrompt(input: {
  userInstruction: string
  numberedMaterial: string
}) {
  return {
    system: [
      '你是一个小说写作素材分析器。',
      '用户会给出一个希望提炼的写作方向，以及一批带有稳定段落编号的匿名化小说文本。',
      '你的任务是找出真正体现该写作方向的代表性段落。',
      '要求：',
      '1. 根据语义理解用户方向，不要只进行字面关键词匹配。',
      '2. 选择真正体现该方向的代表性原文片段，不要选择只在背景中偶然提及该方向的段落。',
      '3. 只返回片段的起止段落编号，不需要标签、分类或解释。',
      '4. 不得引用、复述或改写任何素材原文。',
      '5. 不得返回输入中不存在的段落编号。',
      '5.1 startRef 和 endRef 必须只复制方括号中的完整编号，例如 [W01-C021-P006] 应填写 W01-C021-P006；不要省略 W、C、P，不要自行改写编号。无法确认精确编号时应舍弃该候选。',
      '6. 如果素材中缺少足够证据，应明确返回 insufficient。',
      `6.1 素材充足时至少返回 ${WRITING_SKILL_DEFAULTS.minCandidates} 组、最多返回 ${WRITING_SKILL_DEFAULTS.maxCandidatesPerRound} 组代表性片段。`,
      '7. 不要补充通用写作知识。',
      '8. 候选范围要紧凑，只包含完成该写作动作所必需的连续段落。',
      `9. 最多返回 ${WRITING_SKILL_DEFAULTS.maxCandidatesPerRound} 组候选范围。`,
      '只输出符合指定 JSON Schema 的 JSON 对象。',
    ].join('\n'),
    user: [
      '用户希望提炼的写作方向：',
      input.userInstruction,
      '',
      '以下是匿名化素材：',
      input.numberedMaterial,
    ].join('\n'),
  }
}

export function buildSkillDistillationPrompt(input: {
  libraryName: string
  userInstruction: string
  evidenceMaterial: string
  refineInstruction?: string | null
}) {
  return {
    system: [
      '你是一个小说写作技巧蒸馏器。',
      '用户指定了一个写作方向。你将收到一组已经筛选过的匿名化小说段落，每组都有稳定的段落编号。',
      '请从这些素材中总结该素材库实际使用的写作方法。',
      '要求：',
      '1. 所有结论必须来自给定素材。',
      '2. 不要补充与素材无关的通用写作建议。',
      '3. 每条主要技巧必须引用至少一个证据段落编号。',
      '4. 优先总结在多个独立片段中重复出现的方法。',
      '5. 可以总结结构、细节选择、叙事顺序、修辞方式、动作与情绪之间的关系。',
      '6. 不得引用、复述或改写素材原文。',
      '7. 第一阶段筛选出的全部核心候选都会直接保存为参考范文，你不需要再次选择、排序或评分。',
      '8. evidenceRefs 只能逐字复制 EVIDENCE 标题中的核心候选范围编号；不得引用 CONTEXT 段落，也不得自行缩写或拆分范围。',
      '9. 避免将作品中的人物、设定或剧情当成写作技巧。',
      '10. 输出应当可以直接插入另一本小说的魔改 Prompt。',
      '11. summary 为 100–400 字，rules 为 4–8 条，avoid 为 2–5 条。',
      `12. 围绕用户指定的方向“${input.userInstruction}”总结。`,
      '只输出符合指定 JSON Schema 的 JSON 对象。',
    ].join('\n'),
    user: [
      '素材库名称：',
      input.libraryName,
      '',
      '用户希望提炼的方向：',
      input.userInstruction,
      ...(input.refineInstruction?.trim()
        ? ['', '用户希望这样调整现有技巧：', input.refineInstruction.trim(), '请仍然只使用下面已有证据。']
        : []),
      '',
      '候选素材：',
      input.evidenceMaterial,
    ].join('\n'),
  }
}

export function buildPlainJsonStructuredOutputInstruction(schema: Record<string, unknown>) {
  return [
    '当前模型不保证原生结构化输出。',
    '请只返回一个合法 JSON 对象，不要使用 Markdown 代码块，不要输出解释。',
    '请使用紧凑 JSON，避免无意义的缩进、空白和换行，以免输出被截断。',
    'JSON 必须满足以下 Schema：',
    JSON.stringify(schema),
  ].join('\n')
}
