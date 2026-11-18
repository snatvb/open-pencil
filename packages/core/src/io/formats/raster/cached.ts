import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas'
import { drawCachedPage } from '#core/canvas/renderer/tiles/snapshot'
import { makeOffscreenSurface } from '#core/canvas/renderer/tiles/surface-pool'
import { getPageColor } from '#core/figma-api/page-backgrounds'

import { thumbnailFrame, type ThumbnailFit } from './render'

/**
 * `renderThumbnail` composed from the tiles the editor already rendered for the page as of
 * `contentGeneration`, which costs a few image draws where rendering a large page again costs
 * seconds. Null when the page is not the one shown, its tiles are not final yet, it has nothing
 * to frame, no cached level holds all of it, or the tiles hold colors of a wider gamut than the
 * sRGB image.
 */
export function renderCachedThumbnail(
  renderer: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  size: { width: number; height: number; fit?: ThumbnailFit },
  contentGeneration: number
): Uint8Array<ArrayBuffer> | null {
  const tiles = renderer.tiledScene
  if (
    renderer.presentationColorSpace !== 'srgb' ||
    !tiles.holdsPage(renderer, graph, pageId, contentGeneration)
  ) {
    return null
  }
  const frame = thumbnailFrame(graph, pageId, size.width, size.height, size.fit)
  if (!frame) {
    return null
  }
  const page = tiles.cachedPage(
    renderer,
    graph,
    pageId,
    frame.bounds,
    contentGeneration,
    frame.scale
  )
  if (!page) {
    return null
  }
  const { ck } = renderer
  const surface = makeOffscreenSurface(renderer, {
    width: frame.width,
    height: frame.height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Premul,
    colorSpace: ck.ColorSpace.SRGB
  })
  if (!surface) {
    return null
  }
  try {
    const canvas = surface.getCanvas()
    const background = getPageColor(graph.getNode(pageId))
    canvas.clear(ck.Color4f(background.r, background.g, background.b, 1))
    canvas.translate(-frame.bounds.minX * frame.scale, -frame.bounds.minY * frame.scale)
    canvas.scale(frame.scale, frame.scale)
    drawCachedPage(renderer, canvas, page)
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      const encoded = image.encodeToBytes(ck.ImageFormat.PNG, 100)
      return encoded ? new Uint8Array(encoded) : null
    } finally {
      image.delete()
    }
  } finally {
    surface.delete()
  }
}
