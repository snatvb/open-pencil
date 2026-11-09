import { afterAll, describe, expect, test, mock } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type BlendMode, type Fill, type SceneNode } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { figmaBlendModeToSkia } from '#core/canvas/blend'
import { renderNode, renderSection } from '#core/canvas/scene'
import { RenderedBoundsCache } from '#core/canvas/renderer/visual-bounds'
import { asCanvas, asCanvasKit, asRenderer } from './helpers'

const SIZE = 40

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(SIZE, SIZE), 'surface'))
afterAll(() => renderer.destroy())

const BACKDROP = { r: 0.6, g: 0.4, b: 0.2 }
const SOURCE = { r: 0.2, g: 0.8, b: 0.7 }

function solid(color: { r: number; g: number; b: number }, blendMode: BlendMode = 'NORMAL'): Fill {
  return { type: 'SOLID', color: { ...color, a: 1 }, opacity: 1, visible: true, blendMode }
}

type Scene = (graph: SceneGraph, pageId: string) => void

function backdrop(graph: SceneGraph, pageId: string) {
  graph.createNode('RECTANGLE', pageId, { width: SIZE, height: SIZE, fills: [solid(BACKDROP)] })
}

function renderCenter(build: Scene, under: Scene = backdrop): number[] {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  under(graph, page.id)
  build(graph, page.id)
  renderer.pageId = page.id
  const canvas = renderer.surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  renderer.renderSceneToCanvas(canvas, graph, page.id)
  renderer.surface.flush()
  const image = renderer.surface.makeImageSnapshot()
  try {
    const pixels = expectDefined(
      image.readPixels(SIZE / 2, SIZE / 2, {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      }),
      'pixels'
    )
    return Array.from(pixels.subarray(0, 4))
  } finally {
    image.delete()
  }
}

function overlay(fills: Fill[], blendMode: BlendMode = 'PASS_THROUGH') {
  return (graph: SceneGraph, pageId: string) => {
    graph.createNode('RECTANGLE', pageId, { width: SIZE, height: SIZE, fills, blendMode })
  }
}

function expectChannelsNear(actual: number[], expected: number[]) {
  expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThan(2))
}

// Live-measured in Figma: SOURCE over BACKDROP, opaque and at half opacity.
const LINEAR_DODGE = [204, 255, 229]
const LINEAR_BURN = [0, 51, 0]

