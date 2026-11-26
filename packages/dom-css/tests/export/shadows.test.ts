import { describe, expect, test } from 'bun:test'

import type { DesignElement, DesignNode } from '@open-pencil/dom-css'
import {
  isShadowCarrier,
  sceneNodeToDesignDocument,
  SHADOW_CARRIER_ATTRIBUTE
} from '@open-pencil/dom-css/export'
import { SceneGraph, type Effect, type SceneNode } from '@open-pencil/scene-graph'
import { createShaderPaint, withShaderPaints } from '@open-pencil/scene-graph/shaders'

const SHADOW_COLOR = { r: 0, g: 0, b: 0, a: 0.5 }

function shadow(radius: number, props: Partial<Effect> = {}): Effect {
  return {
    type: 'DROP_SHADOW',
    radius,
    spread: 0,
    offset: { x: 0, y: 0 },
    color: SHADOW_COLOR,
    visible: true,
    blendMode: 'NORMAL',
    ...props
  }
}

const multiply = (radius = 10) => shadow(radius, { blendMode: 'MULTIPLY' })

function element(node: DesignNode | undefined): DesignElement {
  if (node?.type !== 'element') {
    throw new Error('Expected an element')
  }
  return node
}

function exportedNode(graph: SceneGraph, id: string): DesignElement {
  return element(sceneNodeToDesignDocument(graph, id).children[0])
}

function exported(effects: Effect[], props: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 40,
    height: 20,
    effects,
    ...props
  })
  return exportedNode(graph, node.id)
}

const carriers = (host: DesignElement) => host.children.filter(isShadowCarrier).map(element)

describe('blended drop shadows in HTML export', () => {
  test('carry a blended drop shadow on a marked element of its own that blends with the page', () => {
    const host = exported([multiply()])
    expect(host.inlineStyle?.['box-shadow']).toBeUndefined()
    expect(host.inlineStyle?.position).toBe('relative')
    expect(carriers(host).map((carrier) => [carrier.attrs, carrier.inlineStyle])).toEqual([
      [
        { 'aria-hidden': 'true', [SHADOW_CARRIER_ATTRIBUTE]: 'drop' },
        {
          position: 'absolute',
          top: '0px',
          right: '0px',
          bottom: '0px',
          left: '0px',
          'border-radius': 'inherit',
          'box-shadow': '0px 0px 8.6px 0px rgba(0, 0, 0, 0.5)',
          'mix-blend-mode': 'multiply',
          'pointer-events': 'none'
        }
      ]
    ])
  })

  test('keep a normal shadow on the element itself, as before', () => {
    const host = exported([shadow(10, { offset: { x: 1, y: 2 } })], { cornerRadius: 4 })
    expect(host.inlineStyle).toEqual({
      width: '40px',
      height: '20px',
      'box-shadow': '1px 2px 8.6px 0px rgba(0, 0, 0, 0.5)',
      'border-radius': '4px'
    })
    expect(host.children).toEqual([])
  })

  test('split normal and blended shadows, each blend on its own carrier', () => {
    const host = exported([
      shadow(10),
      shadow(20, { blendMode: 'SOFT_LIGHT', offset: { x: 0, y: 4 } })
    ])
    expect(host.inlineStyle?.['box-shadow']).toBe('0px 0px 8.6px 0px rgba(0, 0, 0, 0.5)')
    expect(
      carriers(host).map((carrier) => [
        carrier.inlineStyle?.['box-shadow'],
        carrier.inlineStyle?.['mix-blend-mode']
      ])
    ).toEqual([['0px 4px 17.2px 0px rgba(0, 0, 0, 0.5)', 'soft-light']])
  })

  test('write no blend of the layer itself, which the export leaves out, only the shadow’s', () => {
    const host = exported([multiply()], { blendMode: 'SCREEN' })
    expect(host.inlineStyle?.['mix-blend-mode']).toBeUndefined()
    expect(carriers(host).map((carrier) => carrier.inlineStyle?.['mix-blend-mode'])).toEqual([
      'multiply'
    ])
  })

  test('cover the border box, where the element’s own shadow would start', () => {
    const host = exported([multiply()], {
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'INSIDE'
        }
      ]
    })
    const [carrier] = carriers(host)
    expect([
      carrier?.inlineStyle?.top,
      carrier?.inlineStyle?.right,
      carrier?.inlineStyle?.bottom,
      carrier?.inlineStyle?.left
    ]).toEqual(['-2px', '-2px', '-2px', '-2px'])
  })

  test('keep blended inner shadows on the element, under its children', () => {
    const host = exported([shadow(10, { type: 'INNER_SHADOW', blendMode: 'MULTIPLY' })])
    expect(host.inlineStyle?.['box-shadow']).toBe('inset 0px 0px 8.6px 0px rgba(0, 0, 0, 0.5)')
    expect(carriers(host)).toEqual([])
  })
})

