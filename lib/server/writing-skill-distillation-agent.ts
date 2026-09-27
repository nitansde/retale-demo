import { randomBytes } from 'node:crypto'
import {
  WRITING_SKILL_DEFAULTS,
  calculateWritingSkillScanChunkBudget,
  normalizeWritingSkillContextWindow,
  normalizeWritingSkillTotalBudget,
  resolveWritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'
import type { MaterialScanResult, SkillDistillationResult } from '@/lib/writing-skill-types'
import {
  compileEvidenceMaterial,
  compileNumberedMaterial,
  deriveWritingSkillRoundSeed,
  loadMaterialLibrary,
  mergeWritingSkillCandidateRanges,
  resolveMaterialRange,
  sampleWritingSkillMaterial,
  toSampledRangeRecord,
  validateWritingSkillScanResult,
  type MaterialLibrary,
  type ValidatedCandidateRange,
} from '@/lib/server/writing-skill-material'
import {
  loadWritingSkillMaterialCollection,
  normalizeWritingSkillSourceRefs,
} from '@/lib/server/writing-skill-sources'
import {
  ConfiguredWritingSkillModelGateway,
  isWritingSkillContextLimitError,
  type ModelGateway,
  type StructuredGenerationResult,
} from '@/lib/server/writing-skill-model-gateway'
import {
  buildMaterialScanPrompt,
  buildMaterialScanJsonSchema,
  buildMaterialScanRuntimeSchema,
  buildSkillDistillationJsonSchema,
  buildSkillDistillationPrompt,
  buildSkillDistillationRuntimeSchema,
  normalizeMaterialScanParsedOutput,
} from '@/lib/server/writing-skill-prompts'
import {
  markWritingSkillCardsStaleForLibraryVersion,
  readWritingSkillCardDetail,
  readWritingSkillJob,
  readWritingSkillJobRequest,
  saveWritingSkillCard,
  updateWritingSkillJob,
  type WritingSkillStoreDb,
} from '@/lib/server/writing-skill-store'

class InsufficientWritingSkillEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsufficientWritingSkillEvidenceError'
  }
}

class CancelledWritingSkillJobError extends Error {
  constructor() {
    super('Writing skill job cancelled')
    this.name = 'CancelledWritingSkillJobError'
  }
}

export function createWritingSkillRandomSeed() {
  return randomBytes(4).readUInt32BE(0) & 0x7fffffff
}

function normalizeValidatedDistillationResult(input: {
  result: SkillDistillationResult
  library: MaterialLibrary
}) {
  const rules = input.result.rules.map((rule) => ({
    text: rule.text.trim(),
    evidenceRefs: Array.from(new Set(rule.evidenceRefs.map((ref) => (
      resolveMaterialRange(input.library, ref)?.displayRef ?? ref.trim()
    )))),
  }))
  return { ...input.result, rules }
}

function candidateFromDisplayRef(
  library: MaterialLibrary,
  displayRef: string,
) {
  const resolved = resolveMaterialRange(library, displayRef)
  if (!resolved) return null
  return {
    rangeRef: resolved.rangeRef,
    displayRef: resolved.displayRef,
    chapterId: resolved.start.chapterId,
    chapterIndex: resolved.start.chapterIndex,
    startParagraphIndex: resolved.start.paragraphIndex,
    endParagraphIndex: resolved.end.paragraphIndex,
  } satisfies ValidatedCandidateRange
}

export class WritingSkillDistillationAgent {
  constructor(private readonly dependencies: {
    gateway?: ModelGateway
    db?: WritingSkillStoreDb
    loadLibrary?: (libraryId: string) => MaterialLibrary
  } = {}) {}

  private get gateway() {
    return this.dependencies.gateway ?? new ConfiguredWritingSkillModelGateway()
  }

  private loadLibrary(libraryId: string) {
    return (this.dependencies.loadLibrary ?? loadMaterialLibrary)(libraryId)
  }

  private assertActive(jobId: string) {
    const job = readWritingSkillJob(jobId, this.dependencies.db)
    if (!job || job.status === 'CANCELLED') throw new CancelledWritingSkillJobError()
    return job
  }

