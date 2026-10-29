import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { extractExportGraph, extractPageContext } from '#core/io/subgraph'

/** A Switch set with two variants, and a card on the same page holding an Off instance. */
function cardWithSwitch() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const set = graph.createNode('COMPONENT_SET', pageId, { name: 'Switch' })
  const off = graph.createNode('COMPONENT', set.id, { name: 'State=Off' })
  const on = graph.createNode('COMPONENT', set.id, { name: 'State=On' })
  const card = graph.createNode('FRAME', pageId, { name: 'Card' })
  const instance = graph.createInstance(off.id, card.id)
  if (!instance) throw new Error('No instance')
  return { graph, pageId, card, instance, off, on }
}

describe('extracting page context', () => {
  test("brings an instance's main component, or its whole set when asked", () => {
    const { graph, pageId, card, off, on } = cardWithSwitch()
    const plain = extractPageContext(graph, pageId, [card.id])
    expect(plain.getNode(off.id)).toBeDefined()
    expect(plain.getNode(on.id)).toBeUndefined()
    const withSets = extractPageContext(graph, pageId, [card.id], { componentSets: true })
    expect(withSets.getNode(on.id)).toBeDefined()
  })

  test('indexes instances by component, so the copy can sync and swap them', () => {
    const { graph, pageId, card, instance, off } = cardWithSwitch()
    const copy = extractPageContext(graph, pageId, [card.id], { componentSets: true })
    expect([...(copy.instanceIndex.get(off.id) ?? [])]).toEqual([instance.id])
  })

  test("copies the source's tables, or shares them for a read-only view", () => {
    const { graph, pageId, card } = cardWithSwitch()
    expect(extractPageContext(graph, pageId, [card.id]).variables).not.toBe(graph.variables)
    const shared = extractPageContext(graph, pageId, [card.id], { shareTables: true })
    expect(shared.variables).toBe(graph.variables)
    expect(shared.images).toBe(graph.images)
  })
})

describe('extracting an export', () => {
  test('brings the layer a pattern paint tiles, from any page', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const sources = graph.addPage('Sources')
    const holder = graph.createNode('FRAME', sources.id)
    const source = graph.createNode('FRAME', holder.id)
    const stripe = graph.createNode('LINE', source.id)
    const target = graph.createNode('RECTANGLE', pageId, {
      fills: [
        {
          type: 'PATTERN',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          sourceNodeId: source.id
        }
      ]
    })
    const copy = extractExportGraph(graph, { scope: 'selection', nodeIds: [target.id] }).graph
    expect(copy.getNode(stripe.id)).toBeDefined()
    expect(copy.getNode(holder.id)).toBeDefined()
    expect(copy.getNode(sources.id)?.childIds).toEqual([holder.id])
  })

  test('brings every layer of a source that another source sits inside', () => {
    for (const innerFirst of [true, false]) {
      const graph = new SceneGraph()
      const pageId = graph.getPages()[0].id
      const outer = graph.createNode('FRAME', pageId, { x: 200 })
      const inner = graph.createNode('FRAME', outer.id)
      const innerMark = graph.createNode('LINE', inner.id)
      const outerMark = graph.createNode('LINE', outer.id)
      const pattern = (sourceNodeId: string) => ({
        type: 'PATTERN' as const,
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        sourceNodeId
      })
      const order = innerFirst ? [inner, outer] : [outer, inner]
      const targets = order.map((source) =>
        graph.createNode('RECTANGLE', pageId, { fills: [pattern(source.id)] })
      )
      const nodeIds = targets.map((target) => target.id)
      const copy = extractExportGraph(graph, { scope: 'selection', nodeIds }).graph
      expect(copy.getNode(innerMark.id)).toBeDefined()
      expect(copy.getNode(outerMark.id)).toBeDefined()
    }
  })
})
