export const PROTECTED_RESET_APP_SETTING_KEYS = [
  'PRESET_COMPAT_LIBRARY_V1',
  'AI_SETTINGS_V2',
  'OLLAMA_TIMEOUT_MS',
] as const

export const CURRENT_NOVEL_SCHEMA_VERSION = '4'

export const CONTROL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS AppSetting (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS NovelRegistry (
  novelId TEXT PRIMARY KEY,
  safeNovelId TEXT NOT NULL UNIQUE,
  title TEXT,
  author TEXT,
  dbFilePath TEXT NOT NULL UNIQUE,
  lanceDbPath TEXT NOT NULL UNIQUE,
  schemaVersion TEXT NOT NULL DEFAULT '4',
  migrationStatus TEXT NOT NULL DEFAULT 'pending',
  lifecycleToken TEXT,
  leaseExpiresAt TEXT,
  claimedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS MigrationManifest (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT,
  appliedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scope, version)
);

CREATE TABLE IF NOT EXISTS MigrationAudit (
  id TEXT PRIMARY KEY,
  manifestId TEXT,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  detailsJson TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manifestId) REFERENCES MigrationManifest(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS WritingSkillCard (
  id TEXT PRIMARY KEY,
  libraryId TEXT NOT NULL,
  libraryVersion TEXT NOT NULL,
  libraryName TEXT NOT NULL,
  title TEXT NOT NULL,
  userInstruction TEXT NOT NULL,
  summary TEXT NOT NULL,
  applicationScope TEXT NOT NULL,
  rulesJson TEXT NOT NULL,
  avoidJson TEXT NOT NULL,
  defaultExampleCount INTEGER NOT NULL DEFAULT 5,
  modelConfigId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  sourceJobId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WritingSkillMaterialBook (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  rawText TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  chapterCount INTEGER NOT NULL,
  estimatedTokens INTEGER NOT NULL,
  byteSize INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WritingSkillCardSource (
  skillCardId TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  sourceVersion TEXT NOT NULL,
  sourceName TEXT NOT NULL,
  sourceOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (skillCardId, sourceType, sourceId),
  FOREIGN KEY (skillCardId) REFERENCES WritingSkillCard(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS WritingSkillExample (
  id TEXT PRIMARY KEY,
  skillCardId TEXT NOT NULL,
  rangeRefJson TEXT NOT NULL,
  displayRef TEXT NOT NULL,
  score REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (skillCardId) REFERENCES WritingSkillCard(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS WritingSkillDistillationJob (
  id TEXT PRIMARY KEY,
  libraryId TEXT NOT NULL,
  libraryVersion TEXT,
  userInstruction TEXT NOT NULL,
  modelConfigId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message TEXT NOT NULL DEFAULT '',
  randomSeed INTEGER NOT NULL,
  roundCount INTEGER NOT NULL DEFAULT 0,
  sampledRangesJson TEXT NOT NULL DEFAULT '[]',
  candidateRefsJson TEXT NOT NULL DEFAULT '[]',
  inputTokens INTEGER NOT NULL DEFAULT 0,
  outputTokens INTEGER NOT NULL DEFAULT 0,
  requestJson TEXT NOT NULL DEFAULT '{}',
  resultCardId TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resultCardId) REFERENCES WritingSkillCard(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_registry_status ON NovelRegistry(migrationStatus, updatedAt);
CREATE INDEX IF NOT EXISTS idx_migration_manifest_scope_version ON MigrationManifest(scope, version);
CREATE INDEX IF NOT EXISTS idx_migration_audit_scope_created ON MigrationAudit(scope, createdAt);
CREATE INDEX IF NOT EXISTS idx_writing_skill_card_library_status ON WritingSkillCard(libraryId, status, updatedAt);
CREATE INDEX IF NOT EXISTS idx_writing_skill_material_book_updated ON WritingSkillMaterialBook(updatedAt, id);
CREATE INDEX IF NOT EXISTS idx_writing_skill_card_source_card_order ON WritingSkillCardSource(skillCardId, sourceOrder);
CREATE INDEX IF NOT EXISTS idx_writing_skill_card_source_lookup ON WritingSkillCardSource(sourceType, sourceId);
CREATE INDEX IF NOT EXISTS idx_writing_skill_example_card_enabled ON WritingSkillExample(skillCardId, enabled, score);
CREATE INDEX IF NOT EXISTS idx_writing_skill_job_library_status ON WritingSkillDistillationJob(libraryId, status, updatedAt);

CREATE INDEX IF NOT EXISTS idx_novel_registry_lifecycle ON NovelRegistry(migrationStatus, leaseExpiresAt, updatedAt, novelId);
`

const CHARACTER_IMPORTANCE_TIER_SQL = "'protagonist', 'important', 'arc'"

export const FULL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS WorkspaceState (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  payload TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WorkspaceStateBackup (
  id TEXT PRIMARY KEY,
  workspaceStateId TEXT NOT NULL,
  payload TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'overwrite',
  sourceUpdatedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  FOREIGN KEY (workspaceStateId) REFERENCES WorkspaceState(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS WorkspaceRuntimeState (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  revision INTEGER NOT NULL DEFAULT 0,
  localOutlinesJson TEXT NOT NULL DEFAULT '[]',
  localCharactersJson TEXT NOT NULL DEFAULT '[]',
  localCharacterRelationsJson TEXT NOT NULL DEFAULT '[]',
  localWorldEntriesJson TEXT NOT NULL DEFAULT '[]',
  localTimelineEventsJson TEXT NOT NULL DEFAULT '[]',
  rewriteCandidatesJson TEXT NOT NULL DEFAULT '[]',
  rewriteHistoryJson TEXT NOT NULL DEFAULT '[]',
  trajectoriesJson TEXT NOT NULL DEFAULT '[]',
  rewriteMode TEXT NOT NULL DEFAULT 'medium',
  rewriteTone TEXT NOT NULL DEFAULT 'keep',
  rewriteOutput TEXT NOT NULL DEFAULT 'candidate',
  rewriteScope TEXT NOT NULL DEFAULT 'paragraph',
  thinkingLevel TEXT NOT NULL DEFAULT 'medium',
  autoContinue INTEGER NOT NULL DEFAULT 1,
  keepCanon INTEGER NOT NULL DEFAULT 1,
  promptText TEXT NOT NULL DEFAULT '保留世界观与人物关系，仅强化氛围、节奏与张力。',
  selectedPresetId TEXT NOT NULL DEFAULT '',
  presetsJson TEXT NOT NULL DEFAULT '[]',
  constraintsJson TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WorkspaceKnowledgeSyncState (
  workspaceStateId TEXT PRIMARY KEY,
  requestedRevision INTEGER NOT NULL DEFAULT 0,
  startedRevision INTEGER,
  syncedRevision INTEGER NOT NULL DEFAULT 0,
  requestedSourceUpdatedAt TEXT,
  startedSourceUpdatedAt TEXT,
  startedAt TEXT,
  claimToken TEXT,
  syncedSourceUpdatedAt TEXT,
  lastError TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WorkspaceMutationReplay (
  workspaceStateId TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('chapter-patch','full-snapshot')),
  requestHash TEXT NOT NULL,
  committedRevision INTEGER NOT NULL CHECK(committedRevision >= 0),
  responseStatus INTEGER NOT NULL,
  responseJson TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspaceStateId,idempotencyKey),
  FOREIGN KEY(workspaceStateId) REFERENCES WorkspaceRuntimeState(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS WorkspaceChapterPatchJournal (
  workspaceStateId TEXT NOT NULL,
  committedRevision INTEGER NOT NULL CHECK(committedRevision > 0),
  chapterId TEXT NOT NULL,
  novelId TEXT NOT NULL,
  contentHtml TEXT NOT NULL,
  wordCount INTEGER NOT NULL CHECK(wordCount >= 0),
  updatedAtLabel TEXT NOT NULL,
  committedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workspaceStateId, committedRevision)
) STRICT;

CREATE TABLE IF NOT EXISTS WorkspaceRuntimeNovel (
  workspaceStateId TEXT NOT NULL DEFAULT 'singleton',
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tagsJson TEXT NOT NULL DEFAULT '[]',
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspaceStateId, id),
  FOREIGN KEY (workspaceStateId) REFERENCES WorkspaceRuntimeState(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS WorkspaceRuntimeChapter (
  workspaceStateId TEXT NOT NULL DEFAULT 'singleton',
  id TEXT NOT NULL,
  novelId TEXT NOT NULL,
  parentChapterId TEXT,
  kind TEXT,
  branchLabel TEXT,
  title TEXT NOT NULL,
  sortOrder REAL NOT NULL DEFAULT 0,
  contentHtml TEXT NOT NULL,
  originalContentHtml TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  wordCount INTEGER NOT NULL DEFAULT 0,
  updatedAtLabel TEXT NOT NULL DEFAULT '',
  trajectoryJson TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspaceStateId, id),
  FOREIGN KEY (workspaceStateId) REFERENCES WorkspaceRuntimeState(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AppSetting (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS NovelRecord (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  sourceType TEXT NOT NULL DEFAULT 'txt',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS StoryBranch (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  name TEXT NOT NULL,
  baseBranchId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (baseBranchId) REFERENCES StoryBranch(id) ON DELETE SET NULL,
  UNIQUE (novelId, name)
);

CREATE TABLE IF NOT EXISTS KnowledgeChapter (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  title TEXT,
  rawText TEXT NOT NULL,
  summary TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  isDirty INTEGER NOT NULL DEFAULT 0,
  dirtyReason TEXT,
  sourceHash TEXT NOT NULL,
  knowledgeStatus TEXT NOT NULL DEFAULT 'ready',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  UNIQUE (novelId, branchId, chapterNo)
);

CREATE TABLE IF NOT EXISTS chapter_extraction_candidates (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  chapter_revision INTEGER,
  chapter_source_hash TEXT NOT NULL,
  extraction_json TEXT NOT NULL,
  processing_batch_id TEXT,
  processing_result_json TEXT,
  status TEXT NOT NULL DEFAULT 'extracted',
  provider TEXT,
  model TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, chapter_id, chapter_source_hash)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_cache (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT,
  chapter_no INTEGER,
  chapter_text_hash TEXT NOT NULL,
  hanlp_script_version_hash TEXT NOT NULL,
  hanlp_model_or_config_hash TEXT NOT NULL,
  output_schema_version TEXT NOT NULL DEFAULT 'v1',
  cache_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL DEFAULT 'v1',
  source_chapter_id TEXT,
  source_chapter_no INTEGER,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (branch_id, input_hash, pipeline_version)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_results (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  knowledge_job_id TEXT,
  chapter_id TEXT,
  chapter_no INTEGER,
  chapter_source_hash TEXT NOT NULL,
  result_kind TEXT NOT NULL DEFAULT 'bootstrap',
  provider TEXT,
  model TEXT,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_job_id) REFERENCES KnowledgeJob(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (branch_id, chapter_id, chapter_source_hash, result_kind)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_entities (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_id TEXT,
  chapter_no INTEGER,
  entity_text TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 1,
  chapter_count INTEGER NOT NULL DEFAULT 1,
  coverage_ratio REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  source_cache_id TEXT,
  source_result_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_cache_id) REFERENCES hanlp_bootstrap_cache(id) ON DELETE SET NULL,
  FOREIGN KEY (source_result_id) REFERENCES hanlp_bootstrap_results(id) ON DELETE SET NULL,
  UNIQUE (branch_id, chapter_id, entity_text, entity_type, source_result_id)
);

CREATE TABLE IF NOT EXISTS hanlp_bootstrap_coverage (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL UNIQUE,
  valid_through_chapter_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_candidates (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  surface_text TEXT NOT NULL,
  first_seen_chapter INTEGER NOT NULL,
  last_seen_chapter INTEGER NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 1,
  mention_count INTEGER NOT NULL DEFAULT 1,
  observations_json TEXT,
  status TEXT NOT NULL DEFAULT 'collecting',
  promoted_entity_id TEXT,
  promotion_summary_status TEXT NOT NULL DEFAULT 'not_requested',
  promotion_summary_generated_at TEXT,
  merged_entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (promoted_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (merged_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, surface_text),
  UNIQUE (branch_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS character_candidate_chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 1,
  best_observation TEXT,
  best_evidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  chapter_id TEXT,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES character_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, candidate_id, chapter_no)
);

CREATE TABLE IF NOT EXISTS ChapterLine (
  id TEXT PRIMARY KEY,
  chapterId TEXT NOT NULL,
  lineNo INTEGER NOT NULL,
  text TEXT NOT NULL,
  charStart INTEGER,
  charEnd INTEGER,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  UNIQUE (chapterId, lineNo)
);

CREATE TABLE IF NOT EXISTS TextSpan (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER NOT NULL,
  lineEnd INTEGER NOT NULL,
  charStart INTEGER,
  charEnd INTEGER,
  text TEXT NOT NULL,
  spanType TEXT NOT NULL,
  tokenEstimate INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KnowledgeEntity (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  entityType TEXT NOT NULL,
  canonicalName TEXT NOT NULL,
  description TEXT,
  firstSeenChapter INTEGER,
  lastSeenChapter INTEGER,
  importanceTier TEXT CHECK ((entityType = 'character' AND importanceTier IN (${CHARACTER_IMPORTANCE_TIER_SQL})) OR (entityType <> 'character' AND importanceTier IS NULL)),
  status TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  userConfirmed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  UNIQUE (branchId, canonicalName, entityType)
);

CREATE TABLE IF NOT EXISTS EntityAlias (
  id TEXT PRIMARY KEY,
  entityId TEXT NOT NULL,
  alias TEXT NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  sourceChapter INTEGER,
  confidence REAL NOT NULL DEFAULT 0.7,
  userConfirmed INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL,
  UNIQUE (entityId, alias)
);

CREATE TABLE IF NOT EXISTS EntityAliasMapping (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  alias TEXT NOT NULL,
  entityId TEXT NOT NULL,
  sourceAliasId TEXT,
  sourceChapter INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceAliasId) REFERENCES EntityAlias(id) ON DELETE SET NULL,
  UNIQUE (branchId, alias)
);

CREATE TABLE IF NOT EXISTS EntityAliasConflictLog (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  alias TEXT NOT NULL,
  existingEntityId TEXT,
  attemptedEntityId TEXT,
  existingCanonicalName TEXT,
  attemptedCanonicalName TEXT,
  sourceAliasId TEXT,
  sourceChapter INTEGER,
  conflictReason TEXT NOT NULL DEFAULT 'branch_alias_already_claimed',
  detailsJson TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (existingEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (attemptedEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (sourceAliasId) REFERENCES EntityAlias(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityMention (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  entityId TEXT,
  mentionText TEXT NOT NULL,
  resolutionKind TEXT NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityAppearance (
  id TEXT PRIMARY KEY,
  entityId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  evidenceSpanId TEXT,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityLink (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  targetEntityId TEXT NOT NULL,
  linkType TEXT NOT NULL,
  label TEXT,
  description TEXT,
  polarity TEXT,
  strength INTEGER NOT NULL DEFAULT 3,
  weight REAL NOT NULL DEFAULT 1,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  includeByDefault INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EntityState (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  entityId TEXT NOT NULL,
  stateType TEXT NOT NULL,
  stateValue TEXT NOT NULL,
  description TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  includeByDefault INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeFact (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  factType TEXT NOT NULL,
  subjectEntityId TEXT,
  predicate TEXT NOT NULL,
  objectEntityId TEXT,
  valueJson TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (subjectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (objectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS FactEvidence (
  id TEXT PRIMARY KEY,
  factId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  quote TEXT NOT NULL,
  evidenceSpanId TEXT,
  FOREIGN KEY (factId) REFERENCES KnowledgeFact(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeRelation (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  targetEntityId TEXT NOT NULL,
  relationType TEXT NOT NULL,
  polarity TEXT,
  strength INTEGER NOT NULL DEFAULT 3,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeEvent (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  eventType TEXT,
  chapterNo INTEGER NOT NULL,
  lineStart INTEGER,
  lineEnd INTEGER,
  importance INTEGER NOT NULL DEFAULT 3,
  consequences TEXT,
  evidenceSpanId TEXT,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS EventParticipant (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  entityId TEXT NOT NULL,
  role TEXT,
  FOREIGN KEY (eventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
  UNIQUE (eventId, entityId, role)
);

CREATE TABLE IF NOT EXISTS EventLink (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  sourceEventId TEXT NOT NULL,
  targetEventId TEXT NOT NULL,
  linkType TEXT NOT NULL,
  label TEXT,
  description TEXT,
  sourceChapter INTEGER NOT NULL,
  validFromChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  evidenceQuote TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (sourceEventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (targetEventId) REFERENCES KnowledgeEvent(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS KnowledgeWorld (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  term TEXT NOT NULL,
  category TEXT,
  definition TEXT NOT NULL,
  firstSeenChapter INTEGER,
  validFromChapter INTEGER,
  validUntilChapter INTEGER NOT NULL,
  evidenceSpanId TEXT,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  confidence REAL NOT NULL DEFAULT 0.7,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL,
  UNIQUE (branchId, term, category)
);

CREATE TABLE IF NOT EXISTS KnowledgeJob (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT,
  jobType TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  currentStep TEXT,
  payloadJson TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS GenerationContextSnapshot (
  id TEXT PRIMARY KEY,
  novelId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  chapterId TEXT NOT NULL,
  requestFingerprint TEXT NOT NULL,
  knowledgeFingerprint TEXT NOT NULL,
  contextJson TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (chapterId) REFERENCES KnowledgeChapter(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RawTextEmbeddingCache (
  branchId TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  embeddingInputHash TEXT NOT NULL,
  vectorBlob BLOB NOT NULL,
  vectorDimension INTEGER NOT NULL,
  lastSeenAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branchId, provider, model, embeddingInputHash),
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ActiveRetrievalIndex (
  branchId TEXT NOT NULL,
  scopeKey TEXT NOT NULL DEFAULT 'full',
  tableName TEXT NOT NULL UNIQUE,
  scopeStartChapter INTEGER,
  scopeEndChapter INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branchId, scopeKey),
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS PendingRetrievalIndex (
  branchId TEXT NOT NULL,
  scopeKey TEXT NOT NULL DEFAULT 'full',
  tableName TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL,
  rowCount INTEGER NOT NULL DEFAULT 0,
  textIndexCompleted INTEGER NOT NULL DEFAULT 0,
  vectorIndexCompleted INTEGER NOT NULL DEFAULT 0,
  rebuildFingerprint TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branchId, scopeKey),
  FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS story_timeline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  label_index INTEGER NOT NULL,
  anchor_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  parent_node_id TEXT,
  source_chapter_no INTEGER,
  target_chapter_no INTEGER,
  chapter_id TEXT,
  continue_block_id TEXT,
  what_if_session_id TEXT,
  future_jump_run_id TEXT,
  roleplay_session_id TEXT,
  readable_label TEXT,
  readable_lineage_label TEXT,
  lane_index INTEGER DEFAULT 0,
  color_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE SET NULL,
  FOREIGN KEY (what_if_session_id) REFERENCES what_if_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (future_jump_run_id) REFERENCES future_jump_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (roleplay_session_id) REFERENCES roleplay_sessions(id) ON DELETE SET NULL,
  UNIQUE (novel_id, branch_id, node_type, label_index),
  UNIQUE (continue_block_id),
  UNIQUE (what_if_session_id),
  UNIQUE (future_jump_run_id),
  UNIQUE (roleplay_session_id)
);

CREATE TABLE IF NOT EXISTS continue_blocks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  parent_timeline_node_id TEXT,
  source_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  user_instruction TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  latest_text TEXT NOT NULL,
  latest_input_tokens INTEGER,
  latest_output_tokens INTEGER,
  writing_skill_card_ids_json TEXT NOT NULL DEFAULT '[]',
  writing_skill_example_count INTEGER NOT NULL DEFAULT 5,
  latest_revision_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS continue_block_revisions (
  id TEXT PRIMARY KEY,
  continue_block_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  user_instruction TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  title TEXT NOT NULL,
  subtitle TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE CASCADE,
  UNIQUE (continue_block_id, revision_no)
);

CREATE TABLE IF NOT EXISTS what_if_sessions (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  base_branch_id TEXT NOT NULL,
  source_chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (base_branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS what_if_deltas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  delta_type TEXT NOT NULL,
  subject_name TEXT,
  target_name TEXT,
  subject_entity_id TEXT,
  target_entity_id TEXT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  valid_from_chapter INTEGER,
  description TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES what_if_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
  FOREIGN KEY (target_entity_id) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  source_chapter_id TEXT,
  source_chapter_no INTEGER NOT NULL,
  source_chapter_title TEXT,
  source_timeline_node_id TEXT,
  source_timeline_node_type TEXT,
  source_selected_text TEXT NOT NULL,
  source_text_snapshot TEXT NOT NULL,
  source_selected_line_start INTEGER,
  source_selected_line_end INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS roleplay_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  variant_index INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  parent_message_id TEXT,
  forked_from_message_id TEXT,
  variant_group_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_message_id) REFERENCES roleplay_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (forked_from_message_id) REFERENCES roleplay_messages(id) ON DELETE SET NULL,
  UNIQUE (session_id, message_index),
  UNIQUE (session_id, turn_index, variant_index)
);

CREATE TABLE IF NOT EXISTS outline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  chapter_no INTEGER,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  original_outcome TEXT,
  track_key TEXT NOT NULL,
  phase_label TEXT,
  source_type TEXT NOT NULL,
  confidence REAL,
  involved_entities_json TEXT NOT NULL,
  key_events_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outline_node_chapters (
  id TEXT PRIMARY KEY,
  outline_node_id TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  chapter_id TEXT,
  chapter_title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outline_node_id) REFERENCES outline_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS future_jump_runs (
  id TEXT PRIMARY KEY,
  base_branch_id TEXT NOT NULL,
  parent_timeline_node_id TEXT,
  source_timeline_node_id TEXT,
  source_timeline_node_type TEXT NOT NULL CHECK (source_timeline_node_type IN ('chapter', 'rewrite', 'continue_block', 'what_if', 'future_jump', 'roleplay_session')),
  source_chapter_id TEXT,
  source_what_if_session_id TEXT,
  source_text_snapshot TEXT NOT NULL,
  target_outline_node_id TEXT NOT NULL,
  target_outline_chapter_id TEXT NOT NULL,
  source_chapter_no INTEGER NOT NULL,
  target_chapter_no INTEGER NOT NULL,
  user_direction TEXT NOT NULL DEFAULT '',
  bridge_summary TEXT NOT NULL,
  generated_target_text TEXT NOT NULL,
  latest_input_tokens INTEGER,
  latest_output_tokens INTEGER,
  latest_revision_no INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (base_branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (source_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL,
  FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
  FOREIGN KEY (source_what_if_session_id) REFERENCES what_if_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (target_outline_node_id) REFERENCES outline_nodes(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_outline_chapter_id) REFERENCES outline_node_chapters(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS future_jump_revisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  user_feedback TEXT,
  bridge_summary TEXT NOT NULL,
  generated_target_text TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES future_jump_runs(id) ON DELETE CASCADE,
  UNIQUE (run_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chapter_branch_no ON KnowledgeChapter(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_order ON chapter_extraction_candidates(branch_id, chapter_no, status);
CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_chapter ON chapter_extraction_candidates(branch_id, chapter_id, chapter_source_hash);
CREATE INDEX IF NOT EXISTS idx_workspace_state_backup_state_created ON WorkspaceStateBackup(workspaceStateId, createdAt);
CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_sync_requested ON WorkspaceKnowledgeSyncState(requestedSourceUpdatedAt, syncedSourceUpdatedAt);
CREATE INDEX IF NOT EXISTS idx_workspace_runtime_novel_state_order ON WorkspaceRuntimeNovel(workspaceStateId, sortOrder, id);
CREATE INDEX IF NOT EXISTS idx_workspace_runtime_chapter_state_novel_order ON WorkspaceRuntimeChapter(workspaceStateId, novelId, sortOrder, id);
CREATE INDEX IF NOT EXISTS idx_workspace_mutation_replay_created ON WorkspaceMutationReplay(workspaceStateId, createdAt);
CREATE INDEX IF NOT EXISTS idx_workspace_patch_journal_revision ON WorkspaceChapterPatchJournal(workspaceStateId, committedRevision);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_cache_last_seen ON hanlp_bootstrap_cache(branch_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_lookup ON hanlp_bootstrap_results(branch_id, chapter_id, chapter_source_hash, result_kind);
CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_job ON hanlp_bootstrap_results(knowledge_job_id, status);
CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_candidate_count ON character_candidate_chapters(candidate_id, chapter_no);
CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_branch_chapter ON character_candidate_chapters(branch_id, chapter_no, candidate_id);
CREATE INDEX IF NOT EXISTS idx_text_span_branch_chapter ON TextSpan(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_text_span_chapter_type ON TextSpan(chapterId, spanType);
CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_name ON KnowledgeEntity(branchId, entityType, canonicalName);
CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_alias ON EntityAliasMapping(branchId, alias);
CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_entity ON EntityAliasMapping(branchId, entityId);
CREATE INDEX IF NOT EXISTS idx_entity_alias_conflict_branch_alias ON EntityAliasConflictLog(branchId, alias, createdAt);
CREATE INDEX IF NOT EXISTS idx_entity_mention_branch_chapter ON EntityMention(branchId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_entity_mention_entity_chapter ON EntityMention(branchId, entityId, chapterNo);
CREATE INDEX IF NOT EXISTS idx_entity_link_source_valid_until ON EntityLink(branchId, sourceEntityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_target_valid_until ON EntityLink(branchId, targetEntityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_chapter ON EntityLink(branchId, sourceChapter);
CREATE INDEX IF NOT EXISTS idx_entity_link_status ON EntityLink(branchId, status);
CREATE INDEX IF NOT EXISTS idx_entity_state_entity_valid_until ON EntityState(branchId, entityId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_entity_state_status ON EntityState(branchId, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_fact_branch_source ON KnowledgeFact(branchId, sourceChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_relation_branch_valid_until ON KnowledgeRelation(branchId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_knowledge_event_branch_chapter ON KnowledgeEvent(branchId, chapterNo, importance);
CREATE INDEX IF NOT EXISTS idx_event_link_source_valid ON EventLink(branchId, sourceEventId, validFromChapter);
CREATE INDEX IF NOT EXISTS idx_event_link_target_valid ON EventLink(branchId, targetEventId, validFromChapter);
CREATE INDEX IF NOT EXISTS idx_event_link_status ON EventLink(branchId, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_world_branch_valid_until ON KnowledgeWorld(branchId, validFromChapter, validUntilChapter);
CREATE INDEX IF NOT EXISTS idx_job_novel_status ON KnowledgeJob(novelId, status);
CREATE INDEX IF NOT EXISTS idx_job_branch_status ON KnowledgeJob(branchId, status);
CREATE INDEX IF NOT EXISTS idx_generation_context_snapshot_scope ON GenerationContextSnapshot(novelId, branchId, chapterId, expiresAt);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_label_scope ON story_timeline_nodes(novel_id, branch_id, node_type, label_index);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_anchor_chapter ON story_timeline_nodes(novel_id, branch_id, anchor_chapter_no);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_parent ON story_timeline_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_session ON story_timeline_nodes(what_if_session_id);
CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_run ON story_timeline_nodes(future_jump_run_id);
CREATE INDEX IF NOT EXISTS idx_continue_blocks_branch_source ON continue_blocks(branch_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_continue_blocks_parent_node ON continue_blocks(parent_timeline_node_id);
CREATE INDEX IF NOT EXISTS idx_continue_block_revisions_block ON continue_block_revisions(continue_block_id);
CREATE INDEX IF NOT EXISTS idx_what_if_sessions_branch_source ON what_if_sessions(base_branch_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_what_if_deltas_session ON what_if_deltas(session_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_branch_source ON roleplay_sessions(branch_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_source_node ON roleplay_sessions(source_timeline_node_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_messages_session_order ON roleplay_messages(session_id, message_index);
CREATE INDEX IF NOT EXISTS idx_roleplay_messages_parent ON roleplay_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_messages_fork ON roleplay_messages(forked_from_message_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_messages_variant_group ON roleplay_messages(session_id, variant_group_id);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_track_sort ON outline_nodes(novel_id, branch_id, track_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_chapter ON outline_nodes(novel_id, branch_id, chapter_no);
CREATE INDEX IF NOT EXISTS idx_outline_nodes_source_type ON outline_nodes(branch_id, source_type);
CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_outline_primary_sort ON outline_node_chapters(outline_node_id, is_primary, sort_order);
CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_chapter_anchor ON outline_node_chapters(chapter_no, chapter_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_what_if_source ON future_jump_runs(source_what_if_session_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_parent_node ON future_jump_runs(parent_timeline_node_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline ON future_jump_runs(target_outline_node_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline_chapter ON future_jump_runs(target_outline_chapter_id);
CREATE INDEX IF NOT EXISTS idx_future_jump_runs_branch_target_chapter ON future_jump_runs(base_branch_id, target_chapter_no);
CREATE INDEX IF NOT EXISTS idx_future_jump_revisions_run ON future_jump_revisions(run_id);

CREATE TABLE IF NOT EXISTS chapter_extraction_processing_batches (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      batch_identity_hash TEXT NOT NULL,
      batch_context_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
      UNIQUE (branch_id, batch_identity_hash)
    );

CREATE TRIGGER IF NOT EXISTS trg_knowledge_entity_character_tier_insert
    BEFORE INSERT ON KnowledgeEntity
    FOR EACH ROW
    WHEN (NEW.entityType = 'character' AND (NEW.importanceTier IS NULL OR NEW.importanceTier NOT IN ('protagonist', 'important', 'arc')))
      OR (NEW.entityType <> 'character' AND NEW.importanceTier IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'character entities require Tier 0, Tier 1, or Tier 2 importanceTier');
    END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_entity_character_tier_update
    BEFORE UPDATE OF entityType, importanceTier ON KnowledgeEntity
    FOR EACH ROW
    WHEN (NEW.entityType = 'character' AND (NEW.importanceTier IS NULL OR NEW.importanceTier NOT IN ('protagonist', 'important', 'arc')))
      OR (NEW.entityType <> 'character' AND NEW.importanceTier IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'character entities require Tier 0, Tier 1, or Tier 2 importanceTier');
    END;

CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_cache_lookup ON hanlp_bootstrap_cache(branch_id, chapter_no, chapter_text_hash, hanlp_script_version_hash, hanlp_model_or_config_hash, output_schema_version);

CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_processing_batch ON chapter_extraction_candidates(branch_id, processing_batch_id);

CREATE INDEX IF NOT EXISTS idx_chapter_extraction_processing_batches_branch ON chapter_extraction_processing_batches(branch_id, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_extraction_processing_batches_identity ON chapter_extraction_processing_batches(branch_id, batch_identity_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_character_candidates_surface_text ON character_candidates(novel_id, branch_id, surface_text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_character_candidate_chapters_chapter_no ON character_candidate_chapters(novel_id, branch_id, candidate_id, chapter_no);

CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_entities_branch_type ON hanlp_bootstrap_entities(branch_id, entity_type, score);

CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_entities_result_lookup ON hanlp_bootstrap_entities(source_result_id, branch_id, chapter_no);

CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_coverage_novel ON hanlp_bootstrap_coverage(novel_id, valid_through_chapter_no);

CREATE INDEX IF NOT EXISTS idx_character_candidates_branch_status ON character_candidates(branch_id, status, last_seen_chapter);

CREATE INDEX IF NOT EXISTS idx_character_candidates_promotion_lookup ON character_candidates(branch_id, promoted_entity_id, promotion_summary_status, merged_entity_id, status, last_seen_chapter);

CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_tier ON KnowledgeEntity(branchId, importanceTier) WHERE importanceTier IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id) WHERE continue_block_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_story_timeline_nodes_roleplay_session ON story_timeline_nodes(roleplay_session_id) WHERE roleplay_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_roleplay_session ON story_timeline_nodes(roleplay_session_id);

CREATE INDEX IF NOT EXISTS idx_future_jump_runs_source_node ON future_jump_runs(source_timeline_node_id);

CREATE INDEX IF NOT EXISTS idx_future_jump_runs_source_chapter ON future_jump_runs(source_chapter_id);
`

export const SCHEMA_SQL = FULL_SCHEMA_SQL
