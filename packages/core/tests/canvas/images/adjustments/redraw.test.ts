import { describe, expect, spyOn, test } from 'bun:test'

import {
  countSwatchBakes,
  drawnOnFrame,
  exportedSwatches,
  filled,
  imagePaint,
  SWATCH_IMAGE,
  swatchScene,
  TOO_SMALL_FOR_SWATCHES,
  withRenderer,
  withRendererUntilDone
} from '#core-tests/canvas/images/adjustments/swatches'

import type { ImageFilters } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { createImageCache, decodedImageBytes } from '#core/canvas/images/cache'
import { exportPDFDocument } from '#core/io/formats/pdf'

const FILTERS: ImageFilters = { exposure: 0.3, saturation: 0.6 }
const PAGES = 3

describe('redrawing adjusted images', () => {
  test('new filters on the same renderer draw the new values', () => {
    const scene = swatchScene({ fills: [imagePaint({ exposure: -1 })] })
    withRenderer((renderer) => {
      const steps: (ImageFilters | undefined)[] = [
        { exposure: -1 },
        { exposure: 1 },
        { exposure: 0.3 },
        { saturation: 1 },
        undefined
      ]
      for (const filters of steps) {
        scene.graph.updateNode(scene.layerId, { fills: [imagePaint(filters)] })
        expect(exportedSwatches(renderer, scene)).toEqual(filled(filters))
      }
    })
  })

  test('an adjusted image keeps only its adjusted copy, not the stored image too', () => {
    const scene = swatchScene({ fills: [imagePaint(FILTERS)] })
    withRenderer((renderer) => {
      exportedSwatches(renderer, scene)
      expect(renderer.images.cache.weight).toBe(decodedImageBytes(SWATCH_IMAGE))
    })
  })

  test('an image too big for the image cache is adjusted once per export and let go after it', async () => {
    const scene = swatchScene({ fills: [imagePaint(FILTERS)] })
    const pages = Array.from({ length: PAGES }, () => ({
      pageId: scene.pageId,
      nodeIds: [scene.frameId]
    }))
    const bakes = countSwatchBakes()
    try {
      await withRendererUntilDone(async (renderer) => {
        renderer.images.cache = createImageCache(TOO_SMALL_FOR_SWATCHES)
        const pdf = expectDefined(await exportPDFDocument(scene.graph, pages, { renderer }), 'PDF')
        expect(pdf.pages).toHaveLength(PAGES)
        expect(renderer.images.adjustedOverBudget.size).toBe(0)
      })
      expect(bakes.count()).toBe(1)
    } finally {
      bakes.restore()
    }
  })

  test('on a GPU canvas, an image too big for the image cache is adjusted while drawn', () => {
    const scene = swatchScene({ fills: [imagePaint(FILTERS)] })
    const baked = withRenderer((renderer) => drawnOnFrame(renderer, scene))
    const bakes = countSwatchBakes()
    try {
      withRenderer((renderer) => {
        renderer.images.cache = createImageCache(TOO_SMALL_FOR_SWATCHES)
        const gpu = spyOn(renderer.surface, 'reportBackendTypeIsGPU').mockReturnValue(true)
        try {
          for (const [index, color] of drawnOnFrame(renderer, scene).entries()) {
            for (const [channel, value] of color.entries()) {
              expect(Math.abs(value - baked[index][channel])).toBeLessThanOrEqual(1)
            }
          }
          expect(bakes.count()).toBe(0)
          exportedSwatches(renderer, scene)
          expect(bakes.count()).toBe(1)
        } finally {
          gpu.mockRestore()
        }
      })
    } finally {
      bakes.restore()
    }
  })
})
