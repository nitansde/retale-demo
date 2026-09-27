import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getNovelStoragePaths } from '@/lib/server/db-resolver'

export const MAX_NOVEL_COVER_BYTES = 5 * 1024 * 1024

const COVER_FORMATS = [
  { fileName: 'cover.jpg', contentType: 'image/jpeg', matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { fileName: 'cover.png', contentType: 'image/png', matches: (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  { fileName: 'cover.webp', contentType: 'image/webp', matches: (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' },
] as const

function coverPath(novelId: string, fileName: string) {
  return path.join(getNovelStoragePaths(novelId).novelDirectory, fileName)
}

export function buildNovelCoverUrl(novelId: string, version?: string) {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : ''
  return `/api/novels/${encodeURIComponent(novelId)}/cover${suffix}`
}

export async function saveNovelCoverFile(novelId: string, file: File) {
  if (file.size <= 0 || file.size > MAX_NOVEL_COVER_BYTES) {
    throw new Error('Novel cover exceeds the allowed size')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = COVER_FORMATS.find((candidate) => candidate.contentType === file.type && candidate.matches(bytes))
  if (!format) throw new Error('Novel cover must be a valid JPG, PNG, or WebP image')

  const temporaryPath = coverPath(novelId, `.cover-${randomUUID()}.tmp`)
  await fs.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 })
  try {
    await deleteNovelCoverFile(novelId)
    await fs.rename(temporaryPath, coverPath(novelId, format.fileName))
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function deleteNovelCoverFile(novelId: string) {
  await Promise.all(COVER_FORMATS.map(({ fileName }) => (
    fs.unlink(coverPath(novelId, fileName)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  )))
}

async function findNovelCover(novelId: string) {
  for (const format of COVER_FORMATS) {
    try {
      const filePath = coverPath(novelId, format.fileName)
      const stat = await fs.lstat(filePath)
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_NOVEL_COVER_BYTES) return { filePath, format }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return null
}

export async function readNovelCoverFile(novelId: string) {
  const cover = await findNovelCover(novelId)
  if (!cover) return null
  const bytes = new Uint8Array(await fs.readFile(cover.filePath))
  return cover.format.matches(bytes) ? { bytes, contentType: cover.format.contentType } : null
}

export async function hasNovelCoverFile(novelId: string) {
  return (await findNovelCover(novelId)) !== null
}
