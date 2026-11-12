import type { CanvasKit, Image } from '@open-pencil/canvaskit'
import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

export function unpremultipliedPixels(ck: CanvasKit, image: Image) {
  return expectDefined(
    image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB
    }),
    'pixels'
  )
}

/** A frame exported as a PNG at scale 1, unpremultiplied, and the margin the export adds per side. */
export function exportedFramePixels(
  ck: CanvasKit,
  renderer: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  frameId: string
): { pixels: ReturnType<typeof unpremultipliedPixels>; width: number; offset: number } {
  const frameWidth = expectDefined(graph.getNode(frameId), 'frame').width
  const png = expectDefined(
    renderNodesToImage(ck, renderer, graph, pageId, [frameId], {
      scale: 1,
      format: 'PNG',
      trimTransparent: false
    })
  )
  const image = expectDefined(ck.MakeImageFromEncoded(png))
  try {
    return {
      pixels: unpremultipliedPixels(ck, image),
      width: image.width(),
      offset: (image.width() - frameWidth) / 2
    }
  } finally {
    image.delete()
  }
}
