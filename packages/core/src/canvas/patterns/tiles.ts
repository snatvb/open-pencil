import type { Shader } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { ResourceCache } from '#core/cache/resource'
import type { SkiaRenderer } from '#core/canvas/renderer'

const MAX_PATTERN_TILES = 64

interface PatternTile {
  shader: Shader
  sourceId: string
}

export class PatternTiles {
  readonly shaders = new ResourceCache<string, PatternTile>({
    maxEntries: MAX_PATTERN_TILES,
    dispose: (tile) => tile.shader.delete()
  })
  readonly unresolvedSources = new Set<string>()
  readonly sourcesInProgress = new Set<string>()
  private readonly targetsBySource = new Map<string, Set<string>>()
  private graph: SceneGraph | null = null
  private fontGeneration = -1

  prepare(graph: SceneGraph, fontGeneration: number): void {
    if (graph === this.graph && fontGeneration === this.fontGeneration) {
      return
    }
    this.clear()
    this.graph = graph
    this.fontGeneration = fontGeneration
  }

  clear(): void {
    this.shaders.clear()
    this.unresolvedSources.clear()
    this.targetsBySource.clear()
  }

  addTarget(sourceId: string, targetId: string): void {
    const targets = this.targetsBySource.get(sourceId)
    if (targets) {
      targets.add(targetId)
    } else {
      this.targetsBySource.set(sourceId, new Set([targetId]))
    }
  }

  takeTargetsOfSourcesAround(nodeId: string): string[] {
    this.unresolvedSources.clear()
    const graph = this.graph
    if (!graph || this.targetsBySource.size === 0) {
      return []
    }
    const targets: string[] = []
    let current = graph.getNode(nodeId)
    while (current) {
      const sourceTargets = this.targetsBySource.get(current.id)
      if (sourceTargets) {
        const sourceId = current.id
        this.targetsBySource.delete(sourceId)
        this.shaders.deleteWhere((tile) => tile.sourceId === sourceId)
        targets.push(...sourceTargets)
      }
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
    return targets
  }
}

const tilesByRenderer = new WeakMap<SkiaRenderer, PatternTiles>()

export function patternTilesOf(r: SkiaRenderer): PatternTiles {
  const existing = tilesByRenderer.get(r)
  if (existing) {
    return existing
  }
  const tiles = new PatternTiles()
  tilesByRenderer.set(r, tiles)
  return tiles
}

export function clearPatternTiles(r: SkiaRenderer): void {
  tilesByRenderer.get(r)?.clear()
}

export function invalidatePatternTargets(r: SkiaRenderer, nodeId: string): void {
  const tiles = tilesByRenderer.get(r)
  if (!tiles) {
    return
  }
  for (const targetId of tiles.takeTargetsOfSourcesAround(nodeId)) {
    r.invalidateNodePicture(targetId)
    r.tiledScene.invalidateNode(targetId)
  }
}
