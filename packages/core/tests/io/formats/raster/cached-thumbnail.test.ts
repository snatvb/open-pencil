import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'

import {
  createGridScene,
  isPending,
  renderFramesWhile,
  renderUntilSettled
} from '#core-tests/canvas/renderer/tiles/helpers'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import {
  createCanvasKitRasterCodec,
  renderCachedThumbnail,
  renderThumbnail
} from '@open-pencil/core/io/formats/raster'
import { expectDefined } from '@open-pencil/test-support/assert'

import type { SkiaRenderer } from '#core/canvas'
import { getPageColor } from '#core/figma-api/page-backgrounds'
import { fontManager } from '#core/text/font/manager'
import { fontResolver } from '#core/text/resolver'

const COVER = { width: 400, height: 225, fit: 'letterbox' as const }

let ck: Awaited<ReturnType<typeof getCanvasKit>>
const cleanups: Array<() => void> = []

beforeAll(async () => {
  ck = await getCanvasKit()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

function shownGrid() {
  const scene = createGridScene(ck)
  const { r, g, b } = getPageColor(scene.graph.getNode(scene.pageId))
  scene.renderer.pageColor = { r, g, b, a: 1 }
  scene.renderer.fontsLoaded = true
  cleanups.push(() => scene.renderer.destroy())
  return { ...scene, controller: scene.renderer.tiledScene }
}

function decode(png: Uint8Array) {
  return expectDefined(createCanvasKitRasterCodec(ck).decode(png), 'decoded cover')
}

function differenceRatio(a: Uint8Array, b: Uint8Array): number {
  let different = 0
  for (let index = 0; index < a.length; index++) {
    if (Math.abs(a[index] - b[index]) > 24) {
      different++
    }
  }
  return different / a.length
}

function meanDifference(a: Uint8Array, b: Uint8Array): number {
  let total = 0
  for (let index = 0; index < a.length; index++) {
    total += Math.abs(a[index] - b[index])
  }
  return total / a.length
}

/** The mean of each `factor` x `factor` block of RGBA pixels, as a box filter supersamples. */
function boxDownsample(
  image: { data: Uint8Array; width: number; height: number },
  factor: number
): Uint8Array {
  const width = image.width / factor
  const height = image.height / factor
  const result = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            sum += image.data[((y * factor + dy) * image.width + x * factor + dx) * 4 + channel]
          }
        }
        result[(y * width + x) * 4 + channel] = Math.round(sum / (factor * factor))
      }
    }
  }
  return result
}

function cachedCover(renderer: SkiaRenderer, scene: ReturnType<typeof shownGrid>, generation = 1) {
  return renderCachedThumbnail(renderer, scene.graph, scene.pageId, COVER, generation)
}

