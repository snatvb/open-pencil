import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderNodesToHTML } from '#core/io/formats/html'
import { readHTMLDocument } from '#core/io/formats/html/import'

const WHITE = [
  { type: 'SOLID' as const, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
]

function rowWithBlendedShadow(): { graph: SceneGraph; rootId: string } {
  const graph = new SceneGraph()
  const row = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 200,
    height: 100,
    fills: WHITE,
    layoutMode: 'HORIZONTAL',
    itemSpacing: 10,
    paddingLeft: 10,
    paddingTop: 10
  })
  graph.createNode('RECTANGLE', row.id, {
    width: 40,
    height: 40,
    cornerRadius: 6,
    fills: WHITE,
    effects: [
      {
        type: 'DROP_SHADOW',
        radius: 10,
        spread: 0,
        offset: { x: 0, y: 4 },
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        visible: true,
        blendMode: 'MULTIPLY'
      }
    ]
  })
  graph.createNode('RECTANGLE', row.id, { width: 40, height: 40, fills: WHITE })
  return { graph, rootId: row.id }
}

function shape(graph: SceneGraph, node: SceneNode): unknown {
  return {
    type: node.type,
    box: [node.x, node.y, node.width, node.height],
    layoutMode: node.layoutMode,
    layoutPositioning: node.layoutPositioning,
    effects: node.effects.map((effect) => [effect.type, effect.radius, effect.blendMode]),
    children: graph.getChildren(node.id).map((child) => shape(graph, child))
  }
}

const withoutLayerIds = (html: string) => html.replace(/ data-open-pencil-node-id="[^"]*"/g, '')

describe('blended drop shadows through HTML and back', () => {
  test('import the carrier as the layer’s own shadow, with its blend, the same every round', async () => {
    let { graph, rootId } = rowWithBlendedShadow()
    const rounds: { html: string; shape: unknown }[] = []
    for (let round = 0; round < 3; round++) {
      const { html } = await renderNodesToHTML(graph, [rootId], { html: 'fragment' })
      graph = (await readHTMLDocument(html)).graph
      const [row] = graph.getChildren(graph.getPages()[0].id)
      if (!row) {
        throw new Error('Expected the row imported')
      }
      rootId = row.id
      rounds.push({ html: withoutLayerIds(html), shape: shape(graph, row) })
    }
    const [first, second, third] = rounds
    expect(first?.shape).toMatchObject({
      layoutMode: 'HORIZONTAL',
      children: [
        { layoutMode: 'NONE', effects: [['DROP_SHADOW', 10, 'MULTIPLY']], children: [] },
        { effects: [], children: [] }
      ]
    })
    expect(second?.shape).toEqual(first?.shape)
    expect(third?.shape).toEqual(first?.shape)
    expect(third?.html).toBe(second?.html)
  })
})
