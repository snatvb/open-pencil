import { partition } from 'es-toolkit/array'

import {
  findComponentPropertyTargets,
  reapplyComponentPropertyAssignments,
  resolveComponentPropertyValue
} from '../components/properties'
import {
  instanceVariant,
  variantPropertyDefinition,
  type VariantLookup
} from '../components/variants'
import type { SceneGraph } from '../graph'
import { findInstanceAncestor, getInstances, type SwapInstanceOptions } from '../instances'
import { instanceMainComponent } from '../instances/main-component'
import {
  getInstanceOverride,
  hasInstanceOverride,
  setInstanceOverride
} from '../instances/overrides'
import type { ComponentPropertyDefinition, SceneNode } from '../types'
import type { NodeVariableResolver } from './resolution'

export function hasVariantBindings(node: SceneNode): boolean {
  if (node.type !== 'INSTANCE') {
    return false
  }
  for (const key in node.variantBindings) {
    if (Object.hasOwn(node.variantBindings, key)) {
      return true
    }
  }
  return false
}

export function boundVariantTarget(
  graph: SceneGraph,
  node: SceneNode,
  resolve: NodeVariableResolver,
  lookup: VariantLookup
): SceneNode | undefined {
  if (!hasVariantBindings(node)) {
    return undefined
  }
  const variant = instanceVariant(graph, node)
  if (!variant) {
    return undefined
  }
  const shown = variant.component.componentPropertyValues
  let values: Record<string, string> | undefined
  for (const [key, variableId] of Object.entries(node.variantBindings)) {
    const definition = variantPropertyDefinition(variant.set, key)
    const value = resolve(node.id, variableId)
    if (definition && typeof value === 'string' && shown[definition.name] !== value) {
      values ??= { ...shown }
      values[definition.name] = value
    }
  }
  if (!values) {
    return undefined
  }
  const target = lookup(variant.set, values)
  return target && target.id !== variant.component.id ? target : undefined
}

function placedComponentOf(
  graph: SceneGraph,
  owner: SceneNode,
  instance: SceneNode
): string | undefined {
  const source = getInstanceOverride(
    owner.instanceOverrides,
    owner.id,
    instance.id,
    'sourceComponentId'
  )
  const layer = typeof source === 'string' ? graph.getNode(source) : undefined
  return layer?.type === 'INSTANCE' ? instanceMainComponent(graph, layer)?.id : layer?.id
}

function pinShownVariant(graph: SceneGraph, owner: SceneNode, instance: SceneNode): void {
  const shown = instanceMainComponent(graph, instance)?.id
  const claimed = getInstanceOverride(owner.instanceOverrides, owner.id, instance.id, 'componentId')
  const placed = claimed ?? placedComponentOf(graph, owner, instance) ?? shown
  if (shown && placed !== shown) {
    setInstanceOverride(owner.instanceOverrides, owner.id, instance.id, 'componentId', shown)
  }
}

export function savedVariantUnderBinding(
  graph: SceneGraph,
  node: SceneNode,
  savedId: unknown
): SceneNode | undefined {
  const saved = typeof savedId === 'string' ? graph.getNode(savedId) : undefined
  if (saved?.type !== 'COMPONENT' || !hasVariantBindings(node)) {
    return undefined
  }
  const shown = instanceMainComponent(graph, node)
  if (!shown || saved.id === shown.id || !sharesVariantSet(graph, saved, shown)) {
    return undefined
  }
  return saved
}

function sharesVariantSet(graph: SceneGraph, saved: SceneNode, shown: SceneNode): boolean {
  const set = saved.parentId ? graph.getNode(saved.parentId) : undefined
  return set?.type === 'COMPONENT_SET' && shown.parentId === set.id
}

export function savedVariantIds(node: SceneNode): string[] {
  const ids = node.source.fig.savedComponentId ? [node.source.fig.savedComponentId] : []
  for (const fields of node.instanceOverrides.descendants.values()) {
    const claimed = fields.get('componentId')
    if (typeof claimed === 'string') {
      ids.push(claimed)
    }
  }
  return ids
}

