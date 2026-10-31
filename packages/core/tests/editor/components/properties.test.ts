import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor } from '@open-pencil/core'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { parseFigBuffer } from '@open-pencil/fig'
import { symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'

import { releaseFigArchive } from '#core/kiwi/fig/session/archive/access'
import { reconcileVariableLayouts } from '#core/layout/variables'

function childByName(editor: ReturnType<typeof createEditor>, parentId: string, name: string) {
  return editor.graph.getChildren(parentId).find((node) => node.name === name)
}

function setupComponentProperties() {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const iconA = editor.graph.createNode('COMPONENT', pageId, { name: 'Icon A' })
  editor.graph.createNode('RECTANGLE', iconA.id, { name: 'A shape' })
  const iconB = editor.graph.createNode('COMPONENT', pageId, { name: 'Icon B' })
  editor.graph.createNode('ELLIPSE', iconB.id, { name: 'B shape' })
  const component = editor.graph.createNode('COMPONENT', pageId, {
    name: 'Card',
    componentPropertyDefinitions: [
      { id: '10:1', name: 'Label', type: 'TEXT', defaultValue: 'Default' },
      { id: '10:2', name: 'Show icon', type: 'BOOLEAN', defaultValue: 'true' },
      { id: '10:3', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: iconA.id }
    ]
  })
  editor.graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Default',
    componentPropertyReferences: [{ propertyId: '10:1', field: 'TEXT' }]
  })
  editor.graph.createNode('FRAME', component.id, {
    name: 'Badge',
    componentPropertyReferences: [{ propertyId: '10:2', field: 'VISIBLE' }]
  })
  const sourceIcon = editor.graph.createInstance(iconA.id, component.id, { name: 'Icon' })
  if (!sourceIcon) throw new Error('Expected nested source instance')
  editor.graph.updateNode(sourceIcon.id, {
    componentPropertyReferences: [{ propertyId: '10:3', field: 'INSTANCE_SWAP' }]
  })
  const instance = editor.graph.createInstance(component.id, pageId)
  if (!instance) throw new Error('Expected card instance')
  return { editor, component, instance, iconA, iconB }
}

