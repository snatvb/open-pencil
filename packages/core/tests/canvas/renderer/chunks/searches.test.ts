import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { RememberedChunkSearches } from '#core/canvas/renderer/chunks/searches'

function found(count: number) {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  for (let index = 0; index < count; index++) {
    graph.createNode('RECTANGLE', page.id, { x: index * 20, y: 0, width: 10, height: 10 })
  }
  const { index } = RenderChunkIndex.build(graph, page.id)
  const chunks = index.search({ minX: -1, minY: -1, maxX: count * 20, maxY: 11 })
  index.dispose()
  expect(chunks).toHaveLength(count)
  return { chunks, backdropReach: 0 }
}

describe('remembered chunk searches', () => {
  test('clears once the chunk references held would pass the limit', () => {
    const searches = new RememberedChunkSearches({ searches: 100, chunkReferences: 10 })
    searches.remember('a', found(4))
    searches.remember('b', found(6))
    expect([searches.size, searches.chunkReferences]).toEqual([2, 10])

    searches.remember('c', found(1))

    expect([searches.size, searches.chunkReferences]).toEqual([1, 1])
    expect(searches.get('a')).toBeUndefined()
    expect(searches.get('c')?.chunks).toHaveLength(1)
  })

  test('clears once the searches held reach the limit', () => {
    const searches = new RememberedChunkSearches({ searches: 2, chunkReferences: 100 })
    searches.remember('a', found(0))
    searches.remember('b', found(0))

    searches.remember('c', found(0))

    expect(searches.size).toBe(1)
    expect(searches.get('b')).toBeUndefined()
  })
})
