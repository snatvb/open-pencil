import {
  findComponentPropertyTargets,
  type ComponentPropertyDefinition,
  type SceneGraph
} from '@open-pencil/scene-graph'

import { textAutoResizeChanges } from './text-auto-resize'

export function measurePropertyText(
  graph: SceneGraph,
  instanceId: string,
  definition: ComponentPropertyDefinition
): void {
  const instance = graph.getNode(instanceId)
  if (definition.type !== 'TEXT' || !instance) {
    return
  }
  for (const target of findComponentPropertyTargets(graph, instance, definition.id)) {
    if (target.field !== 'TEXT') {
      continue
    }
    const changes = textAutoResizeChanges(target.node, { text: target.node.text })
    if (Object.keys(changes).length > 0) {
      graph.updateNode(target.node.id, changes)
    }
  }
}
