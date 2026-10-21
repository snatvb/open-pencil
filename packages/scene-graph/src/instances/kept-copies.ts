import { omitBy } from 'es-toolkit/object'
import { isUndefined } from 'es-toolkit/predicate'

import type { SceneGraph } from '../index'
import { cloneInstanceOverrideState, type InstanceOverrideState } from '../instance-overrides'
import type { SceneNode } from '../types'
import { DEFAULT_HISTORY_LIMIT } from '../undo'

export interface KeptCopy {
  parentId: string
  layerId: string
  nodes: SceneNode[]
  ownerIds: string[]
}

interface KeptCopies {
  byParent: Map<string, Map<string, KeptCopy>>
  nodes: Map<string, SceneNode>
  deletions: string[][]
  deleting: string[]
}

const keptCopiesByGraph = new WeakMap<SceneGraph, KeptCopies>()

function storeOf(graph: SceneGraph): KeptCopies {
  const known = keptCopiesByGraph.get(graph)
  if (known) {
    return known
  }
  const store: KeptCopies = {
    byParent: new Map(),
    nodes: new Map(),
    deletions: [],
    deleting: []
  }
  keptCopiesByGraph.set(graph, store)
  return store
}

export function keptNode(graph: SceneGraph, id: string): SceneNode | undefined {
  return keptCopiesByGraph.get(graph)?.nodes.get(id)
}

export function keptNodeCount(graph: SceneGraph): number {
  return keptCopiesByGraph.get(graph)?.nodes.size ?? 0
}

export function updateNodeOrKept(graph: SceneGraph, id: string, changes: Partial<SceneNode>): void {
  const kept = graph.nodes.has(id) ? undefined : keptNode(graph, id)
  if (!kept) {
    graph.updateNode(id, changes)
    return
  }
  Object.assign(kept, omitBy(changes, isUndefined))
}

function list(graph: SceneGraph, kept: KeptCopy): void {
  const store = storeOf(graph)
  const byLayer = store.byParent.get(kept.parentId) ?? new Map<string, KeptCopy>()
  store.byParent.set(kept.parentId, byLayer)
  byLayer.set(kept.layerId, kept)
  for (const node of kept.nodes) {
    store.nodes.set(node.id, node)
  }
}

function unlist(graph: SceneGraph, kept: KeptCopy): SceneNode[] {
  const store = storeOf(graph)
  const byLayer = store.byParent.get(kept.parentId)
  byLayer?.delete(kept.layerId)
  if (byLayer?.size === 0) {
    store.byParent.delete(kept.parentId)
  }
  const unlisted = kept.nodes.filter((node) => store.nodes.get(node.id) === node)
  for (const node of unlisted) {
    store.nodes.delete(node.id)
  }
  return unlisted
}

function forgetDormantOverrides(graph: SceneGraph, kept: KeptCopy, gone: SceneNode[]): void {
  for (const ownerId of kept.ownerIds) {
    const owner = graph.nodes.get(ownerId)
    const dormant = gone.filter(
      (node) => !graph.nodes.has(node.id) && owner?.instanceOverrides.descendants.has(node.id)
    )
    if (owner && dormant.length > 0) {
      const instanceOverrides = cloneInstanceOverrideState(owner.instanceOverrides)
      for (const node of dormant) {
        instanceOverrides.descendants.delete(node.id)
      }
      graph.updateNode(owner.id, { instanceOverrides })
    }
  }
}

function release(graph: SceneGraph, kept: KeptCopy): void {
  const gone = unlist(graph, kept)
  for (const node of gone) {
    forgetKeptCopiesIn(graph, node.id)
  }
  forgetDormantOverrides(graph, kept, gone)
}

export function keepCopy(
  graph: SceneGraph,
  layerId: string,
  nodes: SceneNode[],
  ownerIds: string[]
): void {
  const parentId = nodes[0]?.parentId
  if (!parentId) {
    return
  }
  const replaced = keptCopiesByGraph.get(graph)?.byParent.get(parentId)?.get(layerId)
  if (replaced) {
    release(graph, replaced)
  }
  list(graph, { parentId, layerId, nodes, ownerIds })
}

