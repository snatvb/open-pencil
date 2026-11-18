import type { Canvas, Paint } from '@open-pencil/canvaskit'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { fontManager } from '#core/text/font/manager'
import { fontResolver } from '#core/text/resolver'

import type { CachedTile, TileImageCache } from './cache'
import {
  TILE_DEVICE_SIZE,
  tileCountForWorldBounds,
  tileKeysForWorldBounds,
  tileWorldBounds,
  type TileWorldBounds
} from './geometry'

/** Tiles that show all of `area`, the part of some bounds the page draws anything in. */
export interface CachedPage {
  area: TileWorldBounds
  tiles: readonly CachedTile[]
}

/**
 * Whether the renderer owes the shown tiles a redraw they do not hold yet: an image preview that
 * decoded since the last frame or is still decoding, fonts not loaded or still on their way, or
 * text of `graph` kept off the canvas until its fonts resolve.
 */
export function awaitsRedraw(renderer: SkiaRenderer, graph: SceneGraph): boolean {
  const { previews, decodedPreviewHashes } = renderer.images
  return (
    !previews.idle ||
    decodedPreviewHashes.size > 0 ||
    !renderer.fontsLoaded ||
    fontResolver.isLoading() ||
    fontManager.hasBlockedNodes(graph)
  )
}

/** A level this many tiles across `area` is not worth walking for a snapshot. */
const MAX_SNAPSHOT_TILES = 4096

function levelTiles(
  cache: TileImageCache,
  pageId: string,
  level: number,
  area: TileWorldBounds,
  contentGeneration: number
): CachedTile[] | null {
  if (tileCountForWorldBounds(level, area) > MAX_SNAPSHOT_TILES) {
    return null
  }
  const tiles: CachedTile[] = []
  for (const key of tileKeysForWorldBounds(pageId, level, area)) {
    const tile = cache.getIfPresent(key)
    if (tile?.contentGeneration !== contentGeneration) {
      return null
    }
    tiles.push(tile)
  }
  return tiles
}

/**
 * The tiles of one cached level that hold all of `area` as of `contentGeneration`: the coarsest
 * level at or above `scale`, so the snapshot is sharp without walking more tiles than it needs,
 * else the finest below it. Null when no level holds all of it.
 */
export function completeCachedLevel(
  cache: TileImageCache,
  pageId: string,
  area: TileWorldBounds,
  contentGeneration: number,
  scale: number
): CachedTile[] | null {
  const levels = cache.cachedLevels(pageId)
  const sharpFirst = [
    ...levels.filter((level) => level >= scale).sort((a, b) => a - b),
    ...levels.filter((level) => level < scale).sort((a, b) => b - a)
  ]
  for (const level of sharpFirst) {
    const tiles = levelTiles(cache, pageId, level, area, contentGeneration)
    if (tiles) {
      return tiles
    }
  }
  return null
}

/** Whether any cached level holds all of `area` as of `contentGeneration`. */
export function anyCompleteCachedLevel(
  cache: TileImageCache,
  pageId: string,
  area: TileWorldBounds,
  contentGeneration: number
): boolean {
  return cache
    .cachedLevels(pageId)
    .some((level) => levelTiles(cache, pageId, level, area, contentGeneration) !== null)
}

/**
 * Draws `tile` over its world rect through a mipmapped image shader, so a level shrunk several
 * times averages its pixels instead of skipping them.
 */
function drawTileShrunk(
  renderer: SkiaRenderer,
  canvas: Canvas,
  paint: Paint,
  tile: CachedTile
): void {
  if (!tile.image) {
    return
  }
  const { ck } = renderer
  const bounds = tileWorldBounds(tile.key)
  const pixelSize = (bounds.maxX - bounds.minX) / TILE_DEVICE_SIZE
  const shader = tile.image.makeShaderOptions(
    ck.TileMode.Clamp,
    ck.TileMode.Clamp,
    ck.FilterMode.Linear,
    ck.MipmapMode.Linear,
    ck.Matrix.multiply(
      ck.Matrix.translated(bounds.minX, bounds.minY),
      ck.Matrix.scaled(pixelSize, pixelSize)
    )
  )
  try {
    paint.setShader(shader)
    canvas.drawRect(ck.LTRBRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY), paint)
  } finally {
    paint.setShader(null)
    shader.delete()
  }
}

/** Draws `tiles` in world space; the canvas already carries the transform to its pixels. */
export function drawCachedPage(
  renderer: SkiaRenderer,
  canvas: Canvas,
  { area: clip, tiles }: CachedPage
): void {
  const { ck } = renderer
  const paint = new ck.Paint()
  paint.setAntiAlias(false)
  canvas.save()
  try {
    canvas.clipRect(
      ck.LTRBRect(clip.minX, clip.minY, clip.maxX, clip.maxY),
      ck.ClipOp.Intersect,
      true
    )
    for (const tile of tiles) {
      drawTileShrunk(renderer, canvas, paint, tile)
    }
  } finally {
    canvas.restore()
    paint.delete()
  }
}
