import { afterAll, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type BlendMode, type Fill } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { expectRgbaPixels } from './helpers'

type RGB = [number, number, number]

interface Swatch {
  backdrop: RGB
  source: RGB
  figma: RGB
}

const CELL = 4
const MAX_SWATCHES = 16

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(
  ck,
  expectDefined(ck.MakeSurface(CELL * MAX_SWATCHES, CELL), 'surface')
)
afterAll(() => renderer.destroy())

function solid([r, g, b]: RGB, blendMode: BlendMode = 'NORMAL'): Fill {
  return {
    type: 'SOLID',
    color: { r: r / 255, g: g / 255, b: b / 255, a: 1 },
    opacity: 1,
    visible: true,
    blendMode
  }
}

type SourceLayer = (graph: SceneGraph, parentId: string, x: number, source: RGB) => void

const layerBlend: SourceLayer = (graph, parentId, x, source) => {
  graph.createNode('RECTANGLE', parentId, {
    x,
    width: CELL,
    height: CELL,
    fills: [solid(source)],
    blendMode: 'SOFT_LIGHT'
  })
}

const fillBlend: SourceLayer = (graph, parentId, x, source) => {
  graph.createNode('RECTANGLE', parentId, {
    x,
    width: CELL,
    height: CELL,
    fills: [solid(source, 'SOFT_LIGHT')]
  })
}

function groupBlend(opacity: number): SourceLayer {
  return (graph, parentId, x, source) => {
    const group = graph.createNode('FRAME', parentId, {
      x,
      width: CELL,
      height: CELL,
      fills: [],
      blendMode: 'SOFT_LIGHT',
      opacity
    })
    graph.createNode('RECTANGLE', group.id, { width: CELL, height: CELL, fills: [solid(source)] })
  }
}

function renderSwatches(swatches: Swatch[], sourceLayer: SourceLayer): RGB[] {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  swatches.forEach(({ backdrop, source }, index) => {
    const x = index * CELL
    graph.createNode('RECTANGLE', page.id, {
      x,
      width: CELL,
      height: CELL,
      fills: [solid(backdrop)]
    })
    sourceLayer(graph, page.id, x, source)
  })
  renderer.pageId = page.id
  const canvas = renderer.surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  renderer.renderSceneToCanvas(canvas, graph, page.id)
  renderer.surface.flush()
  const image = renderer.surface.makeImageSnapshot()
  try {
    const pixels = expectRgbaPixels(
      image.readPixels(0, CELL / 2, {
        width: CELL * swatches.length,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      })
    )
    return swatches.map((_, index) => {
      const offset = (index * CELL + CELL / 2) * 4
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    })
  } finally {
    image.delete()
  }
}

function greys(cells: [number, number, number][]): Swatch[] {
  return cells.map(([backdrop, source, figma]) => ({
    backdrop: [backdrop, backdrop, backdrop],
    source: [source, source, source],
    figma: [figma, figma, figma]
  }))
}

function expectFigmaPixels(swatches: Swatch[], sourceLayer: SourceLayer) {
  const rendered = renderSwatches(swatches, sourceLayer)
  const misses = swatches
    .map((swatch, index) => ({ ...swatch, rendered: rendered[index] }))
    .filter(({ figma, rendered }) =>
      rendered.some((channel, c) => Math.abs(channel - figma[c]) > 1)
    )
  expect(misses).toEqual([])
}

// Live-measured in Figma: backdrop grey, source grey, result grey.
const OPAQUE = greys([
  [16, 0, 0],
  [16, 112, 12],
  [32, 96, 18],
  [48, 96, 32],
  [64, 0, 0],
  [128, 0, 75],
  [128, 64, 102],
  [192, 32, 170],
  [4, 255, 8],
  [64, 255, 112],
  [128, 255, 192],
  [192, 208, 222],
  [224, 160, 231],
  [12, 176, 16],
  [40, 240, 70],
  [8, 144, 9]
])

const GROUP_AT_A_FIFTH = greys([
  [16, 0, 9],
  [16, 112, 15],
  [32, 96, 29],
  [48, 96, 45],
  [64, 0, 51],
  [128, 0, 117],
  [128, 64, 123],
  [192, 32, 188],
  [4, 255, 5],
  [64, 255, 74],
  [128, 255, 141],
  [192, 208, 198],
  [224, 160, 225],
  [12, 176, 13],
  [40, 240, 46],
  [8, 144, 8]
])

const COLOURS: Swatch[] = [
  { backdrop: [20, 10, 5], source: [255, 0, 0], figma: [38, 0, 0] },
  { backdrop: [5, 20, 40], source: [0, 255, 0], figma: [0, 38, 0] },
  { backdrop: [40, 30, 10], source: [0, 0, 255], figma: [0, 0, 20] },
  { backdrop: [60, 20, 20], source: [255, 200, 100], figma: [106, 30, 11] },
  { backdrop: [10, 60, 30], source: [100, 200, 255], figma: [4, 86, 56] },
  { backdrop: [100, 80, 60], source: [180, 60, 200], figma: [125, 47, 86] },
  { backdrop: [30, 90, 160], source: [128, 128, 128], figma: [30, 90, 160] },
  { backdrop: [200, 150, 60], source: [230, 230, 230], figma: [235, 200, 97] }
]

describe('soft light, as Figma draws it', () => {
  test('darkens a dark backdrop under a dark source and lifts it less under a light one', () => {
    expectFigmaPixels(OPAQUE, layerBlend)
  })

  test('blends each colour channel on its own', () => {
    expectFigmaPixels(COLOURS, layerBlend)
  })

  test('a fill blends the same way as a layer', () => {
    expectFigmaPixels(OPAQUE, fillBlend)
  })

  test('a soft light group at a fifth opacity mixes its blend into the backdrop', () => {
    expectFigmaPixels(GROUP_AT_A_FIFTH, groupBlend(0.2))
  })
})
