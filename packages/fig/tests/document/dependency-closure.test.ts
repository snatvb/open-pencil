import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { collectSceneDependencies } from '#fig/document/dependency-closure'
import { createSourceIndex } from '#fig/instance-overrides/source-index'

import { materializeDocument } from '@open-pencil/fig'
import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'

test('retains external preferred choices separately from required component dependencies', () => {
  const changes = [
    { guid: guid(1), type: 'CANVAS' },
    {
      guid: guid(2),
      type: 'SYMBOL',
      parentIndex: { guid: guid(1), position: '!' },
      componentPropDefs: [
        {
          id: guid(90),
          type: 'INSTANCE_SWAP',
          initialValue: { guidValue: guid(3) },
          preferredValues: { instanceSwapValues: [{ key: 'external' }, { key: 'local' }] }
        }
      ]
    },
    { guid: guid(3), type: 'SYMBOL', key: 'local', parentIndex: { guid: guid(4), position: '!' } },
    { guid: guid(4), type: 'CANVAS', internalOnly: true }
  ] as NodeChange[]
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect(result.contentIds.has('1:3')).toBe(true)
  expect([...result.externalPreferredKeys]).toEqual(['external'])
  expect(result.missingIds.size).toBe(0)
})

test('includes component ownership without pulling in unrelated internal definitions', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'DOCUMENT' },
    { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
    {
      guid: guid(3),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(1), position: '"' }
    },
    { guid: guid(4), type: 'FRAME', parentIndex: { guid: guid(3), position: '!' } },
    { guid: guid(5), type: 'SYMBOL', parentIndex: { guid: guid(4), position: '!' } },
    {
      guid: guid(6),
      type: 'INSTANCE',
      parentIndex: { guid: guid(4), position: '"' },
      symbolData: { symbolID: guid(99) }
    },
    {
      guid: guid(7),
      type: 'INSTANCE',
      parentIndex: { guid: guid(2), position: '!' },
      symbolData: { symbolID: guid(5) }
    }
  ]
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect([...result.contentIds].sort()).toEqual(['1:2', '1:5', '1:7'])
  expect(result.ancestorIds.has('1:4')).toBe(true)
  expect(result.missingIds.size).toBe(0)
  expect(result.contentIds.has('1:6')).toBe(false)
  const assembled = materializeDocument(changes)
  const componentId = assembled.sources.get('1:5')
  if (!componentId) throw new Error('Missing required component')
  expect(assembled.graph.getNode(componentId)?.parentId).toBe(assembled.sources.get('1:4'))
  expect(assembled.sources.has('1:6')).toBe(false)
  const closureChanges = [
    ...changes,
    {
      guid: guid(8),
      type: 'INSTANCE',
      parentIndex: { guid: guid(2), position: '"' },
      symbolData: { symbolID: guid(99) }
    }
  ] as NodeChange[]
  const reached = collectSceneDependencies(
    closureChanges,
    undefined,
    createSourceIndex(closureChanges)
  )
  expect([...reached.missingComponentIds]).toEqual(['1:99'])
  expect(reached.missingIds.size).toBe(0)
})

function patternPaint(source: number): Paint {
  return { type: 'PATTERN', opacity: 1, visible: true, sourceNodeId: guid(source) }
}

function patternDocument(target: Partial<NodeChange>): NodeChange[] {
  return [
    { guid: guid(1), type: 'DOCUMENT' },
    { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
    {
      guid: guid(3),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(1), position: '"' }
    },
    { guid: guid(4), type: 'FRAME', parentIndex: { guid: guid(3), position: '!' } },
    { guid: guid(5), type: 'SYMBOL', parentIndex: { guid: guid(4), position: '!' } },
    { guid: guid(6), type: 'VECTOR', parentIndex: { guid: guid(5), position: '!' } },
    { guid: guid(7), type: 'FRAME', parentIndex: { guid: guid(3), position: '"' } },
    {
      guid: guid(8),
      type: 'ROUNDED_RECTANGLE',
      parentIndex: { guid: guid(2), position: '!' },
      ...target
    }
  ] as NodeChange[]
}

test('reaches the layer a pattern paint tiles, wherever it is kept', () => {
  for (const target of [
    { fillPaints: [patternPaint(5)] },
    { strokePaints: [patternPaint(5)] }
  ] as Partial<NodeChange>[]) {
    const changes = patternDocument(target)
    const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
    expect([...result.contentIds].sort()).toEqual(['1:2', '1:5', '1:6', '1:8'])
    expect(result.ancestorIds.has('1:4')).toBe(true)
    expect(result.missingIds.size).toBe(0)
  }
  const assembled = materializeDocument(patternDocument({ fillPaints: [patternPaint(5)] }))
  const sourceId = assembled.sources.get('1:5')
  if (!sourceId) {
    throw new Error('Missing pattern source')
  }
  expect(assembled.graph.getNode(sourceId)?.childIds).toHaveLength(1)
  expect(assembled.sources.has('1:7')).toBe(false)
})

test('reaches a pattern source an instance override paints with', () => {
  const changes = patternDocument({
    type: 'INSTANCE',
    symbolData: {
      symbolID: guid(7),
      symbolOverrides: [{ guidPath: { guids: [guid(9)] }, fillPaints: [patternPaint(5)] }]
    }
  } as Partial<NodeChange>)
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect(result.contentIds.has('1:5')).toBe(true)
})

test('leaves a pattern source the archive lacks out of the missing records', () => {
  const changes = patternDocument({ fillPaints: [patternPaint(99)] })
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect(result.missingIds.size).toBe(0)
  expect(result.contentIds.has('1:99')).toBe(false)
})