describe('linear blend modes, as Figma draws them', () => {
  test('plus lighter adds a fill to what is under it', () => {
    expectChannelsNear(renderCenter(overlay([solid(SOURCE, 'LINEAR_DODGE')])), LINEAR_DODGE)
  })

  test('plus darker adds a fill to what is under it, less white, and only that fill', () => {
    expectChannelsNear(renderCenter(overlay([solid(SOURCE, 'LINEAR_BURN')])), LINEAR_BURN)
    const burnedThenCovered = renderCenter(overlay([solid(SOURCE, 'LINEAR_BURN'), solid(SOURCE)]))
    expectChannelsNear(burnedThenCovered, [51, 204, 179])
  })

  test('plus darker over nothing draws the fill as normal', () => {
    const nothing: Scene = () => undefined
    expectChannelsNear(
      renderCenter(overlay([solid(SOURCE, 'LINEAR_BURN')]), nothing),
      [51, 204, 179, 255]
    )
  })

  test('a half transparent plus lighter fill mixes its sum with what is under it', () => {
    const halfDodge = { ...solid(SOURCE, 'LINEAR_DODGE'), opacity: 0.5 }
    expectChannelsNear(renderCenter(overlay([halfDodge])), [179, 204, 140, 255])
  })

  test('a half transparent plus darker fill takes the overlap off the sum, not off the blend', () => {
    const halfBurn = { ...solid(SOURCE, 'LINEAR_BURN'), opacity: 0.5 }
    expectChannelsNear(renderCenter(overlay([halfBurn])), [51, 76, 12, 255])
  })

  // Live-measured in Figma: a 60% grey backdrop at 50% opacity under (0.7, 0.2, 0.5).
  test('blends over a half transparent backdrop as Figma does', () => {
    const halfGrey: Scene = (graph, pageId) => {
      const grey = { ...solid({ r: 0.6, g: 0.6, b: 0.6 }), opacity: 0.5 }
      graph.createNode('RECTANGLE', pageId, { width: SIZE, height: SIZE, fills: [grey] })
    }
    const paint = { r: 0.7, g: 0.2, b: 0.5 }
    expectChannelsNear(
      renderCenter(overlay([solid(paint, 'LINEAR_BURN')]), halfGrey),
      [127, 0, 77, 255]
    )
    const halfDodge = { ...solid(paint, 'LINEAR_DODGE'), opacity: 0.5 }
    expectChannelsNear(renderCenter(overlay([halfDodge]), halfGrey), [220, 137, 187, 192])
    const halfBurn = { ...solid(paint, 'LINEAR_BURN'), opacity: 0.5 }
    expectChannelsNear(renderCenter(overlay([halfBurn]), halfGrey), [136, 51, 103, 191])
  })

  test('a half transparent fill over nothing stays half transparent', () => {
    const nothing: Scene = () => undefined
    for (const blendMode of ['LINEAR_DODGE', 'LINEAR_BURN'] as const) {
      const half = { ...solid(SOURCE, blendMode), opacity: 0.5 }
      expectChannelsNear(renderCenter(overlay([half]), nothing), [51, 204, 179, 128])
    }
  })

  test('a half transparent fill over a half transparent backdrop covers three quarters', () => {
    const halfBackdrop: Scene = (graph, pageId) => {
      graph.createNode('RECTANGLE', pageId, {
        width: SIZE,
        height: SIZE,
        fills: [{ ...solid(BACKDROP), opacity: 0.5 }]
      })
    }
    for (const blendMode of ['LINEAR_DODGE', 'LINEAR_BURN'] as const) {
      const half = { ...solid(SOURCE, blendMode), opacity: 0.5 }
      expect(Math.abs(renderCenter(overlay([half]), halfBackdrop)[3] - 191)).toBeLessThan(2)
    }
  })

  test('a drop shadow blends the same way as a fill', () => {
    const castsOntoCenter: Scene = (graph, pageId) => {
      graph.createNode('RECTANGLE', pageId, {
        width: 10,
        height: 10,
        fills: [solid(BACKDROP)],
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { ...SOURCE, a: 1 },
            offset: { x: 15, y: 15 },
            radius: 0,
            spread: 0,
            visible: true,
            blendMode: 'LINEAR_BURN',
            showShadowBehindNode: false
          }
        ]
      })
    }
    expectChannelsNear(renderCenter(castsOntoCenter), LINEAR_BURN)
  })

  test('a layer blends the same way as a fill', () => {
    expectChannelsNear(renderCenter(overlay([solid(SOURCE)], 'LINEAR_BURN')), LINEAR_BURN)
    expectChannelsNear(renderCenter(overlay([solid(SOURCE)], 'LINEAR_DODGE')), LINEAR_DODGE)
  })
})

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

const blendModes = {
  SrcOver: 'SrcOver',
  Darken: 'Darken',
  Multiply: 'Multiply',
  ColorBurn: 'ColorBurn',
  Lighten: 'Lighten',
  Screen: 'Screen',
  ColorDodge: 'ColorDodge',
  Overlay: 'Overlay',
  SoftLight: 'SoftLight',
  HardLight: 'HardLight',
  Difference: 'Difference',
  Exclusion: 'Exclusion',
  Hue: 'Hue',
  Saturation: 'Saturation',
  Color: 'Color',
  Luminosity: 'Luminosity',
  Plus: 'Plus'
}