export function takeKeptCopy(
  graph: SceneGraph,
  parentId: string,
  layerId: string
): SceneNode[] | undefined {
  const kept = keptCopiesByGraph.get(graph)?.byParent.get(parentId)?.get(layerId)
  if (!kept) {
    return undefined
  }
  if (kept.nodes.some((node) => graph.nodes.has(node.id))) {
    release(graph, kept)
    return undefined
  }
  unlist(graph, kept)
  return kept.nodes
}

export function forgetKeptCopiesIn(graph: SceneGraph, parentId: string): void {
  const byLayer = keptCopiesByGraph.get(graph)?.byParent.get(parentId)
  for (const kept of byLayer ? [...byLayer.values()] : []) {
    release(graph, kept)
  }
}

function isAttached(graph: SceneGraph, node: SceneNode): boolean {
  for (let current = node; current.parentId;) {
    const parent = graph.nodes.get(current.parentId)
    if (!parent?.childIds.includes(current.id)) {
      return false
    }
    current = parent
  }
  return true
}

function isOutermostDeletion(graph: SceneGraph, id: string): boolean {
  const parentId = graph.nodes.get(id)?.parentId
  const parent = parentId ? graph.nodes.get(parentId) : undefined
  return !parent || isAttached(graph, parent)
}

function forgetDeletion(graph: SceneGraph, parentIds: readonly string[]): void {
  for (const parentId of parentIds) {
    if (!graph.nodes.has(parentId)) {
      forgetKeptCopiesIn(graph, parentId)
    }
  }
}

export function noteDeletedNode(graph: SceneGraph, id: string): void {
  const store = keptCopiesByGraph.get(graph)
  if (!store || store.nodes.has(id)) {
    return
  }
  if (store.byParent.has(id)) {
    store.deleting.push(id)
  }
  if (store.deleting.length === 0 || !isOutermostDeletion(graph, id)) {
    return
  }
  store.deletions.push(store.deleting)
  store.deleting = []
  while (store.deletions.length > DEFAULT_HISTORY_LIMIT) {
    forgetDeletion(graph, store.deletions.shift() ?? [])
  }
}

export function keptCopiesWithin(graph: SceneGraph, nodeIds: Iterable<string>): KeptCopy[] {
  const store = keptCopiesByGraph.get(graph)
  const found: KeptCopy[] = []
  const parents = [...nodeIds]
  for (const parentId of store ? parents : []) {
    for (const kept of store?.byParent.get(parentId)?.values() ?? []) {
      found.push(kept)
      parents.push(...kept.nodes.map((node) => node.id))
    }
  }
  return found
}

export function subtreeIds(graph: SceneGraph, node: SceneNode): string[] {
  return [node.id, ...graph.getChildren(node.id).flatMap((child) => subtreeIds(graph, child))]
}

export function forgetKeptCopiesWithin(graph: SceneGraph, nodeIds: Iterable<string>): void {
  for (const id of nodeIds) {
    forgetKeptCopiesIn(graph, id)
  }
}

export function keepCopiesAgain(graph: SceneGraph, copies: readonly KeptCopy[]): void {
  for (const kept of copies) {
    const parentKnown = graph.nodes.has(kept.parentId) || !!keptNode(graph, kept.parentId)
    if (parentKnown && !kept.nodes.some((node) => graph.nodes.has(node.id))) {
      list(graph, kept)
    }
  }
}

export function dropKeptTargets(
  graph: SceneGraph,
  overrides: InstanceOverrideState | undefined
): void {
  const store = keptCopiesByGraph.get(graph)
  if (!store || !overrides) {
    return
  }
  for (const id of overrides.descendants.keys()) {
    if (store.nodes.has(id)) {
      overrides.descendants.delete(id)
    }
  }
}

function copyStore(store: KeptCopies): KeptCopies {
  return {
    byParent: new Map([...store.byParent].map(([id, byLayer]) => [id, new Map(byLayer)])),
    nodes: new Map(store.nodes),
    deletions: store.deletions.map((deletion) => [...deletion]),
    deleting: [...store.deleting]
  }
}

export function captureKeptCopies(graph: SceneGraph): () => void {
  const store = keptCopiesByGraph.get(graph)
  const saved = store && copyStore(store)
  return () => {
    if (saved) {
      keptCopiesByGraph.set(graph, copyStore(saved))
    } else {
      keptCopiesByGraph.delete(graph)
    }
  }
}
