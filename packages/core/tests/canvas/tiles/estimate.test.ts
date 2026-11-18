import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { effect } from '#core-tests/canvas/blur/helpers'
import { isEqual } from 'es-toolkit'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { SkiaRenderer } from '#core/canvas'
import {
  type RenderChunk,
  RenderChunkIndex,
  RenderChunkPictureCache
} from '#core/canvas/renderer/chunks'
import {
  type TileKey,
  tileKeysForWorldBounds,
  tileLevel,
  tileWorldBounds
} from '#core/canvas/renderer/tiles'
import { TileCostModel } from '#core/canvas/renderer/tiles/cost'
import { estimateTileCost, tileChunks } from '#core/canvas/renderer/tiles/render'

const PER_CHUNK_MS = 0.25
const SCENE_SIZE = 4_000
const GRID_STEP = 90

let ck: Awaited<ReturnType<typeof getCanvasKit>>
const disposables: { delete: () => void }[] = []

beforeAll(async () => {
  ck = await getCanvasKit()
})

afterEach(() => {
  for (const disposable of disposables.splice(0)) {
    disposable.delete()
  }
})

function gridScene(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'default page')
  for (let y = 0; y < SCENE_SIZE; y += GRID_STEP) {
    for (let x = 0; x < SCENE_SIZE; x += GRID_STEP) {
      const blurred = (x + y) % (GRID_STEP * 7) === 0
      graph.createNode('RECTANGLE', page.id, {
        x,
        y,
        width: 60,
        height: 40,
        effects: blurred ? [effect('BACKGROUND_BLUR', 24)] : []
      })
    }
  }
  return { graph, pageId: page.id }
}

function builtIndex(graph: SceneGraph, pageId: string): RenderChunkIndex {
  const { index } = RenderChunkIndex.build(graph, pageId)
  disposables.push({ delete: () => index.dispose() })
  return index
}

function setup() {
  const { graph, pageId } = gridScene()
  const index = builtIndex(graph, pageId)
  const surface = expectDefined(ck.MakeSurface(64, 64), 'estimate surface')
  const renderer = new SkiaRenderer(ck, surface)
  disposables.push({ delete: () => renderer.destroy() })
  const costs = new TileCostModel()
  return { graph, pageId, index, renderer, costs, pictureCache: new RenderChunkPictureCache() }
}

function sceneKeys(pageId: string, level: number): TileKey[] {
  return tileKeysForWorldBounds(pageId, level, {
    minX: -200,
    minY: -200,
    maxX: SCENE_SIZE + 200,
    maxY: SCENE_SIZE + 200
  })
}

function chunkIds(chunks: readonly RenderChunk[]): string[] {
  return chunks.map((chunk) => chunk.id)
}

function inPaintOrder(chunks: readonly RenderChunk[]): boolean {
  return chunks.every((chunk, at) => at === 0 || chunks[at - 1].painterOrder < chunk.painterOrder)
}

function teachLevel(costs: TileCostModel, pageId: string, level: number): void {
  costs.record({ pageId, level, x: -1_000, y: -1_000 }, PER_CHUNK_MS * 4, 4)
}