describe('thumbnail from cached tiles', () => {
  test('has nothing before the page has been shown', () => {
    const scene = shownGrid()

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('matches the page drawn from the scene once its tiles are rendered', () => {
    const scene = shownGrid()
    expect(renderUntilSettled(scene.controller, scene).covered).toBe(true)

    const fromTiles = decode(expectDefined(cachedCover(scene.renderer, scene), 'cached cover'))
    const fromScene = decode(
      expectDefined(
        renderThumbnail(ck, scene.renderer, scene.graph, scene.pageId, 400, 225, 'letterbox'),
        'scene cover'
      )
    )

    expect([fromTiles.width, fromTiles.height]).toEqual([400, 225])
    expect(differenceRatio(fromTiles.data, fromScene.data)).toBeLessThan(0.02)
  })

  test('has nothing while the rendered tiles hold only part of the page', () => {
    const scene = shownGrid()
    scene.renderer.zoom = 4
    const frame = renderFramesWhile(scene.controller, scene, 30, isPending)
    expect(frame.covered).toBe(true)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('does not frame the page while the rendered tiles hold only part of it', () => {
    const scene = shownGrid()
    scene.renderer.zoom = 4
    renderFramesWhile(scene.controller, scene, 30, isPending)
    const layerIds = new Set(scene.graph.getNode(scene.pageId)?.childIds)
    const getNode = spyOn(scene.graph, 'getNode')
    cleanups.push(() => getNode.mockRestore())

    expect(cachedCover(scene.renderer, scene)).toBeNull()
    expect(getNode.mock.calls.filter(([id]) => layerIds.has(id))).toEqual([])
  })

  test('stays near a supersampled page when it shrinks a cached level four times', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const quarterOfCoarsestLevel = { width: 37, height: 21, fit: 'letterbox' as const }
    const supersampling = 4

    const fromTiles = decode(
      expectDefined(
        renderCachedThumbnail(scene.renderer, scene.graph, scene.pageId, quarterOfCoarsestLevel, 1),
        'cached cover'
      )
    )
    const reference = boxDownsample(
      decode(
        expectDefined(
          renderThumbnail(
            ck,
            scene.renderer,
            scene.graph,
            scene.pageId,
            quarterOfCoarsestLevel.width * supersampling,
            quarterOfCoarsestLevel.height * supersampling,
            'letterbox'
          ),
          'supersampled cover'
        )
      ),
      supersampling
    )

    expect(meanDifference(fromTiles.data, reference)).toBeLessThan(7)
  })

  test('has nothing for content newer than its tiles or a page not shown', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const otherPage = scene.graph.addPage('Other')

    expect(cachedCover(scene.renderer, scene, 2)).toBeNull()
    scene.graph.createNode('RECTANGLE', otherPage.id, { width: 10, height: 10 })
    expect(renderCachedThumbnail(scene.renderer, scene.graph, otherPage.id, COVER, 1)).toBeNull()
  })

  test('has nothing while the tiles hold wide-gamut colors the sRGB cover cannot keep', () => {
    const scene = shownGrid()
    scene.renderer.presentationColorSpace = 'display-p3'
    renderUntilSettled(scene.controller, scene)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('has nothing while an edit awaits the next frame', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const edited = expectDefined(scene.graph.getChildren(scene.pageId)[0], 'first square')
    scene.graph.updateNode(edited.id, { fills: [] })
    scene.controller.invalidateNode(edited.id, scene.graph)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('has nothing while a decoded image preview awaits the next frame', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    scene.renderer.images.decodedPreviewHashes.add('decoded-image')

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('has nothing while an image preview is still decoding', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const { previews } = scene.renderer.images
    const decoding: Uint8Array[] = []
    previews.setDecoder({
      decode: (source) =>
        new Promise(() => {
          decoding.push(source)
        }),
      destroy: () => undefined
    })
    scene.graph.images.set('decoding-image', new Uint8Array([1, 2, 3]))
    previews.get(scene.graph, 'decoding-image', 256)
    expect(decoding).toHaveLength(1)
    expect(previews.idle).toBe(false)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('has nothing while a font is still being fetched', async () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const fetched = fontResolver.demand({
      key: 'face:cover-test:regular',
      candidates: [
        { id: 'registered', family: 'Cover Test', style: 'Regular', source: 'registered' }
      ]
    })
    expect(fontResolver.isLoading()).toBe(true)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
    await fetched
    expect(cachedCover(scene.renderer, scene)).not.toBeNull()
  })

  test('has nothing before the canvas loaded its fonts', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    scene.renderer.fontsLoaded = false

    expect(cachedCover(scene.renderer, scene)).toBeNull()
  })

  test('has nothing while text is kept off the tiles until its fonts resolve', () => {
    const scene = shownGrid()
    const text = scene.graph.createNode('TEXT', scene.pageId, { x: 0, y: 420, text: 'Cover' })
    fontManager.blockNodesUntilFontsResolve(scene.graph, [text.id])
    cleanups.push(() => fontManager.unblockNodes(scene.graph, [text.id]))
    renderUntilSettled(scene.controller, scene)

    expect(cachedCover(scene.renderer, scene)).toBeNull()
    fontManager.unblockNodes(scene.graph, [text.id])
    expect(cachedCover(scene.renderer, scene)).not.toBeNull()
  })

  test('shows an edit once the tiles it touched render again', () => {
    const scene = shownGrid()
    renderUntilSettled(scene.controller, scene)
    const before = decode(expectDefined(cachedCover(scene.renderer, scene), 'cover before'))
    const moved = expectDefined(scene.graph.getChildren(scene.pageId)[0], 'first square')
    scene.graph.updateNode(moved.id, { fills: [] })
    scene.controller.invalidateNode(moved.id, scene.graph)
    let frame = scene.controller.renderFrame(
      scene.renderer,
      scene.renderer.surface.getCanvas(),
      scene.graph,
      2,
      0
    )
    for (let count = 0; count < 30 && frame.pending; count++) {
      frame = scene.controller.renderFrame(
        scene.renderer,
        scene.renderer.surface.getCanvas(),
        scene.graph,
        2,
        0
      )
    }

    const after = decode(expectDefined(cachedCover(scene.renderer, scene, 2), 'cover after'))

    expect(differenceRatio(before.data, after.data)).toBeGreaterThan(0)
  })
})
