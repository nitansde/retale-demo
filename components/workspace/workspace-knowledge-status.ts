import { formatProgressMessage } from '@/lib/i18n/progress-message'
import { tm } from '@/lib/i18n/messages'
import type {
  KnowledgeChapterCoverageOverview,
  KnowledgeRebuildStatus,
  KnowledgeStatusOverview,
  RetrievalIndexCoverageOverview,
} from '@/components/workspace/selection-novel-studio-helpers'

export type WorkspaceKnowledgeOverallStatus =
  | 'loading'
  | 'not_ready'
  | 'analysis_ready_search_not_ready'
  | 'ready'
  | 'partial'

export type WorkspaceKnowledgeAnalysisStatus = 'not_ready' | 'partial' | 'ready'
export type WorkspaceKnowledgeSearchStatus = 'not_ready' | 'pending' | 'partial' | 'ready'
export type WorkspaceKnowledgeStage = 'analysis' | 'search'
export type WorkspaceKnowledgeOperationStatus = 'queued' | 'running' | 'paused' | 'failed'

export type WorkspaceKnowledgeCoverage =
  | { kind: 'all'; count: number }
  | { kind: 'through'; chapter: number }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'count'; covered: number; total: number }
  | { kind: 'partial' }
  | null

export type WorkspaceKnowledgeOperation = {
  jobId: string
  stage: WorkspaceKnowledgeStage
  status: WorkspaceKnowledgeOperationStatus
  phaseLabel: string | null
  progressPercent: number | null
  progressSource: 'phase' | 'job' | null
}

export type WorkspaceKnowledgeStatus = {
  overall: WorkspaceKnowledgeOverallStatus
  analysis: WorkspaceKnowledgeAnalysisStatus
  search: WorkspaceKnowledgeSearchStatus
  analysisCoverage: WorkspaceKnowledgeCoverage
  searchCoverage: WorkspaceKnowledgeCoverage
  operation: WorkspaceKnowledgeOperation | null
  analysisResultsUsable: boolean
  searchResultsUsable: boolean
  searchMayBeStale: boolean
}

function mapAnalysisStatus(overview: KnowledgeStatusOverview | null): WorkspaceKnowledgeAnalysisStatus {
  if (overview?.knowledgeGraph.status === 'full') return 'ready'
  if (overview?.knowledgeGraph.status === 'partial') return 'partial'
  return 'not_ready'
}

function mapSearchStatus(overview: KnowledgeStatusOverview | null): WorkspaceKnowledgeSearchStatus {
  if (overview?.retrievalIndex.status === 'full') return 'ready'
  if (overview?.retrievalIndex.status === 'pending') return 'pending'
  if (overview?.retrievalIndex.status === 'partial') return 'partial'
  return 'not_ready'
}

function mapGraphCoverage(coverage: KnowledgeChapterCoverageOverview | null | undefined): WorkspaceKnowledgeCoverage {
  if (!coverage || coverage.totalChapterCount <= 0 || coverage.status === 'missing') return null
  if (coverage.status === 'full') return { kind: 'all', count: coverage.totalChapterCount }
  if (coverage.validThroughChapterNo !== null) return { kind: 'through', chapter: coverage.validThroughChapterNo }
  return { kind: 'count', covered: coverage.coveredChapterCount, total: coverage.totalChapterCount }
}

function mapRetrievalCoverage(
  coverage: RetrievalIndexCoverageOverview | null | undefined,
  totalChapterCount: number | null | undefined,
): WorkspaceKnowledgeCoverage {
  if (!coverage || coverage.status === 'missing' || coverage.status === 'pending') return null
  if (coverage.status === 'full' && totalChapterCount && totalChapterCount > 0) {
    return { kind: 'all', count: totalChapterCount }
  }
  if (coverage.chapterRange?.endChapter) {
    const start = coverage.chapterRange.startChapter ?? 1
    return start <= 1
      ? { kind: 'through', chapter: coverage.chapterRange.endChapter }
      : { kind: 'range', start, end: coverage.chapterRange.endChapter }
  }
  return coverage.status === 'partial' ? { kind: 'partial' } : null
}

function operationPriority(status: string) {
  if (status === 'running') return 4
  if (status === 'queued') return 3
  if (status === 'paused') return 2
  if (status === 'failed') return 1
  return 0
}

function resolveOperation(
  topLevelJob: KnowledgeRebuildStatus | null | undefined,
  retrievalTask: KnowledgeRebuildStatus | null | undefined,
  translate: typeof tm,
): WorkspaceKnowledgeOperation | null {
  const jobs = [topLevelJob, retrievalTask]
    .filter((job): job is KnowledgeRebuildStatus => Boolean(job))
    .filter((job, index, all) => all.findIndex((candidate) => candidate.jobId === job.jobId) === index)
    .filter((job) => operationPriority(job.status) > 0)
    .sort((left, right) => operationPriority(right.status) - operationPriority(left.status))
  const job = jobs[0]
  if (!job) return null

  const activeStep = job.steps.find((step) => step.status === 'running') ?? null
  const phaseLabel = formatProgressMessage(activeStep?.detail?.trim() || activeStep?.label || job.currentStep, translate)
  let progressPercent: number | null = null
  let progressSource: WorkspaceKnowledgeOperation['progressSource'] = null

  if (job.status === 'running' && activeStep) {
    progressPercent = Number.isFinite(activeStep.progress)
      ? Math.max(0, Math.min(100, Math.round(activeStep.progress * 100)))
      : null
    progressSource = progressPercent === null ? null : 'phase'
  } else if (job.status === 'running' && Number.isFinite(job.progress) && job.progress > 0) {
    progressPercent = Math.max(0, Math.min(100, Math.round(job.progress * 100)))
    progressSource = 'job'
  }

  return {
    jobId: job.jobId,
    stage: job.jobType === 'rebuild_retrieval_index' ? 'search' : 'analysis',
    status: job.status as WorkspaceKnowledgeOperationStatus,
    phaseLabel,
    progressPercent,
    progressSource,
  }
}

export function mapWorkspaceKnowledgeStatus(input: {
  overview: KnowledgeStatusOverview | null
  job?: KnowledgeRebuildStatus | null
}, translate = tm): WorkspaceKnowledgeStatus {
  const analysis = mapAnalysisStatus(input.overview)
  const search = mapSearchStatus(input.overview)
  const analysisResultsUsable = analysis !== 'not_ready'
  const searchResultsUsable = search === 'partial' || search === 'ready'
  const searchMayBeStale = analysis === 'ready' && search !== 'ready'
  const operation = resolveOperation(input.job, input.overview?.retrievalIndex.task, translate)

  let overall: WorkspaceKnowledgeOverallStatus
  if (!input.overview) {
    overall = 'loading'
  } else if (analysis === 'ready' && search === 'ready') {
    overall = 'ready'
  } else if (analysis === 'ready' && (search === 'not_ready' || search === 'pending')) {
    overall = 'analysis_ready_search_not_ready'
  } else if (analysisResultsUsable || searchResultsUsable) {
    overall = 'partial'
  } else {
    overall = 'not_ready'
  }

  return {
    overall,
    analysis,
    search,
    analysisCoverage: mapGraphCoverage(input.overview?.knowledgeGraph),
    searchCoverage: mapRetrievalCoverage(input.overview?.retrievalIndex, input.overview?.knowledgeGraph.totalChapterCount),
    operation,
    analysisResultsUsable,
    searchResultsUsable,
    searchMayBeStale,
  }
}
