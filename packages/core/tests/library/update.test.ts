import { describe, expect, test } from 'bun:test'

import {
  createLibraryRevision,
  libraryUpdateImpact,
  materializeLibraryAsset,
  planLibraryInstanceUpdates,
  showLibraryComponent,
  summarizeLibraryUpdate
} from '@open-pencil/core/library'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'

import { reconcileVariableLayouts } from '#core/layout/variables'

function revisionGraph(label: string, includeLarge = true) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected page')
  const set = graph.createNode('COMPONENT_SET', page.id, {
    name: 'Button',
    componentKey: 'button-set',
    componentPropertyDefinitions: [
      {
        id: 'size',
        name: 'Size',
        type: 'VARIANT',
        defaultValue: 'Small',
        variantOptions: includeLarge ? ['Small', 'Large'] : ['Small']
      }
    ]
  })
  const small = graph.createNode('COMPONENT', set.id, {
    name: 'Size=Small',
    componentKey: 'button-small',
    componentPropertyValues: { Size: 'Small' }
  })
  graph.createNode('TEXT', small.id, { name: 'Label', text: label })
  if (includeLarge) {
    const large = graph.createNode('COMPONENT', set.id, {
      name: 'Size=Large',
      componentKey: 'button-large',
      componentPropertyValues: { Size: 'Large' }
    })
    graph.createNode('TEXT', large.id, { name: 'Label', text: label })
  }
  return graph
}

function variantOf(graph: SceneGraph, setId: string | null | undefined, size: string): SceneNode {
  const variant = graph
    .getChildren(setId ?? '')
    .find((node) => node.componentPropertyValues.Size === size)
  if (!variant) throw new Error(`Expected ${size} variant`)
  return variant
}

