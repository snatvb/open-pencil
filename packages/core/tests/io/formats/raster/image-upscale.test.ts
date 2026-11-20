import { beforeAll, describe, expect, test } from 'bun:test'

import {
  encodeImage,
  imageFill,
  noiseImage,
  pixelsNotNearestAtCentres,
  rgbaInfo,
  shareOfImageColours,
  stripesImage,
  twoColourImage,
  type TestImage
} from '#core-tests/helpers/images'

import type { CanvasKit } from '@open-pencil/canvaskit'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { SceneGraph, type Fill, type SceneNode } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

let ck: CanvasKit

beforeAll(async () => {
  ck = await getCanvasKit()
})

interface Exported {
  width: number
  height: number
  pixels: Uint8Array
}

function exportLayer(
  image: TestImage,
  layer: Partial<SceneNode>,
  fill: Partial<Fill> = {},
  scale = 1
): Exported {
  const graph = new SceneGraph()
  graph.images.set('image', encodeImage(ck, image))
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    fills: [imageFill('image', fill)],
    ...layer
  })
  const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  try {
    const png = expectDefined(
      renderNodesToImage(ck, renderer, graph, graph.getPages()[0].id, [node.id], {
        scale,
        format: 'PNG'
      }),
      'png'
    )
    const exported = expectDefined(ck.MakeImageFromEncoded(png), 'export')
    const width = exported.width()
    const height = exported.height()
    const read = exported.readPixels(0, 0, rgbaInfo(ck, width, height))
    exported.delete()
    return { width, height, pixels: Uint8Array.from(expectDefined(read, 'export pixels')) }
  } finally {
    renderer.destroy()
  }
}

describe('raster export of an image scaled up', () => {
  test.each([24, 40])('keeps a 16 px image sharp on a %p px layer, as Figma does', (size) => {
    const output = exportLayer(twoColourImage(16), { width: size, height: size })

    expect(output.pixels).toEqual(twoColourImage(size).pixels)
  })

  test.each([
    ['noise', 24, noiseImage(16, 16)],
    ['noise', 40, noiseImage(16, 16)],
    ['noise', 48, noiseImage(16, 16)],
    ['stripes', 24, stripesImage(16)]
  ])(
    'takes each output pixel from the %s pixel nearest its centre, on a %p px layer',
    (_, size, image) => {
      const output = exportLayer(image, { width: size, height: size })

      expect(pixelsNotNearestAtCentres(output.pixels, image, size, size)).toBe(0)
    }
  )

  test('keeps it sharp through image adjustments', () => {
    const image = twoColourImage(16)
    const output = exportLayer(image, { width: 40, height: 40 }, { filters: { exposure: 0.4 } })
    const colours = new Set<string>()
    for (let offset = 0; offset < output.pixels.length; offset += 4) {
      colours.add(output.pixels.subarray(offset, offset + 3).join(','))
    }

    expect(colours.size).toBe(2)
  })

  test('takes each output pixel from one adjusted image pixel at 1.5x', () => {
    const image = noiseImage(16, 16)
    const filters = { filters: { exposure: 0.4, contrast: 0.2 } }
    const colours = (output: Exported) => {
      const found = new Set<string>()
      for (let offset = 0; offset < output.pixels.length; offset += 4) {
        found.add(output.pixels.subarray(offset, offset + 4).join(','))
      }
      return found
    }
    const atOwnSize = colours(exportLayer(image, { width: 16, height: 16 }, filters))
    const enlarged = colours(exportLayer(image, { width: 24, height: 24 }, filters))

    expect([...enlarged].filter((colour) => !atOwnSize.has(colour))).toEqual([])
  })

  test('copies each pixel into a block when the export doubles an image at its own size', () => {
    const image = noiseImage(32, 24)
    const output = exportLayer(image, { width: 32, height: 24 }, {}, 2)
    const doubled = new Uint8Array(64 * 48 * 4)
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const from = (Math.floor(y / 2) * 32 + Math.floor(x / 2)) * 4
        doubled.set(image.pixels.subarray(from, from + 4), (y * 64 + x) * 4)
      }
    }

    expect(output.pixels).toEqual(doubled)
  })

  test('keeps a turned image sharp', () => {
    const image = noiseImage(16, 16)
    const output = exportLayer(image, { width: 64, height: 64, rotation: 30 })

    expect(shareOfImageColours(output.pixels, image)).toBe(1)
  })
})

describe('raster export of an image not scaled up every way', () => {
  test('smooths an image scaled down', () => {
    const image = noiseImage(32, 24)
    const output = exportLayer(image, { width: 16, height: 12 })

    expect(shareOfImageColours(output.pixels, image)).toBeLessThan(0.1)
  })

  test('smooths an image stretched one way and squeezed the other', () => {
    const image = noiseImage(32, 24)
    const output = exportLayer(
      image,
      { width: 64, height: 12 },
      {
        imageScaleMode: 'CROP',
        imageTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    )

    expect(shareOfImageColours(output.pixels, image)).toBeLessThan(0.1)
  })
})
