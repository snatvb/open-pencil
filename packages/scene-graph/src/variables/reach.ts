import type { SceneGraph } from '../index'
import { variableValueReferences } from './value'

export function collectionsReachedBy(
  graph: SceneGraph,
  variableIds: Iterable<string>
): Set<string> {
  const collections = new Set<string>()
  const queue = [...variableIds]
  const seen = new Set<string>()
  for (const variableId of queue) {
    const variable = seen.has(variableId) ? undefined : graph.variables.get(variableId)
    seen.add(variableId)
    if (!variable) {
      continue
    }
    collections.add(variable.collectionId)
    for (const value of Object.values(variable.valuesByMode)) {
      queue.push(...variableValueReferences(value))
    }
  }
  return collections
}
