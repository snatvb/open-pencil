import { expect, test } from '@playwright/test'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToSVG } from '@open-pencil/core/io/formats/svg'
import { SceneGraph, type Fill } from '@open-pencil/scene-graph'

import {
  browserRaster,
  canvasRaster,
  pixel,
  type Raster,
  type RGB
} from '#tests/helpers/export/raster'

const SIZE = 40
const GAP = 10
const IMAGE_HASH = 'svg-paint-opacity-image'

const WHITE: Fill = { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
const BLACK: Fill = { ...WHITE, color: { r: 0, g: 0, b: 0, a: 1 } }

function gradient(type: Fill['type'], from: RGB, to: RGB, opacity: number): Fill {
  const color = ([r, g, b]: RGB) => ({ r, g, b, a: 1 })
  return {
    type,
    color: color(from),
    opacity,
    visible: true,
    gradientStops: [
      { position: 0, color: color(from) },
      { position: 1, color: color(to) }
    ],
    gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
  }
}

const RED_TO_BLUE = (type: Fill['type']) => gradient(type, [1, 0, 0], [0, 0, 1], 0.5)

const IMAGE: Fill = {
  type: 'IMAGE',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 0.5,
  visible: true,
  imageHash: IMAGE_HASH,
  imageScaleMode: 'FILL'
}

const SQUARE_FILLS: Fill[][] = [
  [RED_TO_BLUE('GRADIENT_LINEAR')],
  [RED_TO_BLUE('GRADIENT_RADIAL')],
  [IMAGE],
  [BLACK, RED_TO_BLUE('GRADIENT_LINEAR')]
]

async function solidGreenPNG(): Promise<Uint8Array> {
  const ck = await getCanvasKit()
  const surface = ck.MakeSurface(4, 4)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.Color(0, 160, 0, 1))
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('no PNG')
  return png
}

async function buildScene(): Promise<{ graph: SceneGraph; pageId: string; frameId: string }> {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.images.set(IMAGE_HASH, await solidGreenPNG())
  const frame = graph.createNode('FRAME', pageId, {
    width: SQUARE_FILLS.length * (SIZE + GAP) + 80,
    height: SIZE + 2 * GAP,
    fills: [WHITE]
  })
  for (const [index, fills] of SQUARE_FILLS.entries()) {
    graph.createNode('RECTANGLE', frame.id, {
      x: GAP + index * (SIZE + GAP),
      y: GAP,
      width: SIZE,
      height: SIZE,
      fills
    })
  }
  graph.createNode('TEXT', frame.id, {
    x: GAP + SQUARE_FILLS.length * (SIZE + GAP),
    y: 0,
    width: 60,
    height: SIZE + 2 * GAP,
    text: 'H',
    fontSize: 56,
    fontWeight: 700,
    fills: [gradient('GRADIENT_LINEAR', [0, 0, 1], [0, 0, 1], 0.5)]
  })
  return { graph, pageId, frameId: frame.id }
}

function mostCoveredTextPixel(raster: Raster): RGB {
  const left = GAP + SQUARE_FILLS.length * (SIZE + GAP)
  let deepest: RGB = [255, 255, 255]
  for (let y = 0; y < SIZE + 2 * GAP; y++) {
    for (let x = left; x < left + 60; x++) {
      const rgb = pixel(raster, x, y)
      if (rgb[0] < deepest[0]) deepest = rgb
    }
  }
  return deepest
}

function expectClose(actual: RGB, expected: RGB, label: string) {
  for (const [channel, value] of expected.entries()) {
    expect(
      Math.abs(actual[channel] - value),
      `${label}: SVG ${actual} vs canvas ${expected}`
    ).toBeLessThanOrEqual(2)
  }
}

test('gradient and image fills export at the opacity the canvas paints them', async ({ page }) => {
  const { graph, pageId, frameId } = await buildScene()
  const svg = renderNodesToSVG(graph, pageId, [frameId], { xmlDeclaration: false })
  if (!svg) throw new Error('nothing exported')
  const [canvas, browser] = await Promise.all([
    canvasRaster(graph, pageId, frameId, 'Bold'),
    browserRaster(page, svg)
  ])
  const centre = GAP + SIZE / 2
  for (const [index, fills] of SQUARE_FILLS.entries()) {
    const x = GAP + index * (SIZE + GAP) + SIZE / 2
    expectClose(
      pixel(browser, x, centre),
      pixel(canvas, x, centre),
      fills.map((fill) => fill.type).join('+')
    )
  }
  expectClose(mostCoveredTextPixel(browser), mostCoveredTextPixel(canvas), 'TEXT')
})