function createCanvas() {
  return {
    save: mock(() => undefined),
    restore: mock(() => undefined),
    translate: mock(() => undefined),
    concat: mock(() => undefined),
    saveLayer: mock(() => undefined),
    drawRRect: mock(() => undefined)
  }
}

function createRenderer(overrides: Partial<SkiaRenderer> = {}) {
  return asRenderer({
    drawCounts: { nodes: 0, culled: 0 },
    worldViewport: { x: -100, y: -100, w: 1000, h: 1000 },
    ck: {
      BlendMode: blendModes,
      LTRBRect: mock(() => new Float32Array(4)),
      RRectXY: mock(() => new Float32Array(12))
    },
    opacityPaint: {
      setAlphaf: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    renderedBounds: new RenderedBoundsCache(),
    effectLayerPaint: {
      setImageFilter: mock(() => undefined),
      setColorFilter: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    fillPaint: {
      setAlphaf: mock(() => undefined),
      setBlendMode: mock(() => undefined),
      setShader: mock(() => undefined)
    },
    getCachedBlur: mock(() => null),
    compositingLayerFlags: mock(() => 0),
    applyFill: mock(() => true),
    makeRRect: mock(() => new Float32Array(12)),
    renderShape: mock(() => undefined),
    renderSection: mock(() => undefined),
    renderComponentSet: mock(() => undefined),
    renderNode(...args: Parameters<SkiaRenderer['renderNode']>) {
      renderNode(asRenderer(this), ...args)
    },
    ...overrides
  })
}

function calls(fn: ReturnType<typeof mock>): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls
}

describe('canvas blend modes', () => {
  test('maps Figma blend modes to CanvasKit blend modes', () => {
    const ck = asCanvasKit({ BlendMode: blendModes })
    // Plus darker and plus lighter have no CanvasKit mode; they draw through runtime blenders.
    const cases: Array<[Exclude<BlendMode, 'LINEAR_BURN' | 'LINEAR_DODGE'>, string]> = [
      ['NORMAL', 'SrcOver'],
      ['PASS_THROUGH', 'SrcOver'],
      ['DARKEN', 'Darken'],
      ['MULTIPLY', 'Multiply'],
      ['COLOR_BURN', 'ColorBurn'],
      ['LIGHTEN', 'Lighten'],
      ['SCREEN', 'Screen'],
      ['COLOR_DODGE', 'ColorDodge'],
      ['OVERLAY', 'Overlay'],
      ['SOFT_LIGHT', 'SoftLight'],
      ['HARD_LIGHT', 'HardLight'],
      ['DIFFERENCE', 'Difference'],
      ['EXCLUSION', 'Exclusion'],
      ['HUE', 'Hue'],
      ['SATURATION', 'Saturation'],
      ['COLOR', 'Color'],
      ['LUMINOSITY', 'Luminosity']
    ]

    for (const [figmaMode, skiaMode] of cases) {
      expect<unknown>(figmaBlendModeToSkia(ck, figmaMode)).toBe(skiaMode)
    }
  })

  test('isolates node content when node blend mode needs compositing', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      blendMode: 'MULTIPLY'
    })
    const renderer = createRenderer()
    const canvas = createCanvas()

    renderNode(renderer, asCanvas(canvas), graph, node.id, {})

    expect(renderer.opacityPaint.setAlphaf).toHaveBeenCalledWith(1)
    expect(renderer.opacityPaint.setBlendMode).toHaveBeenCalledWith('Multiply')
    expect(canvas.saveLayer).toHaveBeenCalledWith(
      renderer.opacityPaint,
      expect.any(Float32Array),
      null,
      0
    )
    expect(renderer.ck.LTRBRect).toHaveBeenCalledWith(0, 0, 100, 100)
    expect(renderer.renderShape).toHaveBeenCalled()
    expect(renderer.opacityPaint.setBlendMode).toHaveBeenLastCalledWith('SrcOver')
  })

  test('applies fill blend modes per fill and resets shared paint', () => {
    const graph = new SceneGraph()
    const fill: Fill = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      blendMode: 'SCREEN'
    }
    const node = graph.createNode('SECTION', pageId(graph), {
      width: 100,
      height: 100,
      fills: [fill]
    }) as Extract<SceneNode, { type: 'SECTION' }>
    const renderer = createRenderer()
    const canvas = createCanvas()

    renderSection(renderer, asCanvas(canvas), node, graph)

    expect(calls(renderer.fillPaint.setBlendMode as ReturnType<typeof mock>)).toEqual([
      ['Screen'],
      ['SrcOver']
    ])
  })
})

