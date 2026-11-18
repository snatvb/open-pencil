import { promiseTimeout } from '@vueuse/core'
import { normalize } from 'pathe'

import type { Editor, EditorState } from '@open-pencil/core'
import { figThumbnailPageId } from '@open-pencil/core/io/formats/fig'

import type { EditorStore } from '@/app/editor/session'
import {
  cacheRecentFileCover,
  loadCachedRecentFileThumbnail,
  shownHomeCardCover
} from '@/app/recent-files'

const RENDERER_WAIT_ATTEMPTS = 240
const SHOWN_TILES_WAIT_MS = 5_000
const WAIT_STEP_MS = 250

/** What of an open document its cover job reads. */
export interface CoverDocument
  extends
    Pick<Editor, 'graph' | 'renderer' | 'canvasRenderers'>,
    Pick<EditorStore, 'hasUnsavedChanges'> {
  state: Pick<EditorState, 'currentPageId' | 'sceneVersion'>
}

type Renderer = NonNullable<CoverDocument['renderer']>

/** Per open `.fig` document, stops listening for its cover page to show. */
const coverThumbnailListeners = new WeakMap<CoverDocument, () => void>()
const coverJobsByPath = new Map<string, { document: CoverDocument; job: Promise<void> }>()
const closedDocuments = new WeakSet<CoverDocument>()

async function waitForRenderer(document: CoverDocument): Promise<Renderer | null> {
  for (
    let attempt = 0;
    attempt < RENDERER_WAIT_ATTEMPTS && !document.renderer && !closedDocuments.has(document);
    attempt++
  ) {
    await promiseTimeout(WAIT_STEP_MS)
  }
  return closedDocuments.has(document) ? null : document.renderer
}

function tilesMayCoverSavedFile(
  document: CoverDocument,
  renderer: Renderer,
  pageId: string
): boolean {
  return (
    !closedDocuments.has(document) &&
    document.renderer === renderer &&
    !renderer.isDestroyed() &&
    document.state.currentPageId === pageId &&
    document.canvasRenderers.some((canvas) => canvas.presentationColorSpace === 'srgb') &&
    !document.hasUnsavedChanges()
  )
}

/**
 * The cover composed from the canvas tiles once they hold the page; null when they do not
 * within `limitMs`, or the tab, page or renderer goes, or the document is edited first.
 */
export async function coverFromShownTiles(
  document: CoverDocument,
  renderer: Renderer,
  pageId: string,
  limitMs = SHOWN_TILES_WAIT_MS
): Promise<Uint8Array | null> {
  const attempts = Math.ceil(limitMs / WAIT_STEP_MS)
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!tilesMayCoverSavedFile(document, renderer, pageId)) {
      return null
    }
    const covered = document.canvasRenderers.some((canvas) => canvas.tiledSceneCovered)
    const cover = covered ? shownHomeCardCover(document) : null
    if (cover) {
      return cover
    }
    await promiseTimeout(WAIT_STEP_MS)
  }
  return null
}

async function cacheOpenedFigCover(path: string, document: CoverDocument): Promise<void> {
  if (await loadCachedRecentFileThumbnail(path)) {
    return
  }
  // A document without a page has no cover, so it never waits for a renderer, and a cover page
  // not shown is not loaded: showing it caches the cover then.
  const thumbnailPageId = figThumbnailPageId(document.graph.getPages())
  if (!thumbnailPageId || thumbnailPageId !== document.state.currentPageId) {
    return
  }
  const renderer = await waitForRenderer(document)
  if (!renderer) {
    if (!closedDocuments.has(document)) {
      console.warn('[Recent files] Thumbnail skipped because the renderer was unavailable')
    }
    return
  }
  const cover = await coverFromShownTiles(document, renderer, thumbnailPageId)
  if (cover) {
    await cacheRecentFileCover(path, cover)
  }
}

/**
 * Caches the cover of a `.fig` file a tab shows, unless Recent files has it; a request while one
 * for the same file runs in a tab still open is skipped.
 */
export function refreshOpenedFigCover(path: string, document: CoverDocument): void {
  const key = normalize(path)
  const running = coverJobsByPath.get(key)
  if (running && !closedDocuments.has(running.document)) {
    return
  }
  const entry = {
    document,
    job: cacheOpenedFigCover(path, document)
      .catch((error: unknown) => {
        console.warn('[Recent files] Failed to cache the thumbnail', error)
      })
      .finally(() => {
        if (coverJobsByPath.get(key) === entry) {
          coverJobsByPath.delete(key)
        }
      })
  }
  coverJobsByPath.set(key, entry)
}

/** Caches a `.fig` file's cover again each time its tab shows the cover page. */
export function watchOpenedFigCover(path: string, store: EditorStore): void {
  coverThumbnailListeners.get(store)?.()
  const thumbnailPageId = figThumbnailPageId(store.graph.getPages())
  if (!thumbnailPageId) return
  coverThumbnailListeners.set(
    store,
    store.onEditorEvent('page:changed', (pageId) => {
      if (pageId !== thumbnailPageId) return
      refreshOpenedFigCover(path, store)
    })
  )
}

/** Stops caching the cover of the document `store` shows, as its tab goes, and ends its job. */
export function forgetOpenedFigCover(store: CoverDocument): void {
  coverThumbnailListeners.get(store)?.()
  coverThumbnailListeners.delete(store)
  closedDocuments.add(store)
}
