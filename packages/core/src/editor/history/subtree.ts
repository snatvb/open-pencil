import {
  cloneInstanceOverrideState,
  type InstanceOverrideState,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

export function collectSubtrees(graph: SceneGraph, rootIds: string[]): SceneNode[] {
  const result: SceneNode[] = []
  function walk(id: string) {
    const node = graph.getNode(id)
    if (!node) return
    result.push(structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  for (const id of rootIds) walk(id)
  return result
}

export function snapshotSubtree(graph: SceneGraph, rootId: string): Map<string, SceneNode> {
  const index = new Map<string, SceneNode>()
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    index.set(id, structuredClone(node))
    for (const childId of node.childIds) walk(childId)
  }
  walk(rootId)
  return index
}

export function restoreSubtree(
  graph: SceneGraph,
  snapshot: SceneNode,
  parentId: string,
  index: Map<string, SceneNode>
): void {
  const { parentId: _parentId, childIds, ...rest } = snapshot
  graph.createNode(snapshot.type, parentId, { ...rest, id: snapshot.id })
  for (const childId of childIds) {
    const child = index.get(childId)
    if (child) restoreSubtree(graph, child, snapshot.id, index)
  }
}

export interface InstanceSnapshot {
  instanceId: string
  nodes: Map<string, SceneNode>
  owners: Map<string, InstanceOverrideState>
}

export function snapshotInstance(graph: SceneGraph, instanceId: string): InstanceSnapshot {
  const owners = new Map<string, InstanceOverrideState>()
  const instance = graph.getNode(instanceId)
  if (instance?.parentId) {
    graph.closest(instance.parentId, (node) => {
      if (node.type === 'INSTANCE') {
        owners.set(node.id, cloneInstanceOverrideState(node.instanceOverrides))
      }
      return false
    })
  }
  return { instanceId, nodes: snapshotSubtree(graph, instanceId), owners }
}

export function restoreInstance(graph: SceneGraph, snapshot: InstanceSnapshot): void {
  const live = graph.getNode(snapshot.instanceId)
  const saved = snapshot.nodes.get(snapshot.instanceId)
  if (!live || !saved) {
    return
  }
  const nodes = new Map<string, SceneNode>()
  for (const [id, node] of snapshot.nodes) {
    nodes.set(id, structuredClone(node))
  }
  for (const childId of live.childIds.slice()) {
    graph.deleteNode(childId)
  }
  const { id: _id, parentId: _parentId, childIds, ...props } = structuredClone(saved)
  graph.updateNode(snapshot.instanceId, props)
  for (const childId of childIds) {
    const child = nodes.get(childId)
    if (child) {
      restoreSubtree(graph, child, snapshot.instanceId, nodes)
    }
  }
  for (const [ownerId, overrides] of snapshot.owners) {
    graph.updateNode(ownerId, { instanceOverrides: cloneInstanceOverrideState(overrides) })
  }
}
