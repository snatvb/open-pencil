import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { findInstanceAncestor } from '@open-pencil/scene-graph/instances'
import {
  deleteInstanceOverride,
  getInstanceOverride,
  setInstanceOverride
} from '@open-pencil/scene-graph/instances/overrides'

import { findLibraryDefinition } from '#core/library/definitions'
import { diffLibraryManifests } from '#core/library/diff'
import type {
  ComponentLibraryRevision,
  LibraryAssetChange,
  LibraryAssetDescriptor
} from '#core/library/types'
import { assetComponent, assetComponents } from '#core/library/variants'

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

    const previousComponents = assetComponents(graph, previousRoot)
    for (const previousComponent of previousComponents) {
      const target = assetComponent(graph, nextRoot, previousComponent)
      if (!target) continue
      for (const instance of graph.getInstances(previousComponent.id)) {
        const previousSaved = savedComponentOf(graph, instance)
        const saved = previousComponents.find((component) => component.id === previousSaved)
        const savedTarget = saved ? assetComponent(graph, nextRoot, saved) : undefined
        updates.push({
          instanceId: instance.id,
          previousComponentId: previousComponent.id,
          componentId: target.component.id,
          previousSavedComponentId: previousSaved,
          savedComponentId: savedTarget && !savedTarget.fallback ? savedTarget.component.id : null,
          fallback: target.fallback
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
