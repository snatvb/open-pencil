import { expect, spyOn } from 'bun:test'

import { expectRgbaPixels } from '#core-tests/canvas/helpers'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { SceneGraph, type Fill, type ImageFilters, type SceneNode } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { decodedImageBytes } from '#core/canvas/images/cache'

export const ck = await getCanvasKit()

export type RGB = readonly [number, number, number]

export const IMAGE = 'adjusted-swatches'
export const SWATCH = 8
export const SWATCHES: readonly RGB[] = [
  [0, 0, 0],
  [64, 64, 64],
  [128, 128, 128],
  [192, 192, 192],
  [255, 255, 255],
  [200, 120, 60],
  [60, 120, 200],
  [120, 200, 60]
]
export const WIDTH = SWATCH * SWATCHES.length
export const FIGMA_TOLERANCE = 2
export const SWATCH_IMAGE = { width: () => WIDTH, height: () => SWATCH }
export const TOO_SMALL_FOR_SWATCHES = decodedImageBytes(SWATCH_IMAGE) - 1

export function swatchBytes(alpha: number): Uint8Array {
  const surface = expectDefined(ck.MakeSurface(WIDTH, SWATCH), 'swatch surface')
  const canvas = surface.getCanvas()
  const paint = new ck.Paint()
  paint.setBlendMode(ck.BlendMode.Src)
  for (const [index, [red, green, blue]] of SWATCHES.entries()) {
    paint.setColor(ck.Color(red, green, blue, alpha))
    canvas.drawRect(ck.XYWHRect(index * SWATCH, 0, SWATCH, SWATCH), paint)
  }
  paint.delete()
  const image = surface.makeImageSnapshot()
  const bytes = expectDefined(image.encodeToBytes(ck.ImageFormat.PNG, 100), 'swatch PNG')
  image.delete()
  surface.delete()
  return bytes
}

export function imagePaint(filters?: ImageFilters, opacity = 1): Fill {
  return {
    type: 'IMAGE',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity,
    visible: true,
    imageHash: IMAGE,
    imageScaleMode: 'FILL',
    ...(filters && { filters })
  }
}

export type Paints = Partial<Pick<SceneNode, 'fills' | 'strokes' | 'strokeWeight' | 'strokeAlign'>>

export interface SwatchScene {
  readonly graph: SceneGraph
  readonly pageId: string
  readonly frameId: string
  readonly layerId: string
}

export function swatchScene(paints: Paints, imageAlpha = 1): SwatchScene {
  const graph = new SceneGraph()
  graph.images.set(IMAGE, swatchBytes(imageAlpha))
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, {
    width: WIDTH,
    height: SWATCH,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const layer = graph.createNode('RECTANGLE', frame.id, {
    width: WIDTH,
    height: SWATCH,
    fills: [],
    ...paints
  })
  return { graph, pageId, frameId: frame.id, layerId: layer.id }
}

export function middlePixels(pixels: Uint8Array): RGB[] {
  const middle = SWATCH / 2
  return SWATCHES.map((_, index) => {
    const offset = (middle * WIDTH + index * SWATCH + middle) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  })
}

export const SWATCH_PIXELS = {
  alphaType: ck.AlphaType.Unpremul,
  colorType: ck.ColorType.RGBA_8888,
  colorSpace: ck.ColorSpace.SRGB,
  width: WIDTH,
  height: SWATCH
}

export function exportedSwatches(renderer: SkiaRenderer, scene: SwatchScene): RGB[] {
  const { graph, pageId, frameId } = scene
  const png = expectDefined(
    renderNodesToImage(ck, renderer, graph, pageId, [frameId], { scale: 1, format: 'PNG' }),
    'png'
  )
  const image = expectDefined(ck.MakeImageFromEncoded(png), 'image')
  try {
    return middlePixels(expectRgbaPixels(image.readPixels(0, 0, SWATCH_PIXELS)))
  } finally {
    image.delete()
  }
}

export function withRenderer<T>(draw: (renderer: SkiaRenderer) => T): T {
  const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  try {
    return draw(renderer)
  } finally {
    renderer.destroy()
  }
}

export async function withRendererUntilDone<T>(
  draw: (renderer: SkiaRenderer) => Promise<T>
): Promise<T> {
  const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  try {
    return await draw(renderer)
  } finally {
    renderer.destroy()
  }
}

export function middlePixelOfEachSwatchOverBlack(paints: Paints, imageAlpha = 1): RGB[] {
  const scene = swatchScene(paints, imageAlpha)
  return withRenderer((renderer) => exportedSwatches(renderer, scene))
}

export function filled(filters?: ImageFilters, opacity?: number): RGB[] {
  return middlePixelOfEachSwatchOverBlack({ fills: [imagePaint(filters, opacity)] })
}

export function expectNear(
  actual: readonly RGB[],
  expected: readonly RGB[],
  tolerance = FIGMA_TOLERANCE
) {
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(Math.abs(actual[index][channel] - value)).toBeLessThanOrEqual(tolerance)
    }
  }
}

export function countSwatchBakes(): { count: () => number; restore: () => void } {
  const makeImage = ck.MakeImage.bind(ck)
  let bakes = 0
  const spy = spyOn(ck, 'MakeImage').mockImplementation((info, pixels, bytesPerRow) => {
    if (info.width === WIDTH && info.height === SWATCH) {
      bakes++
    }
    return makeImage(info, pixels, bytesPerRow)
  })
  return { count: () => bakes, restore: () => spy.mockRestore() }
}

export function drawnOnFrame(renderer: SkiaRenderer, scene: SwatchScene): RGB[] {
  const surface = expectDefined(ck.MakeSurface(WIDTH, SWATCH), 'frame surface')
  const viewport = renderer.worldViewport
  try {
    renderer.worldViewport = { x: 0, y: 0, w: WIDTH, h: SWATCH }
    renderer.renderNode(surface.getCanvas(), scene.graph, scene.frameId, {})
    surface.flush()
    return middlePixels(expectRgbaPixels(surface.getCanvas().readPixels(0, 0, SWATCH_PIXELS)))
  } finally {
    renderer.worldViewport = viewport
    surface.delete()
  }
}
