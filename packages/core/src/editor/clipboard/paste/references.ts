import { remapInstanceOverrideState } from '@open-pencil/scene-graph'
import type { InstanceOverrideState, SceneNode } from '@open-pencil/scene-graph'

export function pastedReferences(
  node: SceneNode,
  copiedIds: ReadonlyMap<string, string>,
  pastedCollection: (id: string) => string | undefined = (id) => id
): Partial<SceneNode> {
  const pastedId = (id: string) => copiedIds.get(id) ?? id
  const copiedMain = node.componentId ? copiedIds.get(node.componentId) : undefined
  return {
    componentId: copiedMain ?? node.componentId,
    instanceOverrides: remapInstanceOverrideState(withoutStaleCollisions(node, copiedIds), {
      node: pastedId,
      variable: (id) => id,
      collection: pastedCollection
    }),
    ...pastedSavedComponent(node, copiedIds, copiedMain !== undefined)
  }
}

function withoutStaleCollisions(
  node: SceneNode,
  copiedIds: ReadonlyMap<string, string>
): InstanceOverrideState {
  const fresh = new Set(copiedIds.values())
  const descendants = [...node.instanceOverrides.descendants].filter(
    ([id]) => copiedIds.has(id) || !fresh.has(id)
  )
  return { self: node.instanceOverrides.self, descendants: new Map(descendants) }
}

function pastedSavedComponent(
  node: SceneNode,
  copiedIds: ReadonlyMap<string, string>,
  mainCopied: boolean
): Partial<SceneNode> {
  const saved = node.source.fig.savedComponentId
  if (!saved) {
    return {}
  }
  const pasted = copiedIds.get(saved) ?? (mainCopied ? null : saved)
  return { source: { ...node.source, fig: { ...node.source.fig, savedComponentId: pasted } } }
}
