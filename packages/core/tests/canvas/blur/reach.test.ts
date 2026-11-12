import { afterAll, describe, expect, test } from 'bun:test'

import { edgeRow, effect, expectFigmaEdge, FIGMA, solid } from '#core-tests/helpers/blur'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { SceneGraph, type Effect, type SceneNode } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1)))
afterAll(() => renderer.destroy())
const scene = { ck, renderer }

/** How many pixels of a 400px frame `build` fills draw anything into. */
function inkArea(build: (graph: SceneGraph, frameId: string) => void): number {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', page, {
    width: 400,
    height: 400,
    fills: [],
    clipsContent: false
  })
  build(graph, frame.id)
  const png = expectDefined(
    renderNodesToImage(ck, renderer, graph, page, [frame.id], {
      scale: 1,
      format: 'PNG',
      trimTransparent: false
    })
  )
  const image = expectDefined(ck.MakeImageFromEncoded(png))
  try {
    const pixels = expectDefined(
      image.readPixels(0, 0, {
        width: image.width(),
        height: image.height(),
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB
      })
    )
    let area = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 127) {
        area++
      }
    }
    return area
  } finally {
    image.delete()
  }
}

describe('a layer blur keeps what its node draws past its box', () => {
  const bar = { x: 150, y: 190, width: 100, height: 20, fills: [solid(1, 0, 0)] }

  function frameWithChildPastItsBox(graph: SceneGraph, frameId: string, props: Partial<SceneNode>) {
    const parent = graph.createNode('FRAME', frameId, {
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      fills: [],
      clipsContent: false,
      ...props
    })
    graph.createNode('RECTANGLE', parent.id, {
      x: 60,
      width: 100,
      height: 40,
      fills: [solid(0, 0, 1)]
    })
  }

  const sharp = inkArea((graph, frameId) => frameWithChildPastItsBox(graph, frameId, {}))

  test('a child past the box', () => {
    const blurred = inkArea((graph, frameId) =>
      frameWithChildPastItsBox(graph, frameId, { effects: [effect('LAYER_BLUR', 1)] })
    )
    expect(Math.abs(blurred - sharp)).toBeLessThanOrEqual(sharp * 0.05)
  })

  test('a child past the box, with the node at 0.6 opacity', () => {
    const blurred = inkArea((graph, frameId) =>
      frameWithChildPastItsBox(graph, frameId, {
        opacity: 0.6,
        effects: [effect('LAYER_BLUR', 1)]
      })
    )
    expect(Math.abs(blurred - sharp)).toBeLessThanOrEqual(sharp * 0.05)
  })

  test.each([
    ['with a layer blur', { effects: [effect('LAYER_BLUR', 1)] }],
    ['at 0.6 opacity, with a layer blur', { opacity: 0.6, effects: [effect('LAYER_BLUR', 1)] }]
  ])('a child past the box, with the node flipped, %s', (_, props) => {
    const flipped = { x: 200, flipX: true }
    const blurred = inkArea((graph, frameId) =>
      frameWithChildPastItsBox(graph, frameId, { ...flipped, ...props })
    )
    expect(Math.abs(blurred - sharp)).toBeLessThanOrEqual(sharp * 0.05)
  })

  test('a node turned past its box', () => {
    const turned = (effects: Effect[]) =>
      inkArea((graph, frameId) => {
        graph.createNode('RECTANGLE', frameId, { ...bar, rotation: 90, effects })
      })
    const area = turned([])
    expect(Math.abs(turned([effect('LAYER_BLUR', 1)]) - area)).toBeLessThanOrEqual(area * 0.05)
  })

  test('a child past the box, inside a turned parent', () => {
    const inTurnedParent = (props: Partial<SceneNode>) =>
      inkArea((graph, frameId) => {
        const turned = graph.createNode('FRAME', frameId, {
          x: 200,
          y: 200,
          width: 20,
          height: 20,
          rotation: 90,
          fills: [],
          clipsContent: false
        })
        frameWithChildPastItsBox(graph, turned.id, { x: 0, y: 0, ...props })
      })
    const area = inTurnedParent({})
    const blurred = inTurnedParent({ effects: [effect('LAYER_BLUR', 1)] })
    expect(Math.abs(blurred - area)).toBeLessThanOrEqual(area * 0.05)
  })

  test('a child far past the box, under a 16px layer blur, falls off as in Figma', () => {
    const row = edgeRow(
      scene,
      (graph, frameId) => {
        const parent = graph.createNode('FRAME', frameId, {
          x: 250,
          y: 100,
          width: 40,
          height: 200,
          fills: [],
          clipsContent: false,
          effects: [effect('LAYER_BLUR', 16)]
        })
        graph.createNode('RECTANGLE', parent.id, {
          x: -150,
          width: 200,
          height: 200,
          fills: [solid(1, 0, 0)]
        })
      },
      3
    )
    expectFigmaEdge(row, FIGMA['LAYER_BLUR 16'])
  })
})