describe('tile cost estimate', () => {
  test.each([
    [0.25, 2304],
    [1, 3080],
    [2, 3945]
  ])('counts the chunks every tile draws at level %p as before', (scale, chunksDrawn) => {
    const { pageId, index, renderer, costs, pictureCache } = setup()
    const level = tileLevel(scale)
    teachLevel(costs, pageId, level)
    let total = 0
    for (const key of sceneKeys(pageId, level)) {
      const first = estimateTileCost(renderer, index, pictureCache, costs, key, false)
      expect(estimateTileCost(renderer, index, pictureCache, costs, key, false)).toBe(first)
      total += first
    }

    expect(total).toBe(PER_CHUNK_MS * chunksDrawn)
  })

  test('counts the chunks a backdrop blur reaches past the tile', () => {
    const { pageId, index, renderer, costs, pictureCache } = setup()
    const key = { pageId, level: 1, x: 0, y: 0 }
    teachLevel(costs, pageId, key.level)

    expect(index.search(tileWorldBounds(key))).toHaveLength(36)
    expect(estimateTileCost(renderer, index, pictureCache, costs, key, false)).toBe(
      PER_CHUNK_MS * 49
    )
  })

  test('leaves the chunks a tile draws in paint order after estimates', () => {
    const { graph, pageId, index, renderer, costs, pictureCache } = setup()
    const fresh = builtIndex(graph, pageId)
    const level = tileLevel(2)
    teachLevel(costs, pageId, level)
    let unorderedSearches = 0
    for (const key of sceneKeys(pageId, level)) {
      estimateTileCost(renderer, index, pictureCache, costs, key, false)
      const bounds = tileWorldBounds(key)
      const remembered = chunkIds(index.searchUnordered(bounds).chunks)
      if (!isEqual(remembered, chunkIds(index.search(bounds)))) {
        unorderedSearches++
      }

      expect(inPaintOrder(tileChunks(index, key))).toBe(true)
      expect(chunkIds(tileChunks(index, key))).toEqual(chunkIds(tileChunks(fresh, key)))
      expect(chunkIds(tileChunks(index, key))).toEqual(chunkIds(tileChunks(fresh, key)))
      expect(chunkIds(index.searchUnordered(bounds).chunks)).toEqual(remembered)
    }
    expect(unorderedSearches).toBeGreaterThan(0)
  })

  test('draws a tile in the new paint order after layers are reordered', () => {
    const { graph, pageId, index, renderer, costs, pictureCache } = setup()
    const key = { pageId, level: tileLevel(0.25), x: 0, y: 0 }
    teachLevel(costs, pageId, key.level)
    estimateTileCost(renderer, index, pictureCache, costs, key, false)
    const before = chunkIds(tileChunks(index, key))

    const bottom = expectDefined(graph.getChildren(pageId)[0], 'bottom layer')
    graph.insertChildAt(bottom.id, pageId, graph.getChildren(pageId).length)
    index.renumber(graph, pageId)
    estimateTileCost(renderer, index, pictureCache, costs, key, false)
    const after = chunkIds(tileChunks(index, key))

    expect(after).not.toEqual(before)
    expect(inPaintOrder(tileChunks(index, key))).toBe(true)
    expect(after).toEqual(chunkIds(tileChunks(builtIndex(graph, pageId), key)))
  })

  test('a moving frame still finds the chunks it has not recorded', () => {
    const { pageId, index, renderer, costs, pictureCache } = setup()
    const key = { pageId, level: tileLevel(1), x: 0, y: 0 }
    teachLevel(costs, pageId, key.level)

    expect(estimateTileCost(renderer, index, pictureCache, costs, key, false)).toBeGreaterThan(0)
    expect(estimateTileCost(renderer, index, pictureCache, costs, key, true)).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  test('follows a layer moved, added or removed after an earlier estimate', () => {
    const { graph, pageId, index, renderer, costs, pictureCache } = setup()
    const level = tileLevel(1)
    teachLevel(costs, pageId, level)
    const farKey = { pageId, level, x: 100, y: 100 }
    const far = tileWorldBounds(farKey)
    const estimate = () => estimateTileCost(renderer, index, pictureCache, costs, farKey, false)
    expect(estimate()).toBe(0)

    const moved = expectDefined(graph.getChildren(pageId)[1], 'grid layer')
    graph.updateNode(moved.id, { x: far.minX + 10, y: far.minY + 10 })
    index.updateNode(graph, moved.id)
    expect(estimate()).toBe(PER_CHUNK_MS)

    const added = graph.createNode('RECTANGLE', pageId, {
      x: far.minX + 50,
      y: far.minY + 50,
      width: 10,
      height: 10
    })
    index.rebuildTop(graph, pageId, added.id)
    expect(estimate()).toBe(PER_CHUNK_MS * 2)

    graph.deleteNode(added.id)
    index.rebuildTop(graph, pageId, added.id)
    expect(estimate()).toBe(PER_CHUNK_MS)
  })
})