function withoutSavedComponent(instance: SceneNode): Partial<SceneNode> {
  if (!instance.source.fig.savedComponentId) {
    return {}
  }
  return { source: { ...instance.source, fig: { ...instance.source.fig, savedComponentId: null } } }
}

function instanceOwner(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  return node.parentId ? findInstanceAncestor(graph, node.parentId) : undefined
}

function unbindVariantProperties(
  graph: SceneGraph,
  instance: SceneNode,
  unbinds: (key: string) => boolean
): boolean {
  const kept = Object.fromEntries(
    Object.entries(instance.variantBindings).filter(([key]) => !unbinds(key))
  )
  if (Object.keys(kept).length === Object.keys(instance.variantBindings).length) {
    return false
  }
  const owner = instanceOwner(graph, instance)
  graph.updateNode(instance.id, {
    variantBindings: kept,
    ...(owner ? {} : withoutSavedComponent(instance))
  })
  if (owner) {
    graph.willChangeNode(owner)
    setInstanceOverride(owner.instanceOverrides, owner.id, instance.id, 'variantBindings')
    pinShownVariant(graph, owner, instance)
    graph.updateNode(owner.id, { instanceOverrides: owner.instanceOverrides })
  }
  return true
}

export function unbindVariantProperty(
  graph: SceneGraph,
  instanceId: string,
  propertyName: string
): boolean {
  const instance = graph.getNode(instanceId)
  const variant = instance ? instanceVariant(graph, instance) : undefined
  if (!instance || !variant) {
    return false
  }
  return unbindVariantProperties(
    graph,
    instance,
    (key) => variantPropertyDefinition(variant.set, key)?.name === propertyName
  )
}

export function unbindVariantsForSwap(graph: SceneGraph, instanceId: string): boolean {
  const instance = graph.getNode(instanceId)
  return !!instance && unbindVariantProperties(graph, instance, () => true)
}

export function unbindRemovedVariables(graph: SceneGraph, variableIds: ReadonlySet<string>): void {
  const removed = (variableId: string | undefined) => !!variableId && variableIds.has(variableId)
  const bound = [...graph.nodes.values()].filter((node) =>
    Object.values(node.variantBindings).some(removed)
  )
  const [nested, declared] = partition(bound, (node) => !!instanceOwner(graph, node))
  for (const node of [...declared, ...nested]) {
    unbindVariantProperties(graph, node, (key) => removed(node.variantBindings[key]))
  }
}

export function unbindSwapPropertyTargets(
  graph: SceneGraph,
  instanceId: string,
  definition: ComponentPropertyDefinition,
  value: string
): void {
  const instance = graph.getNode(instanceId)
  const component = resolveComponentPropertyValue(graph, value)
  if (!instance || !component || definition.type !== 'INSTANCE_SWAP') {
    return
  }
  for (const target of findComponentPropertyTargets(graph, instance, definition.id)) {
    if (target.field === 'INSTANCE_SWAP') {
      unbindVariantsForSwap(graph, target.node.id)
    }
  }
}

export function followOccurrences(
  graph: SceneGraph,
  source: SceneNode,
  show: (occurrence: SceneNode) => void
): SceneNode[] {
  const followed: SceneNode[] = []
  for (const occurrence of getInstances(graph, source.id)) {
    const owner = occurrence.parentId ? findInstanceAncestor(graph, occurrence.parentId) : undefined
    const swapped =
      !!owner &&
      hasInstanceOverride(owner.instanceOverrides, owner.id, occurrence.id, 'componentId')
    if (owner && occurrence.id !== source.id && !swapped) {
      show(occurrence)
      followed.push(occurrence, ...followOccurrences(graph, occurrence, show))
    }
  }
  return followed
}

export function showVariant(
  graph: SceneGraph,
  node: SceneNode,
  variant: SceneNode,
  onVariantSwap?: (instanceId: string, reapplied: ComponentPropertyDefinition[]) => void,
  follow: Pick<SwapInstanceOptions, 'keepsBoundVariant' | 'followsSavedLayout'> = {}
): void {
  graph.swapInstanceComponent(node.id, variant.id, { ...follow, authored: false, keepName: true })
  const reapplied = reapplyComponentPropertyAssignments(graph, node.id)
  onVariantSwap?.(node.id, reapplied)
}
