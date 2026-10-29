import type { SceneGraph } from '../graph'
import type { Fill, SceneNode } from '../types'

function addPatternSourceIds(paints: readonly Fill[], ids: string[]) {
  for (const paint of paints) {
    if (paint.type === 'PATTERN' && paint.sourceNodeId) {
      ids.push(paint.sourceNodeId)
    }
  }
}

export function patternSourceIds(node: SceneNode): string[] {
  const ids: string[] = []
  addPatternSourceIds(node.fills, ids)
  addPatternSourceIds(node.strokes, ids)
  return ids
}

function indexBySourceId(graph: SceneGraph): Map<string, SceneNode> {
  const index = new Map<string, SceneNode>()
  for (const node of graph.getAllNodes()) {
    if (node.source.id && !index.has(node.source.id)) {
      index.set(node.source.id, node)
    }
  }
  return index
}

export function createPatternSourceLookup(
  graph: SceneGraph
): (sourceId: string) => SceneNode | null {
  let bySourceId: Map<string, SceneNode> | null = null
  return (sourceId) => {
    const direct = graph.getNode(sourceId)
    if (direct) {
      return direct
    }
    bySourceId ??= indexBySourceId(graph)
    return bySourceId.get(sourceId) ?? null
  }
}
