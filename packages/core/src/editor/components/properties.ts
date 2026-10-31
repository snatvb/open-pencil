import type { ComponentPropertyDefinition, SceneNode } from '@open-pencil/scene-graph'
import {
  applyComponentPropertyValue,
  componentPropertyDefinitions,
  findComponentPropertyTargets,
  reapplyComponentPropertyAssignments,
  recordAssignmentOverride,
  resolveComponentPropertyValue,
  type ComponentPropertyTarget
} from '@open-pencil/scene-graph/components'
import { findInstanceAncestor } from '@open-pencil/scene-graph/instances'
import { cloneInstanceOverrideState } from '@open-pencil/scene-graph/instances/overrides'
import { unbindSwapPropertyTargets } from '@open-pencil/scene-graph/variables'

import { assertNodeEditable } from '#core/editor/capabilities'
import { restoreInstance, snapshotInstance } from '#core/editor/history/subtree'
import type { EditorContext } from '#core/editor/types'
import { measurePropertyText } from '#core/layout/property-text'

function definitionsForInstance(
  ctx: Pick<EditorContext, 'graph'>,
  instance: SceneNode
): ComponentPropertyDefinition[] {
  return componentPropertyDefinitions(ctx.graph, instance)
}

function swapTargetId(ctx: Pick<EditorContext, 'graph'>, value: string): string | null {
  return resolveComponentPropertyValue(ctx.graph, value)?.id ?? null
}

function targetValue(target: ComponentPropertyTarget | null): string {
  if (!target) return ''
  if (target.field === 'TEXT') return target.node.text
  if (target.field === 'VISIBLE') return String(target.node.visible)
  return target.source.componentId ?? target.node.componentId ?? ''
}

function applyPropertyValue(
  ctx: Pick<EditorContext, 'graph'>,
  instanceId: string,
  definition: ComponentPropertyDefinition,
  value: string
): boolean {
  unbindSwapPropertyTargets(ctx.graph, instanceId, definition, value)
  const result = applyComponentPropertyValue(ctx.graph, instanceId, definition, value)
  measurePropertyText(ctx.graph, instanceId, definition)
  return definition.type !== 'INSTANCE_SWAP' || result !== null
}

export function reapplyInstanceComponentProperties(
  ctx: Pick<EditorContext, 'graph'>,
  instanceId: string
): void {
  for (const definition of reapplyComponentPropertyAssignments(ctx.graph, instanceId)) {
    measurePropertyText(ctx.graph, instanceId, definition)
  }
}

export function createComponentPropertyActions(
  ctx: EditorContext,
  switchVariant: (instanceId: string, propertyName: string, newValue: string) => void
) {
  function getInstanceComponentPropertyDefinitions(instanceId: string) {
    const instance = ctx.graph.getNode(instanceId)
    return instance?.type === 'INSTANCE' ? definitionsForInstance(ctx, instance) : []
  }

  function getInstanceComponentPropertyValue(
    instanceId: string,
    definition: ComponentPropertyDefinition
  ): string {
    const instance = ctx.graph.getNode(instanceId)
    if (instance?.type !== 'INSTANCE') return definition.defaultValue
    if (definition.type === 'VARIANT') {
      const component = instance.componentId ? ctx.graph.getNode(instance.componentId) : null
      return component?.componentPropertyValues[definition.name] ?? definition.defaultValue
    }
    const value = instance.componentPropertyAssignments[definition.id] ?? definition.defaultValue
    return definition.type === 'INSTANCE_SWAP' ? (swapTargetId(ctx, value) ?? value) : value
  }

  function restoreTarget(target: ComponentPropertyTarget, value: string) {
    if (target.field === 'TEXT' && target.node.type === 'TEXT') {
      ctx.graph.updateNode(target.node.id, { text: value })
    } else if (target.field === 'VISIBLE') {
      ctx.graph.updateNode(target.node.id, { visible: value === 'true' })
    }
  }

  function setInstanceComponentProperty(instanceId: string, propertyId: string, value: string) {
    const instance = ctx.graph.getNode(instanceId)
    if (instance?.type !== 'INSTANCE') return
    assertNodeEditable(ctx.graph, instanceId)
    const definition = definitionsForInstance(ctx, instance).find((item) => item.id === propertyId)
    if (!definition) return
    if (definition.type === 'VARIANT') {
      switchVariant(instanceId, definition.name, value)
      return
    }

    const previousAssignments = { ...instance.componentPropertyAssignments }
    const previousOverrides = cloneInstanceOverrideState(instance.instanceOverrides)
    const owner = instance.parentId ? findInstanceAncestor(ctx.graph, instance.parentId) : undefined
    const previousOwnerOverrides = owner && cloneInstanceOverrideState(owner.instanceOverrides)

    // A property can drive several layers; undo restores each one to what it showed.
    const targets = findComponentPropertyTargets(ctx.graph, instance, propertyId)
    const previousValues = targets.map(targetValue)
    const swappedLayers =
      definition.type === 'INSTANCE_SWAP'
        ? targets.map(({ node }) => snapshotInstance(ctx.graph, node.id))
        : []

    if (!applyPropertyValue(ctx, instanceId, definition, value)) return
    recordAssignmentOverride(ctx.graph, instanceId, propertyId)
    ctx.runLayoutForNode(instanceId)
    ctx.undo.push({
      label: `Change ${definition.name}`,
      forward: () => {
        applyPropertyValue(ctx, instanceId, definition, value)
        recordAssignmentOverride(ctx.graph, instanceId, propertyId)
        ctx.runLayoutForNode(instanceId)
        ctx.requestRender()
      },
      inverse: () => {
        const live = ctx.graph.getNode(instanceId)
        if (live) {
          const restoredTargets = findComponentPropertyTargets(ctx.graph, live, propertyId)
          ctx.graph.updateNode(instanceId, {
            componentPropertyAssignments: previousAssignments,
            instanceOverrides: cloneInstanceOverrideState(previousOverrides)
          })
          if (owner && previousOwnerOverrides) {
            ctx.graph.updateNode(owner.id, {
              instanceOverrides: cloneInstanceOverrideState(previousOwnerOverrides)
            })
          }
          restoredTargets.forEach((target, index) =>
            restoreTarget(target, previousValues[index] ?? '')
          )
          for (const layer of swappedLayers) {
            restoreInstance(ctx.graph, layer)
          }
          measurePropertyText(ctx.graph, instanceId, definition)
          ctx.runLayoutForNode(instanceId)
        }
        ctx.requestRender()
      }
    })
    ctx.requestRender()
  }

  return {
    getInstanceComponentPropertyDefinitions,
    getInstanceComponentPropertyValue,
    reapplyInstanceComponentProperties: (instanceId: string) =>
      reapplyInstanceComponentProperties(ctx, instanceId),
    setInstanceComponentProperty
  }
}
