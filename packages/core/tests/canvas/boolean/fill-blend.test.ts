import { afterAll, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type BlendMode, type Fill } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { expectRgbaPixels } from '../helpers'

const SIZE = 100
const HOLE = 50
const GAP = 20
const WIDTH = SIZE * 2 + GAP

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(WIDTH, SIZE), 'surface'))
afterAll(() => renderer.destroy())

const RED: Fill = { type: 'SOLID', color: { r: 0.9, g: 0.1, b: 0.1, a: 1 }, opacity: 1, visible: true }

function greyRamp(blendMode: BlendMode): Fill {
  return {
    type: 'GRADIENT_LINEAR',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 0.5,
    visible: true,
    blendMode,
    gradientStops: [
      { color: { r: 0.2, g: 0.2, b: 0.2, a: 1 }, position: 0 },
      { color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, position: 1 }
    ],
    gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
  }
}

function renderPair(fills: Fill[]): Uint8Array {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.createNode('ELLIPSE', pageId, { width: SIZE, height: SIZE, fills })
  const ring = graph.createNode('BOOLEAN_OPERATION', pageId, {
    x: SIZE + GAP,
    width: SIZE,
    height: SIZE,
    booleanOperation: 'SUBTRACT',
    fills
  })
  graph.createNode('ELLIPSE', ring.id, { width: SIZE, height: SIZE, fills: [RED] })
  const inset = (SIZE - HOLE) / 2
  graph.createNode('ELLIPSE', ring.id, {
    x: inset,
    y: inset,
    width: HOLE,
    height: HOLE,
    fills: [RED]
  })

  renderer.pageId = pageId
  const canvas = renderer.surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  renderer.renderSceneToCanvas(canvas, graph, pageId)
  renderer.surface.flush()
  const image = renderer.surface.makeImageSnapshot()
  try {
    return expectRgbaPixels(
      image.readPixels(0, 0, {
        width: WIDTH,
        height: SIZE,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      })
    )
  } finally {
    image.delete()
  }
}

function pixelAt(pixels: Uint8Array, x: number, y: number): number[] {
  const offset = (y * WIDTH + x) * 4
  return Array.from(pixels.subarray(offset, offset + 4))
}

const RING_POINTS = [
  { x: 12, y: 50 },
  { x: 88, y: 50 },
  { x: 50, y: 12 },
  { x: 30, y: 20 },
  { x: 75, y: 80 }
]

function ringOfShapeAndBoolean(fills: Fill[]) {
  const pixels = renderPair(fills)
  return {
    shape: RING_POINTS.map(({ x, y }) => pixelAt(pixels, x, y)),
    boolean: RING_POINTS.map(({ x, y }) => pixelAt(pixels, x + SIZE + GAP, y)),
    hole: pixelAt(pixels, SIZE + GAP + SIZE / 2, SIZE / 2)
  }
}

describe('a boolean operation’s fills', () => {
  test.each<BlendMode>(['OVERLAY', 'MULTIPLY', 'SCREEN', 'NORMAL'])(
    'blend %s as the same fills on a plain ellipse',
    (blendMode) => {
      const { shape, boolean, hole } = ringOfShapeAndBoolean([RED, greyRamp(blendMode)])
      expect(boolean).toEqual(shape)
      expect(hole[3]).toBe(0)
    }
  )

  test('an overlay ramp changes the red under it', () => {
    const red = ringOfShapeAndBoolean([RED]).boolean
    const normal = ringOfShapeAndBoolean([RED, greyRamp('NORMAL')]).boolean
    const overlay = ringOfShapeAndBoolean([RED, greyRamp('OVERLAY')]).boolean
    expect(overlay).not.toEqual(red)
    expect(overlay).not.toEqual(normal)
  })
})
