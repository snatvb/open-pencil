import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

import {
  encodeImage,
  imageFill,
  noiseImage,
  rgbaInfo,
  shareOfImageColours,
  type TestImage
} from '#core-tests/helpers/images'

import type { Canvas, CanvasKit, SkPicture } from '@open-pencil/canvaskit'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { imageFillMatrix } from '@open-pencil/scene-graph/images'
import Matrix from '@open-pencil/scene-graph/matrix'
import { expectDefined } from '@open-pencil/test-support/assert'

import { SkiaRenderer } from '#core/canvas'
import { applyImageFill } from '#core/canvas/fills/paint'
import { imageSampling, type ImageSampling } from '#core/canvas/images/sampling'
import { RenderChunkIndex, RenderChunkPictureCache } from '#core/canvas/renderer/chunks'

let ck: CanvasKit
const cleanups: Array<() => void> = []

beforeAll(async () => {
  ck = await getCanvasKit()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup()
  }
})

function makeRenderer(): SkiaRenderer {
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
  cleanups.push(() => renderer.destroy())
  return renderer
}

function graphWithImage(image: TestImage, layer: Partial<SceneNode>) {
  const graph = new SceneGraph()
  graph.images.set('image', encodeImage(ck, image))
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    fills: [imageFill('image')],
    ...layer
  })
  return { graph, node }
}

function drawnPixels(width: number, height: number, draw: (canvas: Canvas) => void) {
  const surface = expectDefined(ck.MakeSurface(width, height), 'surface')
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    draw(canvas)
    surface.flush()
    return Uint8Array.from(
      expectDefined(canvas.readPixels(0, 0, rgbaInfo(ck, width, height)), 'pixels')
    )
  } finally {
    surface.dispose()
  }
}

const SHADOW = {
  type: 'DROP_SHADOW' as const,
  color: { r: 0, g: 0, b: 0, a: 0.5 },
  offset: { x: 200, y: 200 },
  radius: 0,
  spread: 0,
  visible: true
}

describe('image sampling on the canvas', () => {
  test('a tile picture records again when its image turns from shrunk to enlarged', () => {
    const image = noiseImage(32, 24)
    const { graph, node } = graphWithImage(image, { width: 32, height: 24, effects: [SHADOW] })
    const { index } = RenderChunkIndex.build(graph, graph.getPages()[0].id)
    cleanups.push(() => index.dispose())
    const chunk = expectDefined(index.getChunksForNode(node.id)[0], 'chunk')
    const cache = new RenderChunkPictureCache()
    cleanups.push(() => cache.clear())
    const renderer = makeRenderer()
    const atDetail = (detail: number) => {
      renderer.images.detailScale = detail
      return cache.get(renderer, graph, chunk)
    }
    const shownFourTimes = (picture: SkPicture) =>
      shareOfImageColours(
        drawnPixels(128, 96, (canvas) => {
          canvas.scale(4, 4)
          canvas.drawPicture(picture)
        }),
        image
      )

    const enlarged = atDetail(4)
    expect(shownFourTimes(enlarged)).toBeGreaterThan(0.9)
    expect(atDetail(3)).toBe(enlarged)

    const shrunk = atDetail(0.5)
    expect(shrunk).not.toBe(enlarged)
    expect(shownFourTimes(shrunk)).toBeLessThan(0.1)

    expect(shownFourTimes(atDetail(4))).toBeGreaterThan(0.9)
  })

  test('a tile level and its backdrop each keep their own picture', () => {
    const { graph, node } = graphWithImage(noiseImage(32, 24), { width: 32, height: 24 })
    const { index } = RenderChunkIndex.build(graph, graph.getPages()[0].id)
    cleanups.push(() => index.dispose())
    const chunk = expectDefined(index.getChunksForNode(node.id)[0], 'chunk')
    const cache = new RenderChunkPictureCache()
    cleanups.push(() => cache.clear())
    const renderer = makeRenderer()
    const atDetail = (detail: number) => {
      renderer.images.detailScale = detail
      return cache.get(renderer, graph, chunk)
    }

    const visible = atDetail(2)
    const backdrop = atDetail(0.5)

    const named = (picture: SkPicture) => {
      if (picture === visible) {
        return 'visible'
      }
      return picture === backdrop ? 'backdrop' : 'recorded again'
    }

    expect(backdrop).not.toBe(visible)
    expect([atDetail(2), atDetail(0.5), atDetail(1), atDetail(2)].map(named)).toEqual([
      'visible',
      'backdrop',
      'backdrop',
      'visible'
    ])
  })
})

