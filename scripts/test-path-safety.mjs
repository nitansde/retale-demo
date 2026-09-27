import fs from 'node:fs'
import path from 'node:path'

export const TEST_OWNERSHIP_MARKER = '.retale-test-owned.json'

const MARKER_CONTENTS = Object.freeze({
  owner: 'retale-test-harness',
  version: 1,
})

function isContainedPath(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function canonicalizePotentialPath(candidatePath) {
  const unresolvedParts = []
  let existingPath = path.resolve(candidatePath)

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath)
    if (parentPath === existingPath) {
      break
    }
    unresolvedParts.unshift(path.basename(existingPath))
    existingPath = parentPath
  }

  const canonicalExistingPath = fs.existsSync(existingPath)
    ? fs.realpathSync.native(existingPath)
    : existingPath
  return path.join(canonicalExistingPath, ...unresolvedParts)
}

function assertNotRepositoryRuntimePath(candidatePath, repoRoot, label) {
  const canonicalRepoRoot = canonicalizePotentialPath(repoRoot)
  const canonicalCandidate = canonicalizePotentialPath(candidatePath)
  const rootDatabasePath = path.join(canonicalRepoRoot, 'dev.db')
  const rootDataPath = path.join(canonicalRepoRoot, 'data')

  if (canonicalCandidate === canonicalRepoRoot) {
    throw new Error(`[retale-test-path] ${label} must not be the repository root: ${candidatePath}`)
  }
  if (canonicalCandidate === rootDatabasePath) {
    throw new Error(`[retale-test-path] ${label} must not use the repository dev.db: ${candidatePath}`)
  }
  if (isContainedPath(rootDataPath, canonicalCandidate)) {
    throw new Error(`[retale-test-path] ${label} must not use the repository data directory: ${candidatePath}`)
  }
}

function readOwnershipMarker(ownedRoot) {
  const markerPath = path.join(ownedRoot, TEST_OWNERSHIP_MARKER)
  let marker

  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  } catch {
    throw new Error(`[retale-test-path] Missing or invalid test ownership marker: ${markerPath}`)
  }

  if (marker.owner !== MARKER_CONTENTS.owner || marker.version !== MARKER_CONTENTS.version) {
    throw new Error(`[retale-test-path] Unrecognized test ownership marker: ${markerPath}`)
  }
}

export function markOwnedTestRoot(ownedRoot, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const resolvedRoot = path.resolve(ownedRoot)
  assertNotRepositoryRuntimePath(resolvedRoot, repoRoot, 'test root')
  fs.mkdirSync(resolvedRoot, { recursive: true })

  const markerPath = path.join(resolvedRoot, TEST_OWNERSHIP_MARKER)
  if (fs.existsSync(markerPath)) {
    readOwnershipMarker(resolvedRoot)
  } else {
    fs.writeFileSync(markerPath, `${JSON.stringify(MARKER_CONTENTS)}\n`, { flag: 'wx' })
  }

  return resolvedRoot
}

export function createOwnedTestRoot(parentPath, prefix, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const resolvedParent = path.resolve(parentPath)
  assertNotRepositoryRuntimePath(resolvedParent, repoRoot, 'test root parent')
  fs.mkdirSync(resolvedParent, { recursive: true })
  return markOwnedTestRoot(fs.mkdtempSync(path.join(resolvedParent, prefix)), { repoRoot })
}

export function assertOwnedTestPath(ownedRoot, candidatePath, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const label = options.label ?? 'test path'
  const resolvedRoot = path.resolve(ownedRoot)
  const resolvedCandidate = path.resolve(candidatePath)

  assertNotRepositoryRuntimePath(resolvedRoot, repoRoot, 'test root')
  assertNotRepositoryRuntimePath(resolvedCandidate, repoRoot, label)
  readOwnershipMarker(resolvedRoot)

  const canonicalRoot = canonicalizePotentialPath(resolvedRoot)
  const canonicalCandidate = canonicalizePotentialPath(resolvedCandidate)
  if (!isContainedPath(canonicalRoot, canonicalCandidate) || canonicalCandidate === canonicalRoot) {
    throw new Error(`[retale-test-path] ${label} must stay inside the owned test root: ${candidatePath}`)
  }

  return resolvedCandidate
}

export function assertOwnedTestDatabaseUrl(ownedRoot, databaseUrl, options = {}) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.startsWith('file:')) {
    throw new Error(`[retale-test-path] ${options.label ?? 'DATABASE_URL'} must be an explicit file: URL`)
  }

  const rawPath = databaseUrl.slice('file:'.length)
  if (!rawPath || rawPath === ':memory:') {
    throw new Error(`[retale-test-path] ${options.label ?? 'DATABASE_URL'} must name a test database file`)
  }

  const databasePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(options.repoRoot ?? process.cwd(), rawPath.replace(/^\.\//u, ''))
  return assertOwnedTestPath(ownedRoot, databasePath, options)
}

export function removeOwnedTestTree(ownedRoot, approvedParent, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const resolvedRoot = path.resolve(ownedRoot)
  const resolvedParent = path.resolve(approvedParent)
  assertNotRepositoryRuntimePath(resolvedRoot, repoRoot, options.label ?? 'owned cleanup directory')
  const canonicalParent = canonicalizePotentialPath(resolvedParent)
  const canonicalRoot = canonicalizePotentialPath(resolvedRoot)
  if (!isContainedPath(canonicalParent, canonicalRoot) || canonicalParent === canonicalRoot) {
    throw new Error(`[retale-test-path] Cleanup directory must stay inside its approved parent: ${ownedRoot}`)
  }
  readOwnershipMarker(resolvedRoot)
  fs.rmSync(resolvedRoot, { recursive: true, force: true })
}

export function removeOwnedTestTreeIfMarked(ownedRoot, approvedParent, options = {}) {
  if (!fs.existsSync(path.join(ownedRoot, TEST_OWNERSHIP_MARKER))) {
    return false
  }
  removeOwnedTestTree(ownedRoot, approvedParent, options)
  return true
}