describe('component property actions', () => {
  test('a layer a boolean property hides leaves its group, which refits, and undo restores it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const component = editor.graph.createNode('COMPONENT', pageId, {
      name: 'Card',
      width: 200,
      height: 200,
      componentPropertyDefinitions: [
        { id: '10:2', name: 'Show icon', type: 'BOOLEAN', defaultValue: 'true' }
      ]
    })
    const group = editor.graph.createNode('GROUP', component.id, {
      name: 'Content',
      width: 130,
      height: 130
    })
    editor.graph.createNode('RECTANGLE', group.id, { name: 'Body', width: 50, height: 50 })
    editor.graph.createNode('RECTANGLE', group.id, {
      name: 'Icon',
      x: 100,
      y: 100,
      width: 30,
      height: 30,
      componentPropertyReferences: [{ propertyId: '10:2', field: 'VISIBLE' }]
    })
    const instance = editor.graph.createInstance(component.id, pageId)
    if (!instance) throw new Error('Expected card instance')
    const content = childByName(editor, instance.id, 'Content')
    const icon = content && childByName(editor, content.id, 'Icon')
    if (!content || !icon) throw new Error('Expected group copy')
    const size = () => {
      const node = editor.graph.getNode(content.id)
      return [node?.width, node?.height]
    }

    editor.toggleNodeVisibility(icon.id)
    expect(size()).toEqual([50, 50])
    editor.undo.undo()
    expect(size()).toEqual([130, 130])

    editor.updateNodeWithUndo(icon.id, { visible: false }, 'Hide')
    expect(size()).toEqual([50, 50])
    editor.undo.undo()
    expect(size()).toEqual([130, 130])
  })

  test('hiding a layer a boolean property shows sets the property, as Figma does', () => {
    const { editor, component, instance } = setupComponentProperties()
    editor.graph.createNode('FRAME', component.id, {
      name: 'Dot',
      componentPropertyReferences: [{ propertyId: '10:2', field: 'VISIBLE' }]
    })
    editor.graph.syncInstance(instance.id)
    const badge = childByName(editor, instance.id, 'Badge')
    if (!badge) throw new Error('Expected badge copy')

    editor.updateNodeWithUndo(badge.id, { visible: false }, 'Hide')
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:2']).toBe('false')
    // Every layer the property drives follows it.
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(false)

    editor.undo.undo()
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:2']).toBeUndefined()
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(true)
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(true)

    editor.toggleNodeVisibility(badge.id)
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:2']).toBe('false')
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(false)
    editor.undo.undo()
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(true)
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(true)

    // A layer showing what its property does not still sets the property when shown again.
    editor.updateNodeWithUndo(badge.id, { visible: false }, 'Hide')
    editor.updateNode(badge.id, { visible: true })
    editor.updateNodeWithUndo(badge.id, { visible: true }, 'Show')
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:2']).toBe('true')
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(true)

    // Layers the property drives together, selected together, set it once.
    const dot = childByName(editor, instance.id, 'Dot')
    editor.select([badge.id, dot?.id ?? ''])
    editor.toggleVisibility()
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:2']).toBe('false')
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(false)
    expect(childByName(editor, instance.id, 'Dot')?.visible).toBe(false)
  })

  test('applies and undoes text, boolean, and instance-swap properties', () => {
    const { editor, instance, iconA, iconB } = setupComponentProperties()

    editor.setInstanceComponentProperty(instance.id, '10:1', 'Changed')
    expect(childByName(editor, instance.id, 'Label')?.text).toBe('Changed')
    expect(editor.graph.getNode(instance.id)?.componentPropertyAssignments['10:1']).toBe('Changed')
    editor.undo.undo()
    expect(childByName(editor, instance.id, 'Label')?.text).toBe('Default')

    editor.setInstanceComponentProperty(instance.id, '10:2', 'false')
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(false)
    editor.undo.undo()
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(true)

    editor.setInstanceComponentProperty(instance.id, '10:3', iconB.id)
    const swapped = childByName(editor, instance.id, 'Icon B')
    expect(swapped?.componentId).toBe(iconB.id)
    expect(swapped?.childIds.map((id) => editor.graph.getNode(id)?.name)).toEqual(['B shape'])
    editor.setInstanceComponentProperty(instance.id, '10:3', iconA.id)
    editor.undo.undo()
    expect(childByName(editor, instance.id, 'Icon B')?.componentId).toBe(iconB.id)
    editor.undo.undo()
    const restored = expectDefined(childByName(editor, instance.id, 'Icon'))
    expect(instanceMainComponent(editor.graph, restored)?.id).toBe(iconA.id)
    editor.undo.redo()
    expect(childByName(editor, instance.id, 'Icon B')?.componentId).toBe(iconB.id)
    editor.undo.undo()
    const again = expectDefined(childByName(editor, instance.id, 'Icon'))
    expect(instanceMainComponent(editor.graph, again)?.id).toBe(iconA.id)
    expect(restored.childIds.map((id) => editor.graph.getNode(id)?.name)).toEqual(['A shape'])
  })

  test('preserves assignments when the main component synchronizes', () => {
    const { editor, component, instance, iconB } = setupComponentProperties()
    editor.setInstanceComponentProperty(instance.id, '10:1', 'Custom')
    editor.setInstanceComponentProperty(instance.id, '10:2', 'false')
    editor.setInstanceComponentProperty(instance.id, '10:3', iconB.id)

    const sourceLabel = childByName(editor, component.id, 'Label')
    if (!sourceLabel) throw new Error('Expected source label')
    editor.graph.updateNode(sourceLabel.id, { text: 'Updated default' })
    editor.graph.syncInstances(component.id)

    expect(childByName(editor, instance.id, 'Label')?.text).toBe('Custom')
    expect(childByName(editor, instance.id, 'Badge')?.visible).toBe(false)
    const nestedInstances = editor.graph
      .getChildren(instance.id)
      .filter((node) => node.type === 'INSTANCE')
    expect(nestedInstances).toHaveLength(1)
    expect(nestedInstances[0].name).toBe('Icon B')
    expect(nestedInstances[0].childIds.map((id) => editor.graph.getNode(id)?.name)).toEqual([
      'B shape'
    ])
  })

  test('reapplies non-variant assignments after variant swaps and undo', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const componentSet = editor.graph.createNode('COMPONENT_SET', pageId, {
      componentPropertyDefinitions: [
        { id: '20:1', name: 'State', type: 'VARIANT', defaultValue: 'A' },
        { id: '20:2', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
      ]
    })
    const variantA = editor.graph.createNode('COMPONENT', componentSet.id, {
      name: 'State=A',
      componentPropertyValues: { State: 'A' }
    })
    editor.graph.createNode('TEXT', variantA.id, {
      name: 'Label',
      text: 'A default',
      componentPropertyReferences: [{ propertyId: '20:2', field: 'TEXT' }]
    })
    const variantB = editor.graph.createNode('COMPONENT', componentSet.id, {
      name: 'State=B',
      componentPropertyValues: { State: 'B' }
    })
    editor.graph.createNode('TEXT', variantB.id, {
      name: 'Label',
      text: 'B default',
      componentPropertyReferences: [{ propertyId: '20:2', field: 'TEXT' }]
    })
    const instance = editor.graph.createInstance(variantA.id, pageId)
    if (!instance) throw new Error('Expected variant instance')

    editor.setInstanceComponentProperty(instance.id, '20:2', 'Custom')
    editor.setInstanceComponentProperty(instance.id, '20:1', 'B')
    expect(editor.graph.getNode(instance.id)?.componentId).toBe(variantB.id)
    expect(childByName(editor, instance.id, 'Label')?.text).toBe('Custom')

    editor.undo.undo()
    expect(editor.graph.getNode(instance.id)?.componentId).toBe(variantA.id)
    expect(childByName(editor, instance.id, 'Label')?.text).toBe('Custom')
  })
})