  async run(jobId: string) {
    const initialJob = readWritingSkillJob(jobId, this.dependencies.db)
    if (!initialJob) throw new Error('Writing skill distillation job not found')
    if (initialJob.status === 'CANCELLED') return initialJob
    const request = readWritingSkillJobRequest(jobId, this.dependencies.db) ?? {}
    const replaceCardId = typeof request.replaceCardId === 'string' ? request.replaceCardId.trim() : ''
    const refineInstruction = typeof request.refineInstruction === 'string'
      ? request.refineInstruction.trim()
      : ''
    let inputTokens = initialJob.inputTokens
    let outputTokens = initialJob.outputTokens

    try {
      updateWritingSkillJob(jobId, {
        status: 'INSPECTING_LIBRARY',
        message: refineInstruction ? '正在准备上次保存的素材片段……' : '正在检查素材库……',
        errorMessage: null,
      }, this.dependencies.db)
      const sourceRefs = normalizeWritingSkillSourceRefs(request.sourceRefs)
      const materialSelection = sourceRefs.length
        ? loadWritingSkillMaterialCollection(sourceRefs, {
            db: this.dependencies.db,
            loadLibrary: (libraryId) => this.loadLibrary(libraryId),
          })
        : (() => {
            const library = this.loadLibrary(initialJob.libraryId)
            return {
              library,
              sources: [{
                sourceType: 'LIBRARY' as const,
                sourceId: library.id,
                sourceVersion: library.version,
                sourceName: library.name,
                sourceOrder: 0,
              }],
            }
          })()
      const { library, sources } = materialSelection
      markWritingSkillCardsStaleForLibraryVersion(library.id, library.version, this.dependencies.db)
      updateWritingSkillJob(jobId, { libraryVersion: library.version }, this.dependencies.db)
      this.assertActive(jobId)

      let candidates: ValidatedCandidateRange[] = []
      let hasSufficientCoverage = Boolean(refineInstruction)
      const sampledRanges = initialJob.sampledRanges.slice()

      if (refineInstruction) {
        const existing = replaceCardId ? readWritingSkillCardDetail(replaceCardId, this.dependencies.db) : null
        if (!existing) throw new Error('要调整的写作技巧卡不存在')
        if (existing.libraryId !== library.id || existing.libraryVersion !== library.version) {
          throw new InsufficientWritingSkillEvidenceError('已有技巧卡的素材版本已经过期，请使用“换一批素材重做”')
        }
        const sourceJob = existing.sourceJobId
          ? readWritingSkillJob(existing.sourceJobId, this.dependencies.db)
          : null
        const cachedCandidateRefs = sourceJob?.libraryVersion === library.version
          ? sourceJob.candidateRefs
          : []
        const refs = Array.from(new Set([
          ...cachedCandidateRefs,
          ...existing.examples.map((example) => example.displayRef),
          ...existing.rules.flatMap((rule) => rule.evidenceRefs),
        ]))
        candidates = mergeWritingSkillCandidateRanges(
          refs.map((ref) => candidateFromDisplayRef(library, ref)).filter((candidate): candidate is ValidatedCandidateRange => candidate !== null),
        )
        if (candidates.length < WRITING_SKILL_DEFAULTS.minCandidates) {
          throw new InsufficientWritingSkillEvidenceError('已有证据不足以安全调整，请使用“换一批素材重做”')
        }
        updateWritingSkillJob(jobId, {
          roundCount: 0,
          candidateRefs: candidates.map((candidate) => candidate.displayRef),
        }, this.dependencies.db)
      } else {
        const capabilities = await this.gateway.getCapabilities(initialJob.modelConfigId)
        const scanContextWindow = normalizeWritingSkillContextWindow(request.scanContextWindow)
        const scanTotalBudget = normalizeWritingSkillTotalBudget(request.scanTotalBudget)
        const scanChunkBudget = calculateWritingSkillScanChunkBudget(capabilities, scanContextWindow)
        const totalScanBudget = resolveWritingSkillTotalBudget(scanTotalBudget)
        if (scanChunkBudget <= 0) throw new Error('当前模型上下文不足以执行素材扫描')
        const excludedChapterIds = new Set<string>()
        let scannedTokens = 0
        let effectiveScanChunkBudget = scanChunkBudget
        for (let round = 1; round <= WRITING_SKILL_DEFAULTS.maxScanRounds; round += 1) {
          this.assertActive(jobId)
          const remainingBudget = totalScanBudget === null
            ? effectiveScanChunkBudget
            : Math.min(effectiveScanChunkBudget, totalScanBudget - scannedTokens)
          if (remainingBudget <= 0) break
          const roundSeed = deriveWritingSkillRoundSeed(initialJob.randomSeed, round)
          updateWritingSkillJob(jobId, {
            status: 'SAMPLING_MATERIAL',
            message: round === 1 ? '正在阅读选中的章节……' : `正在换一批素材继续寻找（第 ${round} 轮）……`,
          }, this.dependencies.db)
          let attemptBudget = remainingBudget
          let sample = sampleWritingSkillMaterial({
            library,
            tokenBudget: attemptBudget,
            seed: roundSeed,
            excludedChapterIds: Array.from(excludedChapterIds),
          })
          if (!sample.paragraphs.length) break
          let scan: StructuredGenerationResult<MaterialScanResult> | null = null
          let validRoundCandidates: ValidatedCandidateRange[] = []
          for (let attempt = 1; attempt <= WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries; attempt += 1) {
            updateWritingSkillJob(jobId, {
              status: 'SCANNING_MATERIAL',
              message: attempt === 1
                ? '正在从素材库中寻找相关写法……'
                : `正在缩小本轮素材继续查找（第 ${attempt} 次）……`,
            }, this.dependencies.db)
            const prompt = buildMaterialScanPrompt({
              userInstruction: initialJob.userInstruction,
              numberedMaterial: compileNumberedMaterial(sample.paragraphs),
            })
            const allowedRefs = sample.paragraphs.map((paragraph) => paragraph.displayRef)
            try {
              scan = await this.gateway.generateStructured<MaterialScanResult>({
                modelConfigId: initialJob.modelConfigId,
                messages: [
                  { role: 'system', content: prompt.system },
                  { role: 'user', content: prompt.user },
                ],
                schemaName: 'writing_skill_material_scan',
                schema: buildMaterialScanJsonSchema(allowedRefs) as unknown as Record<string, unknown>,
                runtimeSchema: buildMaterialScanRuntimeSchema(allowedRefs),
                normalizeParsedOutput: (value) => normalizeMaterialScanParsedOutput(value, allowedRefs),
                maxOutputTokens: 0,
                temperature: WRITING_SKILL_DEFAULTS.scanTemperature,
              })
            } catch (error) {
              const nextBudget = Math.floor(attemptBudget / 2)
              if (
                !isWritingSkillContextLimitError(error)
                || attempt >= WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries
                || nextBudget < WRITING_SKILL_DEFAULTS.minAdaptiveScanBudget
              ) {
                throw error
              }
              attemptBudget = nextBudget
              effectiveScanChunkBudget = Math.min(effectiveScanChunkBudget, attemptBudget)
              sample = sampleWritingSkillMaterial({
                library,
                tokenBudget: attemptBudget,
                seed: roundSeed,
                excludedChapterIds: Array.from(excludedChapterIds),
              })
              if (!sample.paragraphs.length) throw error
              continue
            }
            inputTokens += scan.usage.inputTokens
            outputTokens += scan.usage.outputTokens
            scannedTokens += sample.estimatedTokens
            const attemptCandidates = validateWritingSkillScanResult({
              library,
              sample,
              result: scan.data,
            })
            validRoundCandidates = mergeWritingSkillCandidateRanges([
              ...validRoundCandidates,
              ...attemptCandidates,
            ])
            const totalRemaining = totalScanBudget === null
              ? Number.POSITIVE_INFINITY
              : totalScanBudget - scannedTokens
            const nextBudget = Math.min(Math.floor(attemptBudget / 2), totalRemaining)
            const shouldRetryEmptyLargeSample = validRoundCandidates.length === 0
              && sample.estimatedTokens >= WRITING_SKILL_DEFAULTS.zeroCandidateRetryThreshold
              && attempt < WRITING_SKILL_DEFAULTS.maxAdaptiveScanRetries
              && nextBudget >= WRITING_SKILL_DEFAULTS.minAdaptiveScanBudget
            if (!shouldRetryEmptyLargeSample) break
            attemptBudget = nextBudget
            effectiveScanChunkBudget = Math.min(effectiveScanChunkBudget, attemptBudget)
            sample = sampleWritingSkillMaterial({
              library,
              tokenBudget: attemptBudget,
              seed: roundSeed,
              excludedChapterIds: Array.from(excludedChapterIds),
            })
            if (!sample.paragraphs.length) break
          }
          if (!scan) throw new Error('素材扫描未返回有效结果')
          sampledRanges.push(toSampledRangeRecord(sample, round, roundSeed))
          updateWritingSkillJob(jobId, { roundCount: round, sampledRanges }, this.dependencies.db)
          candidates = mergeWritingSkillCandidateRanges([...candidates, ...validRoundCandidates])
          hasSufficientCoverage ||= scan.data.coverage === 'sufficient'
          updateWritingSkillJob(jobId, {
            status: 'CHECKING_COVERAGE',
            message: `已累计阅读约 ${scannedTokens.toLocaleString()} token，找到 ${candidates.length} 组相关段落……`,
            candidateRefs: candidates.map((candidate) => candidate.displayRef),
            inputTokens,
            outputTokens,
          }, this.dependencies.db)
          for (const chapterId of sample.chapterIds) excludedChapterIds.add(chapterId)
          if (sample.mode === 'full') break
        }
      }

      const minimumRequiredCandidates = WRITING_SKILL_DEFAULTS.minCandidates
      if (!hasSufficientCoverage || candidates.length < minimumRequiredCandidates) {
        throw new InsufficientWritingSkillEvidenceError(
          `这个素材库中没有找到足够多与“${initialJob.userInstruction}”相关的代表性内容。可以换一个方向，或者换一批素材重新尝试。`,
        )
      }
      this.assertActive(jobId)
      updateWritingSkillJob(jobId, {
        status: 'FETCHING_EVIDENCE',
        message: refineInstruction
          ? `正在复用上次保存的 ${candidates.length} 组素材片段……`
          : '正在读取代表性段落……',
        candidateRefs: candidates.map((candidate) => candidate.displayRef),
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      const evidenceRanges = candidates
      const allowedEvidenceRefs = evidenceRanges.map((candidate) => candidate.displayRef)
      const evidenceMaterial = compileEvidenceMaterial(library, evidenceRanges)

      const distill = async () => {
        updateWritingSkillJob(jobId, {
          status: 'DISTILLING_SKILL',
          message: refineInstruction ? '正在按要求调整写作技巧……' : '正在整理写作技巧……',
        }, this.dependencies.db)
        const prompt = buildSkillDistillationPrompt({
          libraryName: library.name,
          userInstruction: initialJob.userInstruction,
          evidenceMaterial,
          refineInstruction,
        })
        const generated = await this.gateway.generateStructured<SkillDistillationResult>({
          modelConfigId: initialJob.modelConfigId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          schemaName: 'writing_skill_distillation',
          schema: buildSkillDistillationJsonSchema(allowedEvidenceRefs) as unknown as Record<string, unknown>,
          runtimeSchema: buildSkillDistillationRuntimeSchema(allowedEvidenceRefs),
          maxOutputTokens: 0,
          temperature: WRITING_SKILL_DEFAULTS.distillTemperature,
        })
        inputTokens += generated.usage.inputTokens
        outputTokens += generated.usage.outputTokens
        return normalizeValidatedDistillationResult({
          result: generated.data,
          library,
        })
      }

      const result = await distill()

      this.assertActive(jobId)
      updateWritingSkillJob(jobId, {
        status: 'SAVING_SKILL_CARD',
        message: '正在保存写作技巧卡……',
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      const examples = evidenceRanges.flatMap((candidate) => {
        const resolved = resolveMaterialRange(library, candidate.displayRef)
        return resolved ? [{
          rangeRef: resolved.rangeRef,
          displayRef: resolved.displayRef,
          score: 1,
        }] : []
      })
      const card = await saveWritingSkillCard({
        libraryId: library.id,
        libraryVersion: library.version,
        libraryName: library.name,
        userInstruction: initialJob.userInstruction,
        modelConfigId: initialJob.modelConfigId,
        sourceJobId: jobId,
        result,
        examples,
        sources,
        replaceCardId: replaceCardId || null,
      }, this.dependencies.db)
      updateWritingSkillJob(jobId, {
        status: 'COMPLETED',
        message: '写作技巧卡已完成',
        resultCardId: card.id,
        inputTokens,
        outputTokens,
        errorMessage: null,
      }, this.dependencies.db)
      return readWritingSkillJob(jobId, this.dependencies.db)!
    } catch (error) {
      if (error instanceof CancelledWritingSkillJobError) {
        return readWritingSkillJob(jobId, this.dependencies.db)
      }
      if (error instanceof InsufficientWritingSkillEvidenceError) {
        updateWritingSkillJob(jobId, {
          status: 'INSUFFICIENT_EVIDENCE',
          message: error.message,
          errorMessage: error.message,
          inputTokens,
          outputTokens,
        }, this.dependencies.db)
        return readWritingSkillJob(jobId, this.dependencies.db)
      }
      const message = error instanceof Error ? error.message : '写作技巧蒸馏失败'
      updateWritingSkillJob(jobId, {
        status: 'FAILED',
        message: '写作技巧蒸馏失败',
        errorMessage: message,
        inputTokens,
        outputTokens,
      }, this.dependencies.db)
      return readWritingSkillJob(jobId, this.dependencies.db)
    }
  }
}