describe('a frame casting its drop shadow from a child past its box', () => {
  const childRight = 100 + 60 + 100

  /** Alpha just past the child's right edge, on a row through its middle. */
  function shadowRow(props: Partial<SceneNode>): number[] {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const frame = graph.createNode('FRAME', page, {
      width: 400,
      height: 400,
      fills: [],
      clipsContent: false
    })
    const parent = graph.createNode('FRAME', frame.id, {
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      fills: [],
      clipsContent: false,
      ...props
    })
    graph.createNode('RECTANGLE', parent.id, {
      x: 60,
      width: 100,
      height: 40,
      fills: [solid(0, 0, 1)]
    })
    const png = expectDefined(
      renderNodesToImage(ck, renderer, graph, page, [frame.id], {
        scale: 1,
        format: 'PNG',
        trimTransparent: false
      })
    )
    const image = expectDefined(ck.MakeImageFromEncoded(png))
    try {
      const pixels = expectDefined(
        image.readPixels(0, 0, {
          width: image.width(),
          height: image.height(),
          alphaType: ck.AlphaType.Unpremul,
          colorType: ck.ColorType.RGBA_8888,
          colorSpace: ck.ColorSpace.SRGB
        })
      )
      const offset = (image.width() - 400) / 2
      const row: number[] = []
      for (let x = childRight + 2; x <= childRight + 10; x++) {
        row.push(pixels[((120 + offset) * image.width() + x + offset) * 4 + 3])
      }
      return row
    } finally {
      image.delete()
    }
  }

  const shadow = effect('DROP_SHADOW', 20)
  const unlayered = shadowRow({ effects: [shadow] })

  test('casts a visible shadow past the child without a layer', () => {
    expect(Math.min(...unlayered)).toBeGreaterThan(25)
  })

  test('keeps the shadow past the child at 0.6 opacity', () => {
    for (const [i, alpha] of shadowRow({ opacity: 0.6, effects: [shadow] }).entries()) {
      expect(Math.abs(alpha - unlayered[i] * 0.6)).toBeLessThanOrEqual(3)
    }
  })

  test('keeps the shadow past the child under a layer blur', () => {
    for (const [i, alpha] of shadowRow({
      effects: [shadow, effect('LAYER_BLUR', 1)]
    }).entries()) {
      expect(Math.abs(alpha - unlayered[i])).toBeLessThanOrEqual(6)
    }
  })
})

describe('a mask whose drawing reaches past its box', () => {
  const barArea = 100 * 20
  const spreadShadow: Effect = { ...effect('DROP_SHADOW', 0), spread: 10 }
  const shadowedBarArea = (100 + 2 * 10) * (20 + 2 * 10)

  /**
   * Red under `mask`, from a sibling whose own box is a 10px square at `maskedX` and whose child
   * covers the whole frame, so only the mask's bounds can hold the masked-in area.
   */
  function maskedArea(addMask: (graph: SceneGraph, frameId: string) => void, maskedX = 0): number {
    return inkArea((graph, frameId) => {
      addMask(graph, frameId)
      const masked = graph.createNode('FRAME', frameId, {
        x: maskedX,
        width: 10,
        height: 10,
        fills: [],
        clipsContent: false
      })
      graph.createNode('RECTANGLE', masked.id, {
        x: -maskedX,
        width: 400,
        height: 400,
        fills: [solid(1, 0, 0)]
      })
    })
  }

  function barMask(mask: Partial<SceneNode>) {
    return (graph: SceneGraph, frameId: string) => {
      graph.createNode('RECTANGLE', frameId, {
        x: 150,
        y: 190,
        width: 100,
        height: 20,
        fills: [solid(0, 0, 0)],
        isMask: true,
        maskType: 'ALPHA',
        ...mask
      })
    }
  }

  test.each([
    ['turned by 90 degrees', { rotation: 90 }, barArea],
    ['turned by 90 degrees, at 0.9 opacity', { rotation: 90, opacity: 0.9 }, barArea],
    [
      'turned by 90 degrees, with a layer blur',
      { rotation: 90, effects: [effect('LAYER_BLUR', 1)] },
      barArea
    ],
    ['turned by 45 degrees, at 0.9 opacity', { rotation: 45, opacity: 0.9 }, barArea],
    ['with a drop shadow spread past its box', { effects: [spreadShadow] }, shadowedBarArea],
    [
      'turned by 90 degrees, with a drop shadow spread past its box',
      { rotation: 90, effects: [spreadShadow] },
      shadowedBarArea
    ],
    [
      'by luminance, turned by 90 degrees, with a layer blur',
      {
        rotation: 90,
        maskType: 'LUMINANCE' as const,
        fills: [solid(1, 1, 1)],
        effects: [effect('LAYER_BLUR', 1)]
      },
      barArea
    ]
  ])('masks in all it covers, %s', (_, mask, expected) => {
    expect(Math.abs(maskedArea(barMask(mask)) - expected)).toBeLessThanOrEqual(expected * 0.05)
  })

  test.each([
    ['', []],
    [', with a layer blur', [effect('LAYER_BLUR', 1)]]
  ])('masks in all a flipped frame mask covers with a child past its box%s', (_, effects) => {
    const childArea = 100 * 40
    const area = maskedArea((graph, frameId) => {
      const mask = graph.createNode('FRAME', frameId, {
        x: 200,
        y: 100,
        width: 40,
        height: 40,
        fills: [],
        clipsContent: false,
        isMask: true,
        maskType: 'ALPHA',
        flipX: true,
        effects
      })
      graph.createNode('RECTANGLE', mask.id, {
        x: 60,
        width: 100,
        height: 40,
        fills: [solid(0, 0, 1)]
      })
    }, 390)
    expect(Math.abs(area - childArea)).toBeLessThanOrEqual(childArea * 0.05)
  })
})
