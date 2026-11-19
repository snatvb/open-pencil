import { expect, spyOn, test } from 'bun:test'

import {
  drawnOnFrame,
  filled,
  imagePaint,
  middlePixels,
  SWATCH,
  swatchScene,
  TOO_SMALL_FOR_SWATCHES,
  WIDTH,
  withRendererUntilDone
} from '#core-tests/canvas/images/adjustments/swatches'
import { unzlibSync } from 'fflate'

import type { Effect } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { createImageCache } from '#core/canvas/images/cache'
import { exportPDFDocument } from '#core/io/formats/pdf'

const FILTERS = { exposure: -1, contrast: -1 }
const RGB_CHANNELS = 3
const RGBA_CHANNELS = 4
const SHRINK_FACTOR = 4
const FAINT_SHADOW: Effect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 0.01 },
  offset: { x: 0, y: 0 },
  radius: 0,
  spread: 0,
  visible: true,
  blendMode: 'NORMAL'
}

interface EmbeddedImage {
  readonly width: number
  readonly height: number
  readonly samples: Uint8Array
}

function embeddedImages(pdf: Uint8Array): EmbeddedImage[] {
  const text = new TextDecoder('latin1').decode(pdf)
  const images: EmbeddedImage[] = []
  for (const opening of text.matchAll(/(?<!end)stream\r?\n/g)) {
    const header = text.slice(text.lastIndexOf(' obj', opening.index), opening.index)
    const width = /\/Width (\d+)/.exec(header)
    const height = /\/Height (\d+)/.exec(header)
    if (!header.includes('/Subtype /Image') || !width || !height) {
      continue
    }
    const from = opening.index + opening[0].length
    const body = pdf.subarray(from, text.indexOf('endstream', from))
    images.push({
      width: Number(width[1]),
      height: Number(height[1]),
      samples: header.includes('/FlateDecode') ? unzlibSync(body) : body
    })
  }
  return images
}

function asRgba({ samples, width, height }: EmbeddedImage): Uint8Array {
  const rgba = new Uint8Array(width * height * RGBA_CHANNELS)
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba.set(
      samples.subarray(pixel * RGB_CHANNELS, (pixel + 1) * RGB_CHANNELS),
      pixel * RGBA_CHANNELS
    )
  }
  return rgba
}

function expectAdjustedSwatchesEmbedded(pdf: Uint8Array) {
  const image = expectDefined(
    embeddedImages(pdf).find(({ width, height }) => width === WIDTH && height === SWATCH),
    'embedded swatch image'
  )
  const raster = filled(FILTERS)
  for (const [index, color] of middlePixels(asRgba(image)).entries()) {
    for (const [channel, value] of color.entries()) {
      expect(Math.abs(value - raster[index][channel])).toBeLessThanOrEqual(1)
    }
  }
}

test('PDF export embeds the adjusted image at its own size, as raster export draws it', async () => {
  const scene = swatchScene({ fills: [imagePaint(FILTERS)] })
  const pdf = expectDefined(
    await exportPDFDocument(scene.graph, [{ pageId: scene.pageId, nodeIds: [scene.frameId] }]),
    'PDF'
  )
  expectAdjustedSwatchesEmbedded(pdf.data)
})

test('PDF export embeds the adjusted image at its own size after a GPU frame drew it live', async () => {
  const scene = swatchScene({ fills: [imagePaint(FILTERS)] })
  const shrunk = { width: WIDTH / SHRINK_FACTOR, height: SWATCH / SHRINK_FACTOR }
  scene.graph.updateNode(scene.frameId, shrunk)
  scene.graph.updateNode(scene.layerId, { ...shrunk, effects: [FAINT_SHADOW] })
  const pages = [{ pageId: scene.pageId, nodeIds: [scene.frameId] }]
  const pdf = await withRendererUntilDone(async (renderer) => {
    renderer.images.cache = createImageCache(TOO_SMALL_FOR_SWATCHES)
    await renderer.prepareForExport(scene.graph, scene.pageId, [scene.frameId])
    const gpu = spyOn(renderer.surface, 'reportBackendTypeIsGPU').mockReturnValue(true)
    try {
      drawnOnFrame(renderer, scene)
    } finally {
      gpu.mockRestore()
    }
    return exportPDFDocument(scene.graph, pages, { renderer })
  })
  expectAdjustedSwatchesEmbedded(expectDefined(pdf, 'PDF').data)
})
