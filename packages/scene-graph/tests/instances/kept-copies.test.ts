import { describe, expect, test } from 'bun:test'

import {
  captureGraphCheckpoint,
  DEFAULT_HISTORY_LIMIT,
  SceneGraph,
  setInstanceOverride,
  type SceneNode
} from '@open-pencil/scene-graph'
import {
  dropKeptTargets,
  forgetKeptCopiesIn,
  keepCopiesAgain,
  keepCopy,
  keptCopiesWithin,
  keptNodeCount,
  takeKeptCopy
} from '@open-pencil/scene-graph/instances'

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected a value')
  }
  return value
}

function setAside(graph: SceneGraph, owner: SceneNode, copy: SceneNode, layerId: string) {
  const nodes = [copy, ...graph.getChildren(copy.id)]
  keepCopy(graph, layerId, nodes, [owner.id])
  graph.deleteNode(copy.id)
  return nodes
}

function instanceWithCopy() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const component = graph.createNode('COMPONENT', page, { name: 'Chip' })
  const instance = present(graph.createInstance(component.id, page, { x: 300 }))
  const copy = graph.createNode('FRAME', instance.id, { name: 'Badge' })
  const inner = graph.createNode('RECTANGLE', copy.id, { name: 'Dot' })
  setInstanceOverride(instance.instanceOverrides, instance.id, copy.id, 'opacity')
  return { graph, instance, copy, inner }
}

describe('kept copies', () => {
  test('come back once with their nodes and leave the store empty', () => {
    const { graph, instance, copy, inner } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')

    const taken = takeKeptCopy(graph, instance.id, 'layer')

    expect(taken?.map((node) => node.id)).toEqual([copy.id, inner.id])
    expect(takeKeptCopy(graph, instance.id, 'layer')).toBeUndefined()
    expect(keptNodeCount(graph)).toBe(0)
  })

  test('keep the override entries of the instance while set aside', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')

    expect(instance.instanceOverrides.descendants.has(copy.id)).toBe(true)
  })

  test('are refused and dropped when their ids are live again', () => {
    const { graph, instance, copy } = instanceWithCopy()
    keepCopy(graph, 'layer', [copy], [instance.id])

    expect(takeKeptCopy(graph, instance.id, 'layer')).toBeUndefined()
    expect(keptNodeCount(graph)).toBe(0)
    expect(instance.instanceOverrides.descendants.has(copy.id)).toBe(true)
  })

  test('go with their parent, and their override entries with them', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')

    forgetKeptCopiesIn(graph, instance.id)

    expect(keptNodeCount(graph)).toBe(0)
    expect(instance.instanceOverrides.descendants.has(copy.id)).toBe(false)
  })

  test('set aside inside a kept copy stay while it is kept, and go when it goes', () => {
    const { graph, instance, copy, inner } = instanceWithCopy()
    setAside(graph, instance, inner, 'dot')
    setAside(graph, instance, copy, 'layer')

    expect(keptNodeCount(graph)).toBe(2)
    forgetKeptCopiesIn(graph, instance.id)
    expect(keptNodeCount(graph)).toBe(0)
  })

  test('found within a subtree can be kept again after it is restored', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')
    const found = keptCopiesWithin(graph, [instance.id])

    forgetKeptCopiesIn(graph, instance.id)
    keepCopiesAgain(graph, found)

    expect(takeKeptCopy(graph, instance.id, 'layer')?.[0]?.id).toBe(copy.id)
  })

  test('are not copied as override targets of a duplicate', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')
    const overrides = structuredClone(instance.instanceOverrides)

    dropKeptTargets(graph, overrides)

    expect(overrides.descendants.has(copy.id)).toBe(false)
  })

  test('outlive the deletion of their parent, so its undo finds them', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')

    graph.deleteNode(instance.id)

    expect(takeKeptCopy(graph, instance.id, 'layer')?.[0]?.id).toBe(copy.id)
  })

  test('leave the override state the instance had untouched when they go', () => {
    const { graph, instance, copy } = instanceWithCopy()
    setAside(graph, instance, copy, 'layer')
    const before = instance.instanceOverrides

    forgetKeptCopiesIn(graph, instance.id)

    expect(before.descendants.has(copy.id)).toBe(true)
    expect(graph.getNode(instance.id)?.instanceOverrides.descendants.has(copy.id)).toBe(false)
  })

  test('roll back with a checkpoint taken before they were set aside', () => {
    const { graph, instance, copy } = instanceWithCopy()
    const checkpoint = captureGraphCheckpoint(graph)
    setAside(graph, instance, copy, 'layer')

    checkpoint.restore()

    expect(keptNodeCount(graph)).toBe(0)
    expect(graph.getNode(copy.id)?.parentId).toBe(instance.id)
  })

  test('outlive one delete of more parents than undo keeps steps', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', page, { name: 'Chip' })
    const frame = graph.createNode('FRAME', page, { name: 'Row' })
    const copies = Array.from({ length: DEFAULT_HISTORY_LIMIT + 1 }, () => {
      const instance = present(graph.createInstance(component.id, frame.id))
      const copy = graph.createNode('FRAME', instance.id, { name: 'Badge' })
      setAside(graph, instance, copy, 'layer')
      return { instance, copy }
    })

    graph.deleteNode(frame.id)

    expect(keptNodeCount(graph)).toBe(copies.length)
  })

  test('go once more deletes than undo keeps steps follow their parent’s', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', page, { name: 'Chip' })
    const copies = Array.from({ length: DEFAULT_HISTORY_LIMIT + 1 }, () => {
      const instance = present(graph.createInstance(component.id, page))
      const copy = graph.createNode('FRAME', instance.id, { name: 'Badge' })
      setAside(graph, instance, copy, 'layer')
      return { instance, copy }
    })

    for (const { instance } of copies) {
      graph.deleteNode(instance.id)
    }

    const [first, ...rest] = copies
    expect(takeKeptCopy(graph, present(first).instance.id, 'layer')).toBeUndefined()
    expect(keptNodeCount(graph)).toBe(rest.length)
  })
})
