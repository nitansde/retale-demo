import { exportPresetCompatPreset, exportPresetCompatStandaloneRegex } from '@/lib/preset-compat/export'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import { requestClientGet } from '@/lib/client-request-broker'

export type PresetCompatImportKind = 'preset' | 'regex'
export type PresetCompatImportConflictPolicy = 'copy' | 'replace'

type ErrorResponse = {
  ok?: boolean
  error?: string
  library?: PresetCompatLibrary
}

export type SavePresetCompatLibraryResult = {
  ok: true
  library: PresetCompatLibrary
}

export type ImportPresetCompatPayloadParams = {
  kind: PresetCompatImportKind
  jsonText: string
  conflictPolicy?: PresetCompatImportConflictPolicy
  nameHint?: string
}

export type ImportPresetCompatPayloadResult = {
  ok: true
  library: PresetCompatLibrary
  importedIds: string[]
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function parseJson(response: Response) {
  try {
    return await response.json()
  } catch {
    throw new Error('Preset-compatible endpoint returned invalid JSON')
  }
}

async function expectOkResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await parseJson(response)
  if (!response.ok) {
    const error = isRecord(data) ? data as ErrorResponse : null
    throw new Error(error?.error || fallbackMessage)
  }
  return data as T
}

export async function fetchPresetCompatLibrary(signal?: AbortSignal) {
  return requestClientGet('/api/settings/preset-compat', {
    cache: 'no-cache',
    signal,
    parse: (response) => expectOkResponse<PresetCompatLibrary>(response, 'Failed to load preset-compatible library'),
  })
}

export async function savePresetCompatLibrary(library: PresetCompatLibrary): Promise<SavePresetCompatLibraryResult> {
  const response = await fetch('/api/settings/preset-compat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      library,
      expectedRevision: library.revision,
    }),
  })

  const data = await parseJson(response)
  if (!response.ok || !isRecord(data) || data.ok !== true || !('library' in data)) {
    const error = isRecord(data) ? data as ErrorResponse : null
    throw new Error(error?.error || 'Failed to save preset-compatible library')
  }

  return data as SavePresetCompatLibraryResult
}

export async function importPresetCompatPayload(
  params: ImportPresetCompatPayloadParams
): Promise<ImportPresetCompatPayloadResult> {
  const response = await fetch('/api/settings/preset-compat/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: params.kind,
      jsonText: params.jsonText,
      conflictPolicy: params.conflictPolicy,
      nameHint: params.nameHint,
    }),
  })

  const data = await parseJson(response)
  if (
    !response.ok
    || !isRecord(data)
    || data.ok !== true
    || !('library' in data)
    || !Array.isArray(data.importedIds)
    || !Array.isArray(data.warnings)
  ) {
    const error = isRecord(data) ? data as ErrorResponse : null
    throw new Error(error?.error || 'Failed to import preset-compatible payload')
  }

  return {
    ok: true,
    library: data.library as PresetCompatLibrary,
    importedIds: data.importedIds.filter((item): item is string => typeof item === 'string'),
    warnings: data.warnings.filter((item): item is string => typeof item === 'string'),
  }
}

export function exportPresetCompatPresetJson(library: PresetCompatLibrary, presetId: string) {
  const preset = library.presets[presetId]
  if (!preset) {
    throw new Error('Preset-compatible preset not found')
  }

  return JSON.stringify(exportPresetCompatPreset(preset), null, 2)
}

export function exportPresetCompatStandaloneRegexJson(library: PresetCompatLibrary, regexIds?: string[]) {
  const regexRecords = (regexIds ?? Object.keys(library.standaloneRegexes))
    .map((regexId) => library.standaloneRegexes[regexId])
    .filter((regexRecord) => Boolean(regexRecord))

  return JSON.stringify(exportPresetCompatStandaloneRegex(regexRecords), null, 2)
}