describe('library updates', () => {
  test('summarizes newer revisions and plans exact variant updates', async () => {
    const first = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('Old'),
      publishedAt: '2026-01-01T00:00:00.000Z'
    })
    const next = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('New'),
      previousRevisionId: first.manifest.revisionId,
      publishedAt: '2026-01-02T00:00:00.000Z'
    })
    expect(summarizeLibraryUpdate(first, next)).toMatchObject({
      currentRevisionId: first.manifest.revisionId,
      latestRevisionId: next.manifest.revisionId,
      changes: [{ kind: 'modified' }]
    })

    const consumer = new SceneGraph()
    const oldAsset = materializeLibraryAsset(consumer, first, 'button-set')
    const oldSet = consumer.getNode(oldAsset.componentSetId ?? '')
    const oldLarge = oldSet?.childIds
      .map((id) => consumer.getNode(id))
      .find((node) => node?.componentPropertyValues.Size === 'Large')
    if (!oldLarge) throw new Error('Expected old large variant')
    const instance = consumer.createInstance(oldLarge.id, consumer.getPages()[0]?.id ?? '')
    if (!instance) throw new Error('Expected instance')
    materializeLibraryAsset(consumer, next, 'button-set')

    const plans = planLibraryInstanceUpdates(
      consumer,
      'design-system',
      first.manifest.revisionId,
      next.manifest.revisionId,
      next.manifest.assets
    )
    expect(plans).toHaveLength(1)
    expect(consumer.getNode(plans[0]?.componentId ?? '')?.componentPropertyValues).toEqual({
      Size: 'Large'
    })
    expect(plans[0]?.fallback).toBe(false)
    expect(libraryUpdateImpact(plans)).toEqual({
      affectedInstanceCount: 1,
      fallbackInstanceCount: 0
    })
  })

  test('falls back to the new top-left variant when a combination was removed', async () => {
    const first = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('Old')
    })
    const next = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('New', false),
      previousRevisionId: first.manifest.revisionId
    })
    const consumer = new SceneGraph()
    const oldAsset = materializeLibraryAsset(consumer, first, 'button-set')
    const oldSet = consumer.getNode(oldAsset.componentSetId ?? '')
    const oldLarge = oldSet?.childIds
      .map((id) => consumer.getNode(id))
      .find((node) => node?.componentPropertyValues.Size === 'Large')
    if (!oldLarge) throw new Error('Expected old large variant')
    consumer.createInstance(oldLarge.id, consumer.getPages()[0]?.id ?? '')
    materializeLibraryAsset(consumer, next, 'button-set')

    const plans = planLibraryInstanceUpdates(
      consumer,
      'design-system',
      first.manifest.revisionId,
      next.manifest.revisionId,
      next.manifest.assets
    )
    expect(plans).toHaveLength(1)
    expect(plans[0]?.fallback).toBe(true)
    expect(libraryUpdateImpact(plans)).toEqual({
      affectedInstanceCount: 1,
      fallbackInstanceCount: 1
    })
    expect(consumer.getNode(plans[0]?.componentId ?? '')?.componentPropertyValues).toEqual({
      Size: 'Small'
    })
  })

  test('keeps the variant a bound instance saves, and undo brings the old one back', async () => {
    const first = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('Old')
    })
    const next = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('New'),
      previousRevisionId: first.manifest.revisionId
    })
    const consumer = new SceneGraph()
    const collection = consumer.createCollection('Density')
    const size = consumer.createVariable('Size', 'STRING', collection.id, 'Large')
    const oldSetId = materializeLibraryAsset(consumer, first, 'button-set').componentSetId
    const oldSmall = variantOf(consumer, oldSetId, 'Small')
    const instance = consumer.createInstance(oldSmall.id, consumer.getPages()[0]?.id ?? '', {
      variantBindings: { size: size.id }
    })
    if (!instance) throw new Error('Expected instance')
    consumer.swapInstanceComponent(instance.id, variantOf(consumer, oldSetId, 'Large').id, {
      authored: false
    })
    const newSetId = materializeLibraryAsset(consumer, next, 'button-set').componentSetId
    const plans = planLibraryInstanceUpdates(
      consumer,
      'design-system',
      first.manifest.revisionId,
      next.manifest.revisionId,
      next.manifest.assets
    )
    for (const plan of plans) {
      showLibraryComponent(consumer, plan.instanceId, plan.componentId, plan.savedComponentId)
    }
    const updated = consumer.getNode(instance.id)

    expect(updated?.componentId).toBe(variantOf(consumer, newSetId, 'Large').id)
    expect(updated?.source.fig.savedComponentId).toBe(variantOf(consumer, newSetId, 'Small').id)
    expect(updated?.variantBindings).toEqual({ size: size.id })

    for (const plan of plans) {
      showLibraryComponent(
        consumer,
        plan.instanceId,
        plan.previousComponentId,
        plan.previousSavedComponentId
      )
    }

    expect(consumer.getNode(instance.id)?.source.fig.savedComponentId).toBe(oldSmall.id)
  })

  test('moves a nested copy that shows a bound variant without claiming it', async () => {
    const first = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('Old')
    })
    const next = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: revisionGraph('New'),
      previousRevisionId: first.manifest.revisionId
    })
    const consumer = new SceneGraph()
    const pageId = consumer.getPages()[0]?.id ?? ''
    const collection = consumer.createCollection('Density')
    const roomy = consumer.createMode(collection.id, 'Roomy') ?? ''
    const size = consumer.createVariable('Size', 'STRING', collection.id, 'Small')
    size.valuesByMode[roomy] = 'Large'
    const oldSetId = materializeLibraryAsset(consumer, first, 'button-set').componentSetId
    const panel = consumer.createNode('COMPONENT', pageId, { name: 'Panel' })
    consumer.createInstance(variantOf(consumer, oldSetId, 'Small').id, panel.id, {
      variantBindings: { size: size.id }
    })
    const host = consumer.createNode('FRAME', pageId, {
      variableModes: { [collection.id]: roomy }
    })
    const occurrence = consumer.createInstance(panel.id, host.id)
    if (!occurrence) throw new Error('Expected occurrence')
    reconcileVariableLayouts(consumer, { subtrees: [host.id] })
    const newSetId = materializeLibraryAsset(consumer, next, 'button-set').componentSetId
    for (const plan of planLibraryInstanceUpdates(
      consumer,
      'design-system',
      first.manifest.revisionId,
      next.manifest.revisionId,
      next.manifest.assets
    )) {
      showLibraryComponent(consumer, plan.instanceId, plan.componentId, plan.savedComponentId)
    }
    const copy = consumer.getChildren(occurrence.id)[0]

    expect(instanceMainComponent(consumer, copy)?.id).toBe(
      variantOf(consumer, newSetId, 'Large').id
    )
    expect(occurrence.instanceOverrides.descendants.get(copy.id)?.has('componentId')).toBeFalsy()
  })
})