describe('image sampling of the whole scene picture', () => {
  test('records the scene again when a zoom enlarges an image it drew shrunk', () => {
    const image = noiseImage(32, 24)
    const { graph } = graphWithImage(image, { width: 32, height: 24 })
    const surface = expectDefined(ck.MakeSurface(128, 96), 'surface')
    const renderer = new SkiaRenderer(ck, surface)
    cleanups.push(() => renderer.destroy())
    renderer.pageId = graph.getPages()[0].id
    renderer.viewportWidth = 128
    renderer.viewportHeight = 96
    renderer.showRulers = false
    const renderAtZoom = (zoom: number) => {
      renderer.zoom = zoom
      renderer.render(graph, new Set(), {}, 1)
      surface.flush()
      return Uint8Array.from(
        expectDefined(surface.getCanvas().readPixels(0, 0, rgbaInfo(ck, 128, 96)), 'scene pixels')
      )
    }

    renderAtZoom(0.5)
    const shrunk = expectDefined(renderer.wholeScene.pictures.at(0.5), 'shrunk scene picture')

    expect(shareOfImageColours(renderAtZoom(4), image)).toBeGreaterThan(0.9)
    renderAtZoom(0.5)
    expect(renderer.wholeScene.pictures.at(0.5)).toBe(shrunk)
  })
})

describe('image sampling of a preview', () => {
  async function previewShare(original: TestImage, preview: TestImage, layer: Partial<SceneNode>) {
    const { graph, node } = graphWithImage(original, layer)
    const renderer = makeRenderer()
    renderer.images.previews.setDecoder({
      decode: async () => ({
        bytes: Uint8Array.from(encodeImage(ck, preview)),
        originalWidth: original.width,
        originalHeight: original.height
      }),
      destroy: () => undefined
    })
    renderer.viewportImageRendering = true
    renderer.images.detailScale = 1
    const paint = new ck.Paint()
    cleanups.push(() => paint.delete())
    applyImageFill(renderer, node.fills[0], node, graph, paint)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(applyImageFill(renderer, node.fills[0], node, graph, paint)).toBe(true)
    const pixels = drawnPixels(node.width, node.height, (canvas) => {
      canvas.drawRect(ck.LTRBRect(0, 0, node.width, node.height), paint)
    })
    return shareOfImageColours(pixels, preview)
  }

  test('smooths a downscaled preview of an image the view shrinks', async () => {
    const share = await previewShare(noiseImage(64, 64), noiseImage(16, 16), {
      width: 32,
      height: 32
    })

    expect(share).toBeLessThan(0.1)
  })

  test('keeps a preview at the image’s own size sharp where the view enlarges it', async () => {
    const image = noiseImage(16, 16)
    const share = await previewShare(image, image, { width: 64, height: 64 })

    expect(share).toBeGreaterThan(0.9)
  })
})

describe('image sampling in a supersampled export', () => {
  function exportSampling(
    layer: Partial<SceneNode>,
    exportScale: number,
    supersampled = true
  ): ImageSampling {
    const { graph, node } = graphWithImage(noiseImage(16, 16), layer)
    const renderer = makeRenderer()
    const outputFromWorld = Matrix.scaled(exportScale, exportScale)
    renderer.images.supersampledOutput = supersampled ? { outputFromWorld } : null
    renderer.images.detailScale = exportScale
    const localMatrix = imageFillMatrix(node.fills[0], node, 16, 16)
    return imageSampling(renderer, node, graph, localMatrix, true)
  }

  test.each([
    ['at its own size', { width: 16, height: 16 }, 1],
    ['doubled', { width: 32, height: 32 }, 1],
    ['at its own size exported at 3x', { width: 16, height: 16 }, 3],
    ['doubled at a whole pixel offset', { x: 5, y: 7, width: 32, height: 32 }, 1],
    ['doubled and turned a quarter', { x: 32, width: 32, height: 32, rotation: 90 }, 1],
    ['doubled and flipped', { width: 32, height: 32, flipX: true }, 1]
  ])(
    'samples an image %s nearest without moving samples to output pixel centres',
    (_, layer, scale) => {
      expect(exportSampling(layer, scale)).toBe('nearest')
    }
  )

  test.each([
    ['scaled 1.5x', { width: 24, height: 24 }, 1],
    ['doubled at half a pixel', { x: 0.5, width: 32, height: 32 }, 1],
    ['at its own size exported at 1.5x', { width: 16, height: 16 }, 1.5]
  ])('moves samples of an image %s to output pixel centres', (_, layer, scale) => {
    expect(exportSampling(layer, scale)).toBe('nearest-at-output-pixel-centres')
  })

  test('smooths an image at its own size off the output pixel grid', () => {
    expect(exportSampling({ x: 0.5, width: 16, height: 16 }, 1)).toBe('smooth')
  })

  test('samples an enlarged image nearest when the export is not supersampled', () => {
    expect(exportSampling({ width: 24, height: 24 }, 1, false)).toBe('nearest')
  })
})
