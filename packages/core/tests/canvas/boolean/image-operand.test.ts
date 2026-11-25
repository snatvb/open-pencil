import { afterAll, describe, expect, test } from 'bun:test'

import type { Path } from '@open-pencil/canvaskit'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type Fill } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { makeBooleanOperationPath } from '#core/canvas/boolean'
import { forEachVerb } from '#core/canvas/paths/verbs'
import type { BooleanOperation } from '#core/editor/structure/boolean'

const SIZE = 40
const INNER = 30
const CENTRE = SIZE / 2

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(SIZE, SIZE), 'surface'))
afterAll(() => renderer.destroy())

const SOLID: Fill = {
  type: 'SOLID',
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true
}

type ImageOperand = 'outer' | 'inner'

interface OperandImage {
  on: ImageOperand
  visible: boolean
}

const VISIBLE_ON_OUTER: OperandImage = { on: 'outer', visible: true }

function imageFill(visible: boolean): Fill {
  return {
    type: 'IMAGE',
    imageHash: 'pixel',
    imageScaleMode: 'FILL',
    color: { r: 0, g: 0, b: 0, a: 0 },
    opacity: 1,
    visible
  }
}

function operandFills(operand: ImageOperand, image: OperandImage): Fill[] {
  return operand === image.on ? [SOLID, imageFill(image.visible)] : [SOLID]
}

function concentricEllipses(operation: BooleanOperation, image: OperandImage) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const boolean = graph.createNode('BOOLEAN_OPERATION', page.id, {
    width: SIZE,
    height: SIZE,
    booleanOperation: operation,
    fills: [SOLID]
  })
  graph.createNode('ELLIPSE', boolean.id, {
    width: SIZE,
    height: SIZE,
    fills: operandFills('outer', image)
  })
  const inset = (SIZE - INNER) / 2
  graph.createNode('ELLIPSE', boolean.id, {
    x: inset,
    y: inset,
    width: INNER,
    height: INNER,
    fills: operandFills('inner', image)
  })
  return { graph, page, boolean }
}

function contourCount(path: Path): number {
  let count = 0
  forEachVerb(ck, path, (verb) => {
    if (verb === ck.MOVE_VERB) {
      count++
    }
  })
  return count
}

function withOperationPath<T>(
  operation: BooleanOperation,
  image: OperandImage,
  read: (path: Path) => T
): T {
  const { graph, boolean } = concentricEllipses(operation, image)
  const path = expectDefined(makeBooleanOperationPath(renderer, boolean, graph), 'boolean path')
  try {
    return read(path)
  } finally {
    path.delete()
  }
}

function renderedCentreAlpha(operation: BooleanOperation, image: OperandImage): number {
  const { graph, page } = concentricEllipses(operation, image)
  renderer.pageId = page.id
  const canvas = renderer.surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  renderer.renderSceneToCanvas(canvas, graph, page.id)
  renderer.surface.flush()
  const snapshot = renderer.surface.makeImageSnapshot()
  try {
    const pixel = expectDefined(
      snapshot.readPixels(CENTRE, CENTRE, {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      }),
      'pixel'
    )
    return pixel[3]
  } finally {
    snapshot.delete()
  }
}

describe('a boolean operand with an image fill', () => {
  test('a SUBTRACT keeps the image-filled outer ellipse and draws a ring', () => {
    withOperationPath('SUBTRACT', VISIBLE_ON_OUTER, (path) => {
      expect(contourCount(path)).toBe(2)
      expect(path.contains(CENTRE, CENTRE)).toBe(false)
      expect(path.contains(CENTRE, 1)).toBe(true)
    })
    expect(renderedCentreAlpha('SUBTRACT', VISIBLE_ON_OUTER)).toBe(0)
  })

  test('a visible image fill gives the same path as a hidden one', () => {
    const svg = (image: OperandImage) =>
      withOperationPath('SUBTRACT', image, (path) => path.toSVGString())
    expect(svg(VISIBLE_ON_OUTER)).toBe(svg({ on: 'outer', visible: false }))
  })

  test.each([
    ['UNION', 'outer', true, true],
    ['INTERSECT', 'inner', false, true],
    ['EXCLUDE', 'outer', true, false]
  ] as const)('%s keeps the image-filled %s operand', (operation, on, nearEdge, atCentre) => {
    withOperationPath(operation, { on, visible: true }, (path) => {
      expect(path.contains(CENTRE, 1)).toBe(nearEdge)
      expect(path.contains(CENTRE, CENTRE)).toBe(atCentre)
    })
  })
})
