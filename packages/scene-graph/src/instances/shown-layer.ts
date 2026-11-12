import type { SceneGraph } from '../graph'
import type { SceneNode } from '../types'
import { findInstanceAncestor } from './main-component'

function copiedLayer(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  const owner = node.parentId ? findInstanceAncestor(graph, node.parentId) : undefined
  if (!owner) {
    return undefined
  }
  const linked = owner.instanceOverrides.descendants.get(node.id)?.get('sourceComponentId')
  const layerId = typeof linked === 'string' ? linked : node.componentId
  return layerId ? graph.getNode(layerId) : undefined
}

export function shownLayerId(graph: SceneGraph, layer: SceneNode): string {
  const seen = new Set<string>()
  let current = layer
  for (let next = copiedLayer(graph, current); next && !seen.has(next.id);) {
    seen.add(current.id)
    current = next
    next = copiedLayer(graph, current)
  }
  return current.id
}
