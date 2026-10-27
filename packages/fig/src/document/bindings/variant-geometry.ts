import type { DerivedSymbolOverride } from '#fig/instance-overrides/types'
import { parseGuidOrNull } from '#fig/node-change/export/context'
import { instanceExportAddress } from '#fig/node-change/instance/geometry'

import type { GUID } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

type DerivedByPath = Map<string, DerivedSymbolOverride>

export interface SavedGeometry {
  sizes: Set<string>
  placed: ReadonlyMap<string, readonly DerivedSymbolOverride[]>
}

const pathKey = (path: readonly GUID[]) =>
  path.map((guid) => `${guid.sessionID}:${guid.localID}`).join('/')

function placedRoot(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let root: SceneNode | undefined
  for (let current: SceneNode | undefined = node; current;) {
    if (current.type === 'INSTANCE') {
      root = current
    }
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return root
}

function derivedByPath(derived: readonly DerivedSymbolOverride[]): DerivedByPath {
  const entries: DerivedByPath = new Map()
  for (const entry of derived) {
    const path = entry.guidPath?.guids
    if (path?.length) {
      entries.set(pathKey(path), { ...entries.get(pathKey(path)), ...entry })
    }
  }
  return entries
}

function savedGeometry(node: SceneNode, entry: DerivedSymbolOverride): Partial<SceneNode> {
  const size = entry.size ? { width: entry.size.x, height: entry.size.y } : {}
  const t = entry.transform
  if (!t || node.rotation !== 0 || t.m00 !== 1 || t.m11 !== 1 || t.m01 !== 0 || t.m10 !== 0) {
    return size
  }
  return { ...size, x: t.m02, y: t.m12 }
}

export function applySavedGeometryOfSwitched(
  graph: SceneGraph,
  switchedIds: readonly string[],
  saved: SavedGeometry
): void {
  const byRoot = new Map<string, DerivedByPath>()
  const resolveGuid = (id: string) => {
    const layer = graph.getNode(id)
    return parseGuidOrNull(layer?.overrideKey ?? '') ?? parseGuidOrNull(id) ?? undefined
  }
  const visited = new Set<string>()
  const visit = (root: SceneNode, entries: DerivedByPath, node: SceneNode): void => {
    if (visited.has(node.id)) {
      return
    }
    visited.add(node.id)
    const path =
      node.id === root.id ? undefined : instanceExportAddress(graph, root, node, resolveGuid)
    const entry = path && entries.get(pathKey(path))
    if (entry) {
      graph.updateNode(node.id, savedGeometry(node, entry))
      if (entry.size) {
        saved.sizes.add(node.id)
      }
    }
    for (const child of graph.getChildren(node.id)) {
      visit(root, entries, child)
    }
  }
  for (const id of switchedIds) {
    const switched = graph.getNode(id)
    const root = switched && placedRoot(graph, switched)
    if (!switched || !root) {
      continue
    }
    let entries = byRoot.get(root.id)
    if (!entries) {
      entries = derivedByPath(saved.placed.get(root.id) ?? [])
      byRoot.set(root.id, entries)
    }
    visit(root, entries, switched)
  }
}
