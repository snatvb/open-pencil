import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { stat, open, SeekMode } from '@tauri-apps/plugin-fs'
import { isEqual } from 'es-toolkit'
import { normalize } from 'pathe'
import * as v from 'valibot'

import type { Editor, EditorState } from '@open-pencil/core'
import { figThumbnailPageId } from '@open-pencil/core/io/formats/fig'
import { renderCachedThumbnail, renderThumbnail } from '@open-pencil/core/io/formats/raster'
import { extractFigThumbnailFromReader } from '@open-pencil/fig'

import {
  readCacheBytes,
  readCacheJSON,
  removeCachePrefix,
  writeCacheBytes,
  writeCacheJSON
} from '@/app/cache'
import { isFigArchiveName } from '@/app/document/io/names'
import { isTauri } from '@/app/tauri/env'

// One entry per file: its cover and the size and time of the file it was drawn for. v4 holds
// 800×450 covers; older ones are drawn again when a file next opens.
const RECENT_FILE_THUMBNAIL_CACHE_DIR = 'recent-file-thumbnails/v4'

const coverFingerprintSchema = v.strictObject({ size: v.number(), mtime: v.number() })
type CoverFingerprint = v.InferOutput<typeof coverFingerprintSchema>

/** The file's size and time now; null when they cannot be read, so nothing cached matches. */
async function fileFingerprint(path: string): Promise<CoverFingerprint | null> {
  try {
    const info = await stat(path)
    return { size: info.size, mtime: info.mtime?.getTime() ?? 0 }
  } catch (error) {
    console.warn('[Recent files] Could not stat the file for thumbnail caching', error)
    return null
  }
}

/** Where the cover of the file at `path` is cached, the same however the path spells its separators. */
export async function recentFileCoverEntry(
  path: string
): Promise<{ image: string; fingerprint: string }> {
  const hash = bytesToHex(sha256(utf8ToBytes(normalize(path))))
  const base = `${RECENT_FILE_THUMBNAIL_CACHE_DIR}/${hash}`
  return { image: `${base}.png`, fingerprint: `${base}.json` }
}

export async function loadCachedRecentFileThumbnail(path: string): Promise<Uint8Array | null> {
  if (!isTauri()) return null
  const [entry, current] = await Promise.all([recentFileCoverEntry(path), fileFingerprint(path)])
  if (!current) return null
  const cached = await readCacheJSON(entry.fingerprint, coverFingerprintSchema)
  if (!cached || !isEqual(cached, current)) return null
  const bytes = await readCacheBytes(entry.image)
  return bytes ? new Uint8Array(bytes) : null
}

/** Caches `bytes` as the file's cover, drawn for the file as `fingerprint` describes it. */
async function writeCover(
  path: string,
  bytes: Uint8Array,
  fingerprint: CoverFingerprint
): Promise<void> {
  const entry = await recentFileCoverEntry(path)
  await writeCacheBytes(entry.image, Uint8Array.from(bytes).buffer)
  await writeCacheJSON(entry.fingerprint, fingerprint)
}

export async function cacheRecentFileThumbnail(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri()) return
  const fingerprint = await fileFingerprint(path)
  if (fingerprint) await writeCover(path, bytes, fingerprint)
}

/**
 * A Home card's preview: the whole cover page centred on its colour in the card's 16:9, as Figma's
 * file browser shows it, 800 px wide like Figma's previews so a card stays sharp at 2×.
 */
const RECENT_FILE_COVER = { width: 800, height: 450 }

interface ShownDocument extends Pick<Editor, 'graph' | 'canvasRenderers'> {
  state: Pick<EditorState, 'sceneVersion'>
}

/**
 * The cover page as a Home card shows it, composed from the tiles a canvas of the document already
 * rendered for its current content; null until one holds the whole page, as when it is not shown.
 */
export function shownHomeCardCover({
  graph,
  canvasRenderers,
  state
}: ShownDocument): Uint8Array | null {
  const pageId = figThumbnailPageId(graph.getPages())
  if (!pageId) return null
  for (const renderer of canvasRenderers) {
    const cover = renderCachedThumbnail(
      renderer,
      graph,
      pageId,
      { ...RECENT_FILE_COVER, fit: 'letterbox' },
      state.sceneVersion
    )
    if (cover) return cover
  }
  return null
}

/**
 * Draws the cover page as a Home card shows it, from a canvas's tiles when they hold it and with
 * `renderer` from the scene otherwise; null when there is no page to draw.
 */
export function drawHomeCardCover(
  document: ShownDocument,
  renderer: NonNullable<Editor['renderer']>
): Uint8Array | null {
  const pageId = figThumbnailPageId(document.graph.getPages())
  if (!pageId) return null
  const { width, height } = RECENT_FILE_COVER
  return (
    shownHomeCardCover(document) ??
    renderThumbnail(renderer.ck, renderer, document.graph, pageId, width, height, 'letterbox')
  )
}

/** Cover writes still running, by file, so each file's covers are cached in the order drawn. */
const coverWrites = new Map<string, Promise<void>>()

/**
 * Caches `bytes`, a cover just drawn for the document at `path`, for the file as it is now, so
 * call it once the file is written. The file is read and the cover queued at once; caching waits
 * for the file's earlier covers, so the last one drawn is kept.
 */
export async function cacheRecentFileCover(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri()) return
  // Read now, for the file this cover was drawn from, but queued at once, so covers keep the
  // order they were drawn in however their reads finish.
  const fingerprint = fileFingerprint(path)
  const file = normalize(path)
  const previous = coverWrites.get(file) ?? Promise.resolve()
  const write = previous
    .catch(() => undefined)
    .then(() => fingerprint)
    .then((drawnFor) => (drawnFor ? writeCover(path, bytes, drawnFor) : undefined))
  coverWrites.set(file, write)
  try {
    await write
  } finally {
    if (coverWrites.get(file) === write) coverWrites.delete(file)
  }
}

/** Clears every cover once the writes already queued have landed, so none comes back. */
export async function clearRecentFileThumbnails(): Promise<void> {
  await Promise.allSettled(coverWrites.values())
  await removeCachePrefix(RECENT_FILE_THUMBNAIL_CACHE_DIR)
}

export async function loadRecentFileThumbnail(path: string): Promise<Uint8Array | null> {
  if (!isTauri() || !isFigArchiveName(path)) return null
  const cached = await loadCachedRecentFileThumbnail(path)
  if (cached) return cached
  const file = await open(path, { read: true })
  try {
    const info = await file.stat()
    return await extractFigThumbnailFromReader({
      size: info.size,
      async read(start, endExclusive) {
        await file.seek(start, SeekMode.Start)
        const bytes = new Uint8Array(endExclusive - start)
        let offset = 0
        while (offset < bytes.byteLength) {
          const count = await file.read(bytes.subarray(offset))
          if (count === null) break
          offset += count
        }
        return offset === bytes.byteLength ? bytes : bytes.subarray(0, offset)
      }
    })
  } finally {
    await file.close()
  }
}
