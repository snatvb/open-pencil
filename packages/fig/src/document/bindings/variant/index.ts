import { isEmptyObject } from 'es-toolkit/predicate'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { showBoundVariants } from '@open-pencil/scene-graph/variables'

import { applySavedGeometryOfSwitched, type SavedGeometry } from './geometry'

function isDefinitionLayer(node: SceneNode): boolean {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
}

function placedBoundInstances(graph: SceneGraph, materialized: readonly SceneNode[]): SceneNode[] {
  return materialized.filter(
    (node) =>
      node.type === 'INSTANCE' &&
      !isEmptyObject(node.variantBindings) &&
      graph.closest(node.id, isDefinitionLayer) === undefined
  )
}

export function showDocumentVariantBindings(
  graph: SceneGraph,
  materialized: readonly SceneNode[],
  isNew: (node: SceneNode) => boolean,
  savedGeometry: SavedGeometry
): readonly SceneNode[] {
  const switched = showBoundVariants(graph, placedBoundInstances(graph, materialized))
  if (switched.length === 0) {
    return materialized
  }
  applySavedGeometryOfSwitched(graph, switched, savedGeometry)
  return [...graph.nodes.values()].filter(isNew)
}