function grey(value: number, opacity = 1): Fill {
  return { ...solid({ r: value, g: value, b: value }), opacity }
}

interface Layer {
  fill: Fill
  blendMode?: BlendMode
}

function passThroughGroup(opacity: number, layers: Layer[]): Scene {
  return (graph, pageId) => {
    const group = graph.createNode('FRAME', pageId, {
      width: SIZE,
      height: SIZE,
      fills: [],
      blendMode: 'PASS_THROUGH',
      opacity
    })
    for (const layer of layers) {
      graph.createNode('RECTANGLE', group.id, {
        width: SIZE,
        height: SIZE,
        fills: [layer.fill],
        blendMode: layer.blendMode ?? 'NORMAL'
      })
    }
  }
}

function greyBackdrop(opacity = 1): Scene {
  return (graph, pageId) => {
    graph.createNode('RECTANGLE', pageId, {
      width: SIZE,
      height: SIZE,
      fills: [grey(0.5, opacity)]
    })
  }
}

function renderGroupRed(opacity: number, layers: Layer[], under = greyBackdrop()): number {
  return renderCenter(passThroughGroup(opacity, layers), under)[0]
}

// Live-measured in Figma: a 50% grey backdrop under a pass-through frame at 50% and 70%.
const PASS_THROUGH_CASES: { name: string; layers: Layer[]; figma: [number, number] }[] = [
  {
    name: 'a multiply layer',
    layers: [{ fill: grey(0.4), blendMode: 'MULTIPLY' }],
    figma: [90, 75]
  },
  { name: 'a screen layer', layers: [{ fill: grey(0.6), blendMode: 'SCREEN' }], figma: [166, 181] },
  {
    name: 'a multiply layer over a half transparent sibling',
    layers: [{ fill: grey(1, 0.5) }, { fill: grey(0.2), blendMode: 'MULTIPLY' }],
    figma: [83, 66]
  },
  {
    name: 'a screen layer over a translucent sibling',
    layers: [{ fill: grey(0.2, 0.6) }, { fill: grey(0.5), blendMode: 'SCREEN' }],
    figma: [149, 157]
  },
  { name: 'a normal layer', layers: [{ fill: grey(0.9) }], figma: [179, 200] }
]

