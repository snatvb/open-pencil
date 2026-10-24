import { partition } from 'es-toolkit/array'

import {
  createVariantLookup,
  instanceVariant,
  variantPropertyDefinition,
  type VariantLookup
} from '../components/variants'
import type { SceneGraph } from '../index'
import { instanceMainComponent } from '../instances/main-component'
import type { ComponentPropertyDefinition, SceneNode } from '../types'
import { createBatchVariableResolver, type BatchVariableResolver } from './resolution'
import {
  boundVariantTarget,
  followOccurrences,
  hasVariantBindings,
  showVariant
} from './variant-bindings'

export interface ReconcileOptions {
  onVariantSwap?: (instanceId: string, reapplied: ComponentPropertyDefinition[]) => void
}

export interface VariantWalk extends ReconcileOptions {
  resolve: BatchVariableResolver
  lookup: VariantLookup
  reconciledInsideSwaps?: Set<string>
  followsSavedLayout?: boolean
}

export type ResolvedValuesUpdate = (node: SceneNode) => boolean

export function createVariantWalk(
  graph: SceneGraph,
  { onVariantSwap }: ReconcileOptions = {}
): VariantWalk {
  return {
    resolve: createBatchVariableResolver(graph),
    lookup: createVariantLookup(graph),
    onVariantSwap
  }
}

export function subtreeNodes(graph: SceneGraph, roots: Iterable<string>): SceneNode[] {
  const nodes: SceneNode[] = []
  const pending = [...roots]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const node = graph.getNode(id)
    if (!node) {
      continue
    }
    nodes.push(node)
    pending.push(...node.childIds)
  }
  return nodes
}

function nodeDepth(graph: SceneGraph, node: SceneNode): number {
  let depth = 0
  for (let id: string | null | undefined = node.parentId; id; id = graph.getNode(id)?.parentId) {
    depth++
  }
  return depth
}

function hasBoundAncestor(graph: SceneGraph, node: SceneNode, boundIds: Set<string>): boolean {
  for (let id: string | null | undefined = node.parentId; id; id = graph.getNode(id)?.parentId) {
    if (boundIds.has(id)) {
      return true
    }
  }
  return false
}

function* withoutVariantBindings(nodes: Iterable<SceneNode>): Iterable<SceneNode> {
  for (const node of nodes) {
    if (!hasVariantBindings(node)) {
      yield node
    }
  }
}

export function boundInstancesFirst(
  graph: SceneGraph,
  scoped: Iterable<SceneNode>
): Iterable<SceneNode> {
  const bound: SceneNode[] = []
  for (const node of scoped) {
    if (hasVariantBindings(node)) {
      bound.push(node)
    }
  }
  if (bound.length === 0) {
    return scoped
  }
  const boundIds = new Set(bound.map((node) => node.id))
  const [outermost, nested] = partition(bound, (node) => !hasBoundAncestor(graph, node, boundIds))
  const nestedAncestorsFirst = nested
    .map((node) => ({ node, depth: nodeDepth(graph, node) }))
    .sort((left, right) => left.depth - right.depth)
    .map(({ node }) => node)
  return [...outermost, ...nestedAncestorsFirst, ...withoutVariantBindings(scoped)]
}

function modeAfterFollow(
  graph: SceneGraph,
  copy: SceneNode,
  layer: SceneNode,
  collectionId: string,
  protectedField: (field: string) => boolean
): string | undefined {
  const ownMode = protectedField('variableModes') || protectedField(`variableModes/${collectionId}`)
  const explicit = (ownMode ? copy : layer).variableModes[collectionId]
  if (explicit) {
    return explicit
  }
  return copy.parentId ? graph.getNodeVariableModeId(copy.parentId, collectionId) : undefined
}

function choiceAfterFollow(
  graph: SceneGraph,
  copy: SceneNode,
  layer: SceneNode,
  lookup: VariantLookup,
  protectedField: (field: string) => boolean
): SceneNode | undefined {
  const shown = instanceVariant(graph, layer)
  if (!shown) {
    return undefined
  }
  const bindings = protectedField('variantBindings') ? copy.variantBindings : layer.variantBindings
  const values = { ...shown.component.componentPropertyValues }
  for (const [key, variableId] of Object.entries(bindings)) {
    const definition = variantPropertyDefinition(shown.set, key)
    const variable = graph.variables.get(variableId)
    const mode =
      variable && modeAfterFollow(graph, copy, layer, variable.collectionId, protectedField)
    const value = variable && mode ? graph.resolveVariable(variableId, mode) : undefined
    if (definition && typeof value === 'string') {
      values[definition.name] = value
    }
  }
  return lookup(shown.set, values) ?? shown.component
}

function swapToBoundVariant(
  graph: SceneGraph,
  node: SceneNode,
  walk: VariantWalk
): SceneNode[] | undefined {
  const variant = boundVariantTarget(graph, node, walk.resolve, walk.lookup)
  if (!variant) {
    return undefined
  }
  const shown = instanceVariant(graph, node)?.component
  const follow = {
    followsSavedLayout: walk.followsSavedLayout,
    keepsBoundVariant: (
      copy: SceneNode,
      layer: SceneNode,
      protectedField: (field: string) => boolean
    ) =>
      choiceAfterFollow(graph, copy, layer, walk.lookup, protectedField)?.id !==
      instanceMainComponent(graph, layer)?.id
  }
  showVariant(graph, node, variant, walk.onVariantSwap, follow)
  const followed = shown
    ? followOccurrences(graph, node, (occurrence) =>
        showVariant(graph, occurrence, shown, walk.onVariantSwap, follow)
      )
    : []
  walk.reconciledInsideSwaps ??= new Set()
  walk.resolve.forgetNodeModes()
  return followed
}

export function walkBoundVariants(
  graph: SceneGraph,
  nodes: Iterable<SceneNode>,
  walk: VariantWalk,
  updateResolvedValues: ResolvedValuesUpdate,
  changed: string[],
  insideSwap = false
): void {
  for (const node of nodes) {
    const reconciled = walk.reconciledInsideSwaps
    if (reconciled && (reconciled.has(node.id) || graph.getNode(node.id) !== node)) {
      continue
    }
    if (insideSwap) {
      reconciled?.add(node.id)
    }
    const followed = swapToBoundVariant(graph, node, walk)
    const updated = updateResolvedValues(node)
    if (followed || updated) {
      changed.push(node.id)
    }
    if (!followed) {
      continue
    }
    const again = (layers: Iterable<SceneNode>): void =>
      walkBoundVariants(graph, layers, walk, updateResolvedValues, changed, true)
    again(subtreeNodes(graph, node.childIds))
    for (const occurrence of followed) {
      changed.push(occurrence.id)
      walk.reconciledInsideSwaps?.delete(occurrence.id)
      again([occurrence])
      again(subtreeNodes(graph, occurrence.childIds))
    }
  }
}

const KEEPS_VALUES: ResolvedValuesUpdate = () => false

export function showBoundVariants(graph: SceneGraph, nodes: Iterable<SceneNode>): string[] {
  const bound = [...nodes].filter(hasVariantBindings)
  if (bound.length === 0) {
    return []
  }
  const changed: string[] = []
  const walk = { ...createVariantWalk(graph), followsSavedLayout: true }
  walkBoundVariants(graph, boundInstancesFirst(graph, bound), walk, KEEPS_VALUES, changed)
  return changed
}
