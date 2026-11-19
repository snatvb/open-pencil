import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { autoFrame, fixed, fr, gridFrame, pageId, rect } from '#core-tests/helpers/layout'
import { mapValues } from 'es-toolkit'

import {
  computeAllLayouts,
  computeLayout,
  setTextMeasurer,
  type TextMeasurer
} from '@open-pencil/core/layout'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { getNodeWorldBounds } from '@open-pencil/scene-graph/coordinate'
import { getNodeOrThrow } from '@open-pencil/test-support/assert'

function column(graph: SceneGraph, overrides: Partial<SceneNode> = {}): SceneNode {
  return autoFrame(graph, pageId(graph), {
    layoutMode: 'VERTICAL',
    width: 271,
    height: 1,
    paddingLeft: 8,
    paddingRight: 8,
    ...overrides
  })
}

function boundsOf(graph: SceneGraph, node: SceneNode) {
  const bounds = getNodeWorldBounds(getNodeOrThrow(graph, node.id))
  return mapValues(bounds, (value) => Math.round(value * 1000) / 1000 || 0)
}

function geometryOf(graph: SceneGraph, node: SceneNode) {
  const { x, y, width, height } = getNodeOrThrow(graph, node.id)
  return { x, y, width, height, bounds: boundsOf(graph, node) }
}

const LETTER_WIDTH = 8
const LINE_HEIGHT = 10

const wrappingMeasurer: TextMeasurer = (node, maxWidth) => {
  const natural = node.text.length * LETTER_WIDTH
  const width = maxWidth === undefined ? natural : Math.min(natural, maxWidth)
  return { width, height: LINE_HEIGHT * Math.ceil(natural / width) }
}

function fillingFrame(graph: SceneGraph, rotation: number): SceneNode {
  const frame = autoFrame(graph, pageId(graph), { layoutMode: 'VERTICAL', width: 200, height: 300 })
  const filling = autoFrame(graph, frame.id, {
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    width: 10,
    height: 30,
    layoutGrow: 1,
    rotation
  })
  rect(graph, filling.id, 10, 30)
  return filling
}