function boundIconPanel() {
  const editor = createEditor()
  const graph = editor.graph
  const pageId = editor.state.currentPageId
  const collection = graph.createCollection('Density')
  const roomy = graph.createMode(collection.id, 'Roomy') ?? ''
  const size = graph.createVariable('Size', 'STRING', collection.id, 'small')
  size.valuesByMode[roomy] = 'large'
  const set = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Badge',
    componentPropertyDefinitions: [
      { id: '8:1', name: 'Size', type: 'VARIANT', defaultValue: 'small' }
    ]
  })
  const variant = (value: string) =>
    graph.createNode('COMPONENT', set.id, {
      name: `Size=${value}`,
      componentPropertyValues: { Size: value }
    })
  const small = variant('small')
  const medium = variant('medium')
  variant('large')
  const panel = graph.createNode('COMPONENT', pageId, {
    name: 'Panel',
    componentPropertyDefinitions: [
      { id: '9:1', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: small.id }
    ]
  })
  const icon = expectDefined(
    graph.createInstance(small.id, panel.id, { name: 'Icon', variantBindings: { '8:1': size.id } })
  )
  graph.updateNode(icon.id, {
    componentPropertyReferences: [{ propertyId: '9:1', field: 'INSTANCE_SWAP' }]
  })
  const host = graph.createNode('FRAME', pageId, { name: 'Host' })
  const occurrence = expectDefined(
    graph.createInstance(panel.id, host.id, { name: 'Panel occurrence' })
  )
  const switchToRoomy = () => {
    graph.updateNode(host.id, { variableModes: { [collection.id]: roomy } })
    reconcileVariableLayouts(graph, { subtrees: [host.id] })
  }
  const shown = (node: SceneNode) =>
    node.componentId ? graph.getNode(node.componentId)?.name : undefined
  const occurrenceIcon = () => expectDefined(graph.getChildren(occurrence.id)[0])
  return { editor, panel, icon, occurrence, medium, size, switchToRoomy, shown, occurrenceIcon }
}

describe('swap properties on variant-bound layers', () => {
  test('a swap chosen on an instance unbinds the layer and survives a mode switch', () => {
    const { editor, occurrence, medium, switchToRoomy, shown, occurrenceIcon } = boundIconPanel()
    editor.setInstanceComponentProperty(occurrence.id, '9:1', medium.id)
    switchToRoomy()

    expect(shown(occurrenceIcon())).toBe('Size=medium')
    expect(occurrenceIcon().variantBindings).toEqual({})
  })

  test('undoing a swap chosen on an instance binds the layer again', () => {
    const { editor, occurrence, medium, size, switchToRoomy, shown, occurrenceIcon } =
      boundIconPanel()
    editor.setInstanceComponentProperty(occurrence.id, '9:1', medium.id)
    editor.undo.undo()
    switchToRoomy()

    expect(occurrenceIcon().variantBindings).toEqual({ '8:1': size.id })
    expect(shown(occurrenceIcon())).toBe('Size=large')
  })

  test('a new swap default unbinds the linked layer, and undo binds it again', () => {
    const { editor, panel, icon, medium, size, shown } = boundIconPanel()
    editor.setComponentPropertyDefault(panel.id, '9:1', medium.id)
    const unbound = expectDefined(editor.graph.getNode(icon.id))

    expect(shown(unbound)).toBe('Size=medium')
    expect(unbound.variantBindings).toEqual({})

    editor.undo.undo()
    const rebound = expectDefined(editor.graph.getNode(icon.id))

    expect(shown(rebound)).toBe('Size=small')
    expect(rebound.variantBindings).toEqual({ '8:1': size.id })
  })
})