describe('a pass-through group with opacity', () => {
  for (const { name, layers, figma } of PASS_THROUGH_CASES) {
    test(`blends ${name} with what is under the group, as Figma does`, () => {
      expect(Math.abs(renderGroupRed(0.5, layers) - figma[0])).toBeLessThan(2)
      expect(Math.abs(renderGroupRed(0.7, layers) - figma[1])).toBeLessThan(2)
    })
  }

  test('fades a soft light layer from the backdrop toward the opaque group', () => {
    const softLight = [{ fill: grey(0.1), blendMode: 'SOFT_LIGHT' as const }]
    const backdropRed = renderCenter(() => undefined, greyBackdrop())[0]
    const opaque = renderGroupRed(1, softLight)
    for (const opacity of [0.5, 0.7]) {
      const expected = backdropRed + (opaque - backdropRed) * opacity
      expect(Math.abs(renderGroupRed(opacity, softLight) - expected)).toBeLessThan(2)
    }
  })

  test('blends a fill blend mode of a layer with what is under the group', () => {
    const multiplyFill = [{ fill: { ...grey(0.4), blendMode: 'MULTIPLY' as const } }]
    expect(Math.abs(renderGroupRed(0.5, multiplyFill) - 90)).toBeLessThan(2)
  })

  test('keeps a half transparent backdrop as it is where the group draws nothing', () => {
    const corner: Scene = (graph, pageId) => {
      const group = graph.createNode('FRAME', pageId, {
        width: SIZE,
        height: SIZE,
        fills: [],
        blendMode: 'PASS_THROUGH',
        opacity: 0.5
      })
      graph.createNode('RECTANGLE', group.id, {
        width: 4,
        height: 4,
        fills: [grey(0.4)],
        blendMode: 'MULTIPLY'
      })
    }
    const halfGrey = greyBackdrop(0.5)
    expectChannelsNear(
      renderCenter(corner, halfGrey),
      renderCenter(() => undefined, halfGrey)
    )
  })

  test('fades a blending layer over a half transparent backdrop as the opaque group fades', () => {
    const multiply = [{ fill: grey(0.4), blendMode: 'MULTIPLY' as const }]
    const halfGrey = greyBackdrop(0.5)
    const nothing = renderCenter(() => undefined, halfGrey)
    const opaque = renderCenter(passThroughGroup(1, multiply), halfGrey)
    const premultiplied = (pixel: number[]) => [
      ...pixel.slice(0, 3).map((c) => (c * pixel[3]) / 255),
      pixel[3]
    ]
    const expected = premultiplied(nothing).map((c, i) => (c + premultiplied(opaque)[i]) / 2)
    const actual = premultiplied(renderCenter(passThroughGroup(0.5, multiply), halfGrey))
    expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThan(2))
  })
})

describe('a pass-through layer with opacity whose own paints blend', () => {
  const multiplyAtHalf = 90

  test('blends a child stroke with what is under the group', () => {
    const strokedChild: Scene = (graph, pageId) => {
      const group = graph.createNode('FRAME', pageId, {
        width: SIZE,
        height: SIZE,
        fills: [],
        blendMode: 'PASS_THROUGH',
        opacity: 0.5
      })
      graph.createNode('RECTANGLE', group.id, {
        width: SIZE,
        height: SIZE,
        fills: [],
        strokes: [{ ...grey(0.4), blendMode: 'MULTIPLY', weight: SIZE * 2, align: 'CENTER' }],
        strokeWeight: SIZE * 2,
        strokeAlign: 'CENTER'
      })
    }
    expect(Math.abs(renderCenter(strokedChild, greyBackdrop())[0] - multiplyAtHalf)).toBeLessThan(2)
  })

  test('blends its own fill with what is under it', () => {
    const multiplyLeaf: Scene = (graph, pageId) => {
      graph.createNode('RECTANGLE', pageId, {
        width: SIZE,
        height: SIZE,
        fills: [{ ...grey(0.4), blendMode: 'MULTIPLY' }],
        blendMode: 'PASS_THROUGH',
        opacity: 0.5
      })
    }
    expect(Math.abs(renderCenter(multiplyLeaf, greyBackdrop())[0] - multiplyAtHalf)).toBeLessThan(2)
  })

  test('fades by its own opacity after a translucent mask drew earlier in the frame', () => {
    const maskThenGroup: Scene = (graph, pageId) => {
      const masked = graph.createNode('FRAME', pageId, { width: 2, height: 2, fills: [] })
      graph.createNode('RECTANGLE', masked.id, {
        width: 2,
        height: 2,
        fills: [grey(0)],
        isMask: true,
        opacity: 0.5
      })
      graph.createNode('RECTANGLE', masked.id, { width: 2, height: 2, fills: [grey(1)] })
      passThroughGroup(0.5, [{ fill: grey(0.4), blendMode: 'MULTIPLY' }])(graph, pageId)
    }
    expect(Math.abs(renderCenter(maskThenGroup, greyBackdrop())[0] - multiplyAtHalf)).toBeLessThan(
      2
    )
  })
})
