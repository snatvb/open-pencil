import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { findInstanceAncestor } from '@open-pencil/scene-graph/instances'
import {
  deleteInstanceOverride,
  getInstanceOverride,
  setInstanceOverride
} from '@open-pencil/scene-graph/instances/overrides'

import { findLibraryDefinition } from './definitions'
import { diffLibraryManifests } from './diff'
import type { ComponentLibraryRevision, LibraryAssetChange, LibraryAssetDescriptor } from './types'

export interface LibraryUpdateSummary {
  libraryId: string
  currentRevisionId: string
  latestRevisionId: string
  changes: LibraryAssetChange[]
}

export interface LibraryUpdateImpact {
  affectedInstanceCount: number
  fallbackInstanceCount: number
}

export interface LibraryInstanceUpdate {
  instanceId: string
  previousComponentId: string
  componentId: string
  previousSavedComponentId: string | null
  savedComponentId: string | null
  fallback: boolean
}

function componentsForRoot(graph: SceneGraph, root: SceneNode): SceneNode[] {
  if (root.type === 'COMPONENT') return [root]
  if (root.type !== 'COMPONENT_SET') return []
  return root.childIds.flatMap((id) => {
    const child = graph.getNode(id)
    return child?.type === 'COMPONENT' ? [child] : []
  })
}

function sameVariant(left: SceneNode, right: SceneNode): boolean {
  const leftEntries = Object.entries(left.componentPropertyValues)
  return (
    leftEntries.length === Object.keys(right.componentPropertyValues).length &&
    leftEntries.every(([name, value]) => right.componentPropertyValues[name] === value)
  )
}

function counterpartOf(previous: SceneNode, next: SceneNode[]): SceneNode | undefined {
  return next.find((component) => sameVariant(previous, component))
}

function topLeft(components: SceneNode[]): SceneNode | undefined {
  return [...components].sort(
    (left, right) => left.y - right.y || left.x - right.x || left.name.localeCompare(right.name)
  )[0]
}

export function summarizeLibraryUpdate(
  current: ComponentLibraryRevision,
  latest: ComponentLibraryRevision
): LibraryUpdateSummary | null {
  if (current.manifest.libraryId !== latest.manifest.libraryId) {
    throw new Error('Cannot compare revisions from different libraries')
  }
  if (current.manifest.revisionId === latest.manifest.revisionId) return null
  return {
    libraryId: current.manifest.libraryId,
    currentRevisionId: current.manifest.revisionId,
    latestRevisionId: latest.manifest.revisionId,
    changes: diffLibraryManifests(current.manifest, latest.manifest)
  }
}

export function libraryUpdateImpact(updates: LibraryInstanceUpdate[]): LibraryUpdateImpact {
  return {
    affectedInstanceCount: updates.length,
    fallbackInstanceCount: updates.filter((update) => update.fallback).length
  }
}

export function planLibraryInstanceUpdates(
  graph: SceneGraph,
  libraryId: string,
  previousRevisionId: string,
  nextRevisionId: string,
  descriptors: LibraryAssetDescriptor[]
): LibraryInstanceUpdate[] {
  const updates: LibraryInstanceUpdate[] = []
  for (const descriptor of descriptors) {
    const previousRoot = findLibraryDefinition(graph, libraryId, descriptor.key, previousRevisionId)
    const nextRoot = findLibraryDefinition(graph, libraryId, descriptor.key, nextRevisionId)
    if (!previousRoot || !nextRoot) continue
    const previousComponents = componentsForRoot(graph, previousRoot)
    const nextComponents = componentsForRoot(graph, nextRoot)
    const fallback = topLeft(nextComponents)
    if (!fallback) continue

    for (const previousComponent of previousComponents) {
      const target = counterpartOf(previousComponent, nextComponents) ?? fallback
      for (const instance of graph.getInstances(previousComponent.id)) {
        const previousSaved = savedComponentOf(graph, instance)
        const saved = previousComponents.find((component) => component.id === previousSaved)
        updates.push({
          instanceId: instance.id,
          previousComponentId: previousComponent.id,
          componentId: target.id,
          previousSavedComponentId: previousSaved,
          savedComponentId: saved ? (counterpartOf(saved, nextComponents)?.id ?? null) : null,
          fallback: !sameVariant(previousComponent, target)
        })
      }
    }
  }
  return updates
}

export function savedComponentOf(graph: SceneGraph, instance: SceneNode): string | null {
  const owner = instance.parentId ? findInstanceAncestor(graph, instance.parentId) : undefined
  if (!owner) {
    return instance.source.fig.savedComponentId ?? null
  }
  const claimed = getInstanceOverride(owner.instanceOverrides, owner.id, instance.id, 'componentId')
  return typeof claimed === 'string' ? claimed : null
}

export function showLibraryComponent(
  graph: SceneGraph,
  instanceId: string,
  componentId: string,
  savedComponentId: string | null
): void {
  const instance = graph.getNode(instanceId)
  const owner = instance?.parentId ? findInstanceAncestor(graph, instance.parentId) : undefined
  if (owner) {
    graph.swapInstanceComponent(instanceId, componentId, { authored: false })
    claimNestedComponent(graph, owner, instanceId, savedComponentId)
    return
  }
  graph.swapInstanceComponent(instanceId, componentId)
  const swapped = graph.getNode(instanceId)
  if (!swapped || (swapped.source.fig.savedComponentId ?? null) === savedComponentId) {
    return
  }
  graph.updateNode(instanceId, {
    source: { ...swapped.source, fig: { ...swapped.source.fig, savedComponentId } }
  })
}

function claimNestedComponent(
  graph: SceneGraph,
  owner: SceneNode,
  instanceId: string,
  componentId: string | null
): void {
  const claimed = getInstanceOverride(owner.instanceOverrides, owner.id, instanceId, 'componentId')
  if ((claimed ?? null) === componentId) {
    return
  }
  graph.willChangeNode(owner)
  if (componentId) {
    setInstanceOverride(owner.instanceOverrides, owner.id, instanceId, 'componentId', componentId)
  } else {
    deleteInstanceOverride(owner.instanceOverrides, owner.id, instanceId, 'componentId')
  }
  graph.updateNode(owner.id, { instanceOverrides: owner.instanceOverrides })
}