describe('blended drop shadows a carrier cannot blend keep the plain shadow', () => {
  const PLAIN = '0px 0px 8.6px 0px rgba(0, 0, 0, 0.5)'

  test('on a clipping element, whose overflow would hide the carrier', () => {
    const host = exported([multiply()], { clipsContent: true })
    expect(host.inlineStyle?.['box-shadow']).toBe(PLAIN)
    expect(carriers(host)).toEqual([])
  })

  test('on a rotated element, whose transform keeps the blend inside it', () => {
    const host = exported([multiply()], { rotation: 15 })
    expect(host.inlineStyle?.['box-shadow']).toBe(PLAIN)
    expect(carriers(host)).toEqual([])
  })

  test('for linear burn, whose plus-darker most browsers lack', () => {
    const host = exported([shadow(10, { blendMode: 'LINEAR_BURN' })])
    expect(host.inlineStyle?.['box-shadow']).toBe(PLAIN)
    expect(carriers(host)).toEqual([])
  })

  test('on an image, which holds no elements', () => {
    const graph = new SceneGraph()
    graph.images.set('picture', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      width: 40,
      height: 20,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'picture',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      effects: [multiply()]
    })
    const host = exportedNode(graph, node.id)
    expect(host.tagName).toBe('img')
    expect(host.inlineStyle?.['box-shadow']).toBe(PLAIN)
    expect(host.children).toEqual([])
  })

  test('on a shader layer, whose isolation keeps the blend inside it', () => {
    const graph = new SceneGraph()
    const { paint, shader } = createShaderPaint({ components: [{ type: 'FilmGrain' }] })
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      width: 40,
      height: 20,
      fills: [paint],
      effects: [multiply()]
    })
    graph.updateNode(node.id, { pluginData: withShaderPaints(node, [paint], [shader]) })
    const host = exportedNode(graph, node.id)
    expect(host.inlineStyle?.isolation).toBe('isolate')
    expect(host.inlineStyle?.['box-shadow']).toBe(PLAIN)
    expect(carriers(host)).toEqual([])
  })
})

describe('paint order around a blended drop shadow', () => {
  function row() {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
      width: 200,
      height: 60,
      layoutMode: 'HORIZONTAL'
    })
    const before = graph.createNode('RECTANGLE', frame.id, { width: 40, height: 40 })
    const host = graph.createNode('FRAME', frame.id, {
      width: 40,
      height: 40,
      layoutMode: 'VERTICAL',
      effects: [multiply()]
    })
    const inside = graph.createNode('RECTANGLE', host.id, { width: 60, height: 20 })
    graph.createNode('RECTANGLE', host.id, { width: 20, height: 20, effects: [multiply()] })
    const after = graph.createNode('RECTANGLE', frame.id, { width: 40, height: 40 })
    const projected = exportedNode(graph, frame.id)
    const byId = (id: string) =>
      element(
        [projected, ...projected.children.map(element)]
          .flatMap((item) => [item, ...item.children.map(element)])
          .find((item) => item.sourceSceneNodeId === id)
      )
    return { position: (id: string) => byId(id).inlineStyle?.position, before, inside, after }
  }

  test('a later sibling and the layer’s own children paint over the shadow, in tree order', () => {
    const { position, inside, after } = row()
    expect(position(after.id)).toBe('relative')
    expect(position(inside.id)).toBe('relative')
  })

  test('an earlier sibling stays under the shadow, as it was', () => {
    const { position, before } = row()
    expect(position(before.id)).toBeUndefined()
  })
})