async function openedInRoomy() {
  await initCodec()
  const panel = boundIconPanel()
  panel.switchToRoomy()
  const graph = await parseFigFile((await exportFigFile(panel.editor.graph)).slice().buffer)
  const named = (name: string) =>
    expectDefined([...graph.getAllNodes()].find((node) => node.name === name))
  const occurrence = named('Panel occurrence')
  const occurrenceIcon = () => expectDefined(graph.getChildren(occurrence.id)[0])
  const shownVariant = () => instanceMainComponent(graph, occurrenceIcon())?.name
  const switchToDefault = () => {
    graph.updateNode(named('Host').id, { variableModes: {} })
    reconcileVariableLayouts(graph, { subtrees: [named('Host').id] })
  }
  return {
    graph,
    editor: createEditor({ graph }),
    named,
    occurrence,
    occurrenceIcon,
    shownVariant,
    switchToDefault
  }
}

async function savedSwaps(graph: SceneGraph): Promise<(string | undefined)[][]> {
  const host = expectDefined([...graph.getAllNodes()].find((node) => node.name === 'Host'))
  graph.updateNode(host.id, { x: host.x + 1 })
  const patched = await exportFigFile(graph)
  releaseFigArchive(graph)
  return [patched, await exportFigFile(graph)].map((file) => {
    const records = parseFigBuffer(file.slice().buffer).nodeChanges
    const occurrence = expectDefined(records.find((record) => record.name === 'Panel occurrence'))
    return symbolOverridesOf(occurrence)
      .filter((override) => override.overriddenSymbolID)
      .map((override) => {
        const swapped = override.overriddenSymbolID
        return records.find(
          (record) => swapped && record.guid && guidToString(record.guid) === guidToString(swapped)
        )?.name
      })
  })
}

describe('swap properties where a mode shows another variant', () => {
  test('undo brings back the variant shown and saves no new swap', async () => {
    const { graph, editor, named, occurrence, occurrenceIcon, shownVariant } = await openedInRoomy()
    editor.setInstanceComponentProperty(occurrence.id, '9:1', named('Size=medium').id)
    editor.undo.undo()

    expect(shownVariant()).toBe('Size=large')
    expect(Object.keys(occurrenceIcon().variantBindings)).toEqual(['8:1'])
    expect(
      occurrence.instanceOverrides.descendants.get(occurrenceIcon().id)?.has('componentId')
    ).toBeFalsy()
    expect(await savedSwaps(graph)).toEqual([[], []])
  })

  test('choosing the variant the mode shows still pins it', async () => {
    const { editor, named, occurrence, occurrenceIcon, shownVariant, switchToDefault } =
      await openedInRoomy()
    editor.setInstanceComponentProperty(occurrence.id, '9:1', named('Size=large').id)
    switchToDefault()

    expect(occurrenceIcon().variantBindings).toEqual({})
    expect(shownVariant()).toBe('Size=large')
  })

  test('a new swap default moves the copies, live and in the saved file alike', async () => {
    const { graph, editor, named, shownVariant } = await openedInRoomy()
    editor.setComponentPropertyDefault(named('Panel').id, '9:1', named('Size=medium').id)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const copy = expectDefined(
      reopened.getChildren(
        expectDefined([...reopened.getAllNodes()].find((node) => node.name === 'Panel occurrence'))
          .id
      )[0]
    )

    expect(shownVariant()).toBe('Size=medium')
    expect(instanceMainComponent(reopened, copy)?.name).toBe('Size=medium')
  })
})