describe('turned children in auto layout', () => {
  for (const flipX of [false, true]) {
    const reflected = flipX ? ' and reflected' : ''

    test(`a child turned a quarter${reflected} stretches its height across a fixed column`, () => {
      const graph = new SceneGraph()
      const frame = column(graph)
      const child = rect(graph, frame.id, 1, 40, {
        rotation: 90,
        flipX,
        layoutAlignSelf: 'STRETCH'
      })

      computeAllLayouts(graph)

      expect(getNodeOrThrow(graph, frame.id)).toMatchObject({ width: 271, height: 1 })
      expect(getNodeOrThrow(graph, child.id)).toMatchObject({ width: 1, height: 255 })
      expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 255, height: 1 })
    })

    test(`a column hugs a child turned a quarter${reflected} by its turned box`, () => {
      const graph = new SceneGraph()
      const frame = column(graph, { primaryAxisSizing: 'HUG', height: 300 })
      const child = rect(graph, frame.id, 1, 255, {
        rotation: -90,
        flipX,
        layoutAlignSelf: 'STRETCH'
      })

      computeAllLayouts(graph)

      expect(getNodeOrThrow(graph, frame.id)).toMatchObject({ width: 271, height: 1 })
      expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 255, height: 1 })
    })
  }

  test('a child turned a quarter keeps its size and places its turned box', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { height: 50, itemSpacing: 4 })
    const child = rect(graph, frame.id, 10, 100, { rotation: 90 })
    const below = rect(graph, frame.id, 20, 20)

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, child.id)).toMatchObject({ width: 10, height: 100 })
    expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 100, height: 10 })
    expect(getNodeOrThrow(graph, below.id)).toMatchObject({ x: 8, y: 14 })
  })

  test('a child turned a quarter grows its width along a column', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { height: 100 })
    const child = rect(graph, frame.id, 10, 50, { rotation: 90, layoutGrow: 1 })

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, child.id)).toMatchObject({ width: 100, height: 50 })
    expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 50, height: 100 })
  })

  test('a row hugs a child turned a quarter by its turned box', () => {
    const graph = new SceneGraph()
    const frame = autoFrame(graph, pageId(graph), {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      width: 10,
      height: 10
    })
    const child = rect(graph, frame.id, 30, 80, { rotation: 270 })

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, frame.id)).toMatchObject({ width: 80, height: 30 })
    expect(boundsOf(graph, child)).toEqual({ x: 0, y: 0, width: 80, height: 30 })
  })

  test('an auto layout child turned a quarter keeps the height a column stretches it to', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { primaryAxisSizing: 'HUG' })
    const child = autoFrame(graph, frame.id, {
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      width: 4,
      height: 30,
      rotation: 90,
      layoutAlignSelf: 'STRETCH'
    })
    rect(graph, child.id, 4, 30)

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, child.id)).toMatchObject({ width: 4, height: 255 })
    expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 255, height: 4 })
    expect(getNodeOrThrow(graph, frame.id)).toMatchObject({ width: 271, height: 4 })
  })

  test('a child turned half a turn keeps its box', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { primaryAxisSizing: 'HUG' })
    const child = rect(graph, frame.id, 40, 20, { rotation: 180 })

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, frame.id)).toMatchObject({ height: 20 })
    expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 40, height: 20 })
  })

  test('a child at an oblique angle keeps its size and takes its bounding box', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { primaryAxisSizing: 'HUG' })
    const child = rect(graph, frame.id, 60, 20, { rotation: 30, layoutAlignSelf: 'STRETCH' })

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, child.id)).toMatchObject({ width: 60, height: 20 })
    expect(boundsOf(graph, child)).toEqual({ x: 8, y: 0, width: 61.962, height: 47.321 })
    expect(getNodeOrThrow(graph, frame.id).height).toBeCloseTo(47.321, 3)
  })

  test('a grid places a child turned a quarter by its turned box, the same every pass', () => {
    const graph = new SceneGraph()
    const frame = gridFrame(graph, pageId(graph), [fixed(200)], [fixed(200)])
    const child = rect(graph, frame.id, 100, 40, { rotation: 90 })

    computeLayout(graph, frame.id)
    const first = geometryOf(graph, child)
    computeLayout(graph, frame.id)

    expect(first).toMatchObject({ width: 100, height: 40 })
    expect(first.bounds).toEqual({ x: 0, y: 0, width: 40, height: 100 })
    expect(geometryOf(graph, child)).toEqual(first)
  })

  test('laying out again leaves turned children where they are', () => {
    const graph = new SceneGraph()
    const frame = column(graph, { primaryAxisSizing: 'HUG', itemSpacing: 3 })
    const stretched = rect(graph, frame.id, 60, 20, { rotation: 90, layoutAlignSelf: 'STRETCH' })
    const hugging = autoFrame(graph, frame.id, {
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      rotation: -90
    })
    rect(graph, hugging.id, 40, 20)

    computeAllLayouts(graph)
    const first = [geometryOf(graph, stretched), geometryOf(graph, hugging)]
    computeAllLayouts(graph)

    expect(first[1].bounds).toEqual({ x: 8, y: 63, width: 20, height: 40 })
    expect([geometryOf(graph, stretched), geometryOf(graph, hugging)]).toEqual(first)
  })

  for (const rotation of [0, 1e-9, 180]) {
    test(`a hugging frame turned ${rotation} degrees fills a column`, () => {
      const graph = new SceneGraph()
      const filling = fillingFrame(graph, rotation)

      computeAllLayouts(graph)

      expect(getNodeOrThrow(graph, filling.id)).toMatchObject({ width: 10, height: 300 })
      expect(boundsOf(graph, filling)).toEqual({ x: 0, y: 0, width: 10, height: 300 })
    })
  }

  test('a hugging frame turned a quarter fills a column along its own width', () => {
    const graph = new SceneGraph()
    const filling = fillingFrame(graph, 90)

    computeAllLayouts(graph)

    expect(getNodeOrThrow(graph, filling.id)).toMatchObject({ width: 300, height: 30 })
    expect(boundsOf(graph, filling)).toEqual({ x: 0, y: 0, width: 30, height: 300 })
  })

  for (const rotation of [90, 1e-9]) {
    test(`one layout of a row follows a frame turned ${rotation} degrees as it hugs`, () => {
      const graph = new SceneGraph()
      const row = autoFrame(graph, pageId(graph), {
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG'
      })
      const turned = autoFrame(graph, row.id, {
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        rotation
      })
      const content = rect(graph, turned.id, 40, 20)
      computeAllLayouts(graph)

      graph.updateNode(content.id, { width: 90 })
      computeLayout(graph, row.id)

      const box = rotation === 90 ? { width: 20, height: 90 } : { width: 90, height: 20 }
      expect(boundsOf(graph, turned)).toEqual({ x: 0, y: 0, ...box })
      expect(getNodeOrThrow(graph, row.id)).toMatchObject(box)
    })
  }

  test('nested turned frames cost a layout no more than twice the unturned nest', () => {
    const childListings = (rotation: number) => {
      const graph = new SceneGraph()
      const root = autoFrame(graph, pageId(graph), {
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG'
      })
      let parent = root
      for (let depth = 0; depth < 8; depth++) {
        parent = autoFrame(graph, parent.id, {
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'HUG',
          itemSpacing: 2,
          rotation
        })
        rect(graph, parent.id, 10, 20)
      }
      computeAllLayouts(graph)
      const listings = spyOn(graph, 'getChildren')
      computeLayout(graph, root.id)
      return listings.mock.calls.length
    }

    expect(childListings(90)).toBeLessThanOrEqual(2 * childListings(0))
  })

  describe('turned text', () => {
    afterEach(() => setTextMeasurer(null))

    test('a row hugs auto-width text turned a quarter by its measured box', () => {
      setTextMeasurer(wrappingMeasurer)
      const graph = new SceneGraph()
      const row = autoFrame(graph, pageId(graph), {
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG'
      })
      const text = graph.createNode('TEXT', row.id, {
        text: 'abcdefghij',
        width: 30,
        height: 30,
        rotation: 90,
        textAutoResize: 'WIDTH_AND_HEIGHT'
      })

      computeAllLayouts(graph)

      expect(getNodeOrThrow(graph, text.id)).toMatchObject({ width: 80, height: 10 })
      expect(boundsOf(graph, text)).toEqual({ x: 0, y: 0, width: 10, height: 80 })
      expect(getNodeOrThrow(graph, row.id)).toMatchObject({ width: 10, height: 80 })
    })

    test('auto-height text turned a quarter wraps at the width a row stretches it to', () => {
      setTextMeasurer(wrappingMeasurer)
      const graph = new SceneGraph()
      const row = autoFrame(graph, pageId(graph), { width: 300, height: 40 })
      const text = graph.createNode('TEXT', row.id, {
        text: 'abcdefghij',
        width: 100,
        height: 10,
        rotation: 90,
        textAutoResize: 'HEIGHT',
        layoutAlignSelf: 'STRETCH'
      })

      computeAllLayouts(graph)

      expect(getNodeOrThrow(graph, text.id)).toMatchObject({ width: 40, height: 20 })
      expect(boundsOf(graph, text)).toEqual({ x: 0, y: 0, width: 20, height: 40 })
    })

    test('an auto grid track fits oblique auto-width text by its measured box in one pass', () => {
      setTextMeasurer(wrappingMeasurer)
      const graph = new SceneGraph()
      const auto = { sizing: 'AUTO', value: 0 } as const
      const frame = gridFrame(graph, pageId(graph), [auto, fixed(10), fr()], [auto])
      graph.createNode('TEXT', frame.id, {
        text: 'abcdefghij',
        width: 30,
        height: 30,
        rotation: 30,
        textAutoResize: 'WIDTH_AND_HEIGHT'
      })
      const next = rect(graph, frame.id, 10, 10)

      computeLayout(graph, frame.id)
      const first = geometryOf(graph, next)
      computeLayout(graph, frame.id)

      expect(first.x).toBeCloseTo(80 * Math.cos(Math.PI / 6) + 10 * Math.sin(Math.PI / 6), 3)
      expect(geometryOf(graph, next)).toEqual(first)
    })
  })
})
