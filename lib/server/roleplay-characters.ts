import type { DatabaseAccess } from '@/lib/server/database-access'
import type { RoleplaySessionRecord } from '@/lib/roleplay-types'
import type { RoleplayCharacterOption } from '@/lib/roleplay-script'

export function getRoleplayCharacterOptions(session: RoleplaySessionRecord, db: DatabaseAccess): RoleplayCharacterOption[] {
  // HanLP placeholders also live in KnowledgeEntity. Every option, including the
  // protagonist, must have a valid character profile at the source chapter.
  const rows = db.queryAll<{ name: string; protagonist: number; appeared: number }>(`
    SELECT e.canonicalName AS name, e.importanceTier = 'protagonist' AS protagonist,
      (EXISTS (SELECT 1 FROM EntityAppearance a WHERE a.entityId = e.id AND a.chapterNo = ?)
       OR EXISTS (SELECT 1 FROM EntityMention m WHERE m.entityId = e.id AND m.chapterNo = ? AND m.branchId = e.branchId)
       OR EXISTS (SELECT 1 FROM hanlp_bootstrap_entities h WHERE h.branch_id = e.branchId AND h.chapter_no = ? AND h.entity_text = e.canonicalName)
       OR instr(?, e.canonicalName) > 0
       OR EXISTS (SELECT 1 FROM EntityAlias a WHERE a.entityId = e.id AND (a.sourceChapter IS NULL OR a.sourceChapter <= ?) AND instr(?, a.alias) > 0)) AS appeared
    FROM KnowledgeEntity e
    WHERE e.novelId = ? AND e.branchId = ? AND e.entityType = 'character'
      AND e.importanceTier IN ('protagonist', 'important', 'arc')
      AND (e.status IS NULL OR e.status NOT IN ('rejected', 'outdated', 'potentially_stale'))
      AND (e.firstSeenChapter IS NULL OR e.firstSeenChapter <= ?)
      AND EXISTS (
        SELECT 1 FROM KnowledgeFact f
        WHERE f.subjectEntityId = e.id AND f.novelId = e.novelId AND f.branchId = e.branchId
          AND f.factType = 'character_profile'
          AND f.status NOT IN ('rejected', 'outdated', 'potentially_stale')
          AND f.sourceChapter <= ? AND f.validFromChapter <= ? AND f.validUntilChapter > ?
      )
    ORDER BY protagonist DESC, e.importance DESC, e.canonicalName ASC
  `, session.sourceChapterNo, session.sourceChapterNo, session.sourceChapterNo,
  session.sourceTextSnapshot, session.sourceChapterNo, session.sourceTextSnapshot,
  session.novelId, session.branchId, session.sourceChapterNo,
  session.sourceChapterNo, session.sourceChapterNo, session.sourceChapterNo)
  return rows.filter((row) => row.protagonist || row.appeared).map((row) => ({ name: row.name, protagonist: Boolean(row.protagonist) }))
}
