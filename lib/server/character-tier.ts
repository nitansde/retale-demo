import type { PersistedNovelState } from '@/lib/types'
import type { CharacterImportanceTier } from '@/lib/server/hanlp-contracts'

export const IMPORTANT_CHARACTER_COVERAGE_THRESHOLD = 0.1
export const ARC_CHARACTER_TOTAL_COUNT_THRESHOLD = 10

export const GENERIC_TEMPORARY_CHARACTER_STOPLIST = new Set([
  '守卫',
  '士兵',
  '路人',
  '掌柜',
  '侍女',
  '普通村民',
])

export type HanlpCharacterAggregate = {
  name: string
  totalCount: number
  chapterCount: number
  score: number
  coverageRatio?: number
  firstSeenChapter?: number | null
  lastSeenChapter?: number | null
}

export type HanlpBootstrapCharacterDecision = {
  name: string
  normalizedName: string
  tier: CharacterImportanceTier
  reason: 'configured_protagonist' | 'hanlp_top_ranked' | 'configured_important' | 'coverage_threshold' | 'arc_threshold' | 'generic_stoplist' | 'below_threshold'
  totalCount: number
  chapterCount: number
  coverageRatio: number
  score: number
  firstSeenChapter: number | null
  lastSeenChapter: number | null
}

export type HanlpBootstrapFormalCharacterDecision = HanlpBootstrapCharacterDecision & {
  tier: Extract<CharacterImportanceTier, 'protagonist' | 'important' | 'arc'>
}

function normalizeTierName(name: string) {
  return name.trim()
}

export function isGenericTemporaryCharacterName(name: string) {
  return GENERIC_TEMPORARY_CHARACTER_STOPLIST.has(normalizeTierName(name))
}

function compareHanlpCharacterPriority(left: HanlpCharacterAggregate, right: HanlpCharacterAggregate) {
  if (right.totalCount !== left.totalCount) return right.totalCount - left.totalCount
  if (right.chapterCount !== left.chapterCount) return right.chapterCount - left.chapterCount
  if (right.score !== left.score) return right.score - left.score
  return normalizeTierName(left.name).localeCompare(normalizeTierName(right.name), 'zh-Hans-CN')
}

export function deriveConfiguredProtagonistName(state?: Pick<PersistedNovelState, 'localCharacters'> | null) {
  const protagonist = state?.localCharacters.find((character) => character.role.trim() === '主角')
  return protagonist?.name.trim() || null
}

export function classifyHanlpBootstrapCharacters(params: {
  people: ReadonlyArray<HanlpCharacterAggregate>
  totalChapters: number
  configuredProtagonistName?: string | null
  importantNames?: ReadonlyArray<string>
}) {
  const totalChapters = Math.max(0, params.totalChapters)
  const configuredProtagonistName = params.configuredProtagonistName?.trim() || null
  const importantNames = new Set((params.importantNames ?? []).map((name) => normalizeTierName(name)).filter(Boolean))

  const normalizedPeople = params.people
    .map((person) => {
      const normalizedName = normalizeTierName(person.name)
      const coverageRatio = person.coverageRatio ?? (totalChapters > 0 ? person.chapterCount / totalChapters : 0)
      return {
        ...person,
        normalizedName,
        coverageRatio,
      }
    })
    .filter((person) => person.normalizedName)

  const eligiblePeople = normalizedPeople
    .filter((person) => !isGenericTemporaryCharacterName(person.normalizedName))
    .sort(compareHanlpCharacterPriority)

  const protagonistName = eligiblePeople.find((person) => person.normalizedName === configuredProtagonistName)?.normalizedName
    ?? eligiblePeople[0]?.normalizedName
    ?? null

  return normalizedPeople
    .slice()
    .sort(compareHanlpCharacterPriority)
    .map<HanlpBootstrapCharacterDecision>((person) => {
      const firstSeenChapter = person.firstSeenChapter ?? null
      const lastSeenChapter = person.lastSeenChapter ?? null

      if (isGenericTemporaryCharacterName(person.normalizedName)) {
        return {
          name: person.name,
          normalizedName: person.normalizedName,
          tier: 'ignored',
          reason: 'generic_stoplist',
          totalCount: person.totalCount,
          chapterCount: person.chapterCount,
          coverageRatio: person.coverageRatio,
          score: person.score,
          firstSeenChapter,
          lastSeenChapter,
        }
      }

      if (protagonistName && person.normalizedName === protagonistName) {
        return {
          name: person.name,
          normalizedName: person.normalizedName,
          tier: 'protagonist',
          reason: person.normalizedName === configuredProtagonistName ? 'configured_protagonist' : 'hanlp_top_ranked',
          totalCount: person.totalCount,
          chapterCount: person.chapterCount,
          coverageRatio: person.coverageRatio,
          score: person.score,
          firstSeenChapter,
          lastSeenChapter,
        }
      }

      if (importantNames.has(person.normalizedName) || person.coverageRatio >= IMPORTANT_CHARACTER_COVERAGE_THRESHOLD) {
        return {
          name: person.name,
          normalizedName: person.normalizedName,
          tier: 'important',
          reason: importantNames.has(person.normalizedName) ? 'configured_important' : 'coverage_threshold',
          totalCount: person.totalCount,
          chapterCount: person.chapterCount,
          coverageRatio: person.coverageRatio,
          score: person.score,
          firstSeenChapter,
          lastSeenChapter,
        }
      }

      if (person.totalCount > ARC_CHARACTER_TOTAL_COUNT_THRESHOLD) {
        return {
          name: person.name,
          normalizedName: person.normalizedName,
          tier: 'arc',
          reason: 'arc_threshold',
          totalCount: person.totalCount,
          chapterCount: person.chapterCount,
          coverageRatio: person.coverageRatio,
          score: person.score,
          firstSeenChapter,
          lastSeenChapter,
        }
      }

      return {
        name: person.name,
        normalizedName: person.normalizedName,
        tier: 'ignored',
        reason: 'below_threshold',
        totalCount: person.totalCount,
        chapterCount: person.chapterCount,
        coverageRatio: person.coverageRatio,
        score: person.score,
        firstSeenChapter,
        lastSeenChapter,
      }
    })
}

export function shouldBootstrapFormalCharacterEntity(
  decision: HanlpBootstrapCharacterDecision,
): decision is HanlpBootstrapFormalCharacterDecision {
  return decision.tier === 'protagonist' || decision.tier === 'important' || decision.tier === 'arc'
}
