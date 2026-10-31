import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { badgedCard, layerNamed, withOwnLayers } from '#core-tests/helpers/bound-variants'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'
import { instanceMainComponent, keptNodeCount } from '@open-pencil/scene-graph/instances'
import { DEFAULT_HISTORY_LIMIT } from '@open-pencil/scene-graph/undo'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'

import { restoreSubtree, snapshotSubtree } from '#core/editor/history/subtree'

describe('layers a mode switch sets aside', () => {
  test('undoing an edit on a layer a mode switch set aside reaches it when it comes back', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })

    editor.setActiveMode(collection.id, roomy)
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(1)
    expect(chip.instanceOverrides.descendants.get(badgeId)?.has('opacity')).not.toBe(true)
  })

  test('redoing an edit on a layer a mode switch set aside reaches it when it comes back', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.undo.undo()

    editor.setActiveMode(collection.id, roomy)
    editor.undo.redo()
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(chip.instanceOverrides.descendants.get(badgeId)?.has('opacity')).toBe(true)
  })

  test('a layer set aside by a mode switch outlives a variant chosen and undone meanwhile', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })

    editor.setActiveMode(collection.id, roomy)
    editor.switchInstanceVariant(chip.id, 'Scale', 'tight')
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
  })

  test('a mode switch keeps a variant from pinning the mode the binding resolves in', () => {
    const { editor, graph, collection, compact, roomy, tight, loose, chip } = withOwnLayers()
    graph.updateNode(tight.id, { variableModes: { [collection.id]: compact } })
    graph.updateNode(loose.id, { variableModes: { [collection.id]: roomy } })

    editor.setActiveMode(collection.id, roomy)
    expect(chip.componentId).toBe(loose.id)
    editor.setActiveMode(collection.id, compact)

    expect(chip.componentId).toBe(tight.id)
  })

  test('a layer of a nested instance set aside by a mode switch comes back with its override', () => {
    const { editor, graph, density, roomy, compact, badge } = badgedCard()
    const ring = expectDefined(graph.getChildren(badge.id).find((node) => node.name === 'Ring'))
    editor.updateNodeWithUndo(ring.id, { opacity: 0.25 })

    editor.setActiveMode(density.id, roomy)
    editor.setActiveMode(density.id, compact)

    const back = expectDefined(graph.getChildren(badge.id).find((node) => node.name === 'Ring'))
    expect(back.id).toBe(ring.id)
    expect(back.opacity).toBe(0.25)
  })

  test('a nested instance without bindings keeps its variant over mode round trips', () => {
    const { editor, graph, density, roomy, compact, badge, dotWidth } = badgedCard()
    graph.updateNode(badge.id, { variantBindings: {} })
    const widths: number[] = []
    for (const mode of [roomy, compact, roomy, compact]) {
      editor.setActiveMode(density.id, mode)
      widths.push(dotWidth())
    }
    expect(widths).toEqual([4, 4, 4, 4])
  })

  test('a nested instance with its own binding follows every mode change', () => {
    const { editor, density, roomy, compact, dotWidth } = badgedCard()
    const widths: number[] = []
    for (const mode of [roomy, compact, roomy, compact]) {
      editor.setActiveMode(density.id, mode)
      widths.push(dotWidth())
    }
    expect(widths).toEqual([8, 4, 8, 4])
  })

  test('undoing a detach brings back the bindings and the layers a mode switch set aside', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    const bindings = { ...chip.variantBindings }
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)

    editor.select([chip.id])
    editor.detachInstance()
    expect(keptNodeCount(graph)).toBe(0)
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    expect(chip.variantBindings).toEqual(bindings)
    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
  })

  test('undoing a delete brings back the layers a mode switch set aside', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)

    editor.select([chip.id])
    editor.deleteSelected()
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    const restored = expectDefined(graph.getNode(chip.id))
    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(restored.instanceOverrides.descendants.get(badgeId)?.has('opacity')).toBe(true)
    const targets = [...restored.instanceOverrides.descendants.keys()]
    expect(targets.every((id) => graph.getNode(id))).toBe(true)
  })

  test('a layer set aside inside a layer set aside comes back with it', () => {
    const { editor, graph, collection, compact, roomy, tight, chip } = withOwnLayers()
    const sizes = graph.createCollection('Sizes')
    const big = expectDefined(graph.createMode(sizes.id, 'Big'))
    const size = graph.createVariable('Size', 'STRING', sizes.id, 'S')
    size.valuesByMode[big] = 'L'
    const page = editor.state.currentPageId
    const dots = graph.createNode('COMPONENT_SET', page, {
      name: 'Dot',
      x: 600,
      componentPropertyDefinitions: [
        { id: 'prop:size', name: 'Size', type: 'VARIANT', defaultValue: 'S' }
      ]
    })
    const small = graph.createNode('COMPONENT', dots.id, {
      name: 'Size=S',
      componentPropertyValues: { Size: 'S' }
    })
    graph.createNode('RECTANGLE', small.id, { name: 'Ring', width: 2, height: 2 })
    graph.createNode('RECTANGLE', small.id, { name: 'Core', width: 2, height: 2 })
    const large = graph.createNode('COMPONENT', dots.id, {
      name: 'Size=L',
      y: 50,
      componentPropertyValues: { Size: 'L' }
    })
    graph.createNode('RECTANGLE', large.id, { name: 'Core', width: 8, height: 8 })
    expectDefined(
      graph.createInstance(small.id, tight.id, {
        name: 'Dot',
        variantBindings: { 'prop:size': size.id }
      })
    )
    graph.syncInstance(chip.id)
    const dot = layerNamed(graph, chip.id, 'Dot')
    const ring = layerNamed(graph, dot.id, 'Ring')
    editor.updateNodeWithUndo(ring.id, { opacity: 0.25 })

    editor.setActiveMode(sizes.id, big)
    editor.setActiveMode(collection.id, roomy)
    editor.setActiveMode(collection.id, compact)
    editor.setActiveMode(sizes.id, sizes.defaultModeId)

    const ringBack = layerNamed(graph, layerNamed(graph, chip.id, 'Dot').id, 'Ring')
    expect(ringBack.id).toBe(ring.id)
    expect(ringBack.opacity).toBe(0.25)
    expect(dot.instanceOverrides.descendants.get(ring.id)?.has('opacity')).toBe(true)
  })

  test('a nested instance kept on its variant follows its source switched by hand', () => {
    const { editor, graph, density, roomy, compact, card, source, large, badge, dotWidth } =
      badgedCard()
    graph.updateNode(source.id, { variantBindings: {} })
    editor.setActiveMode(density.id, roomy)
    editor.setActiveMode(density.id, compact)

    graph.swapInstanceComponent(source.id, large.id)
    graph.syncInstances(card.id)

    expect(instanceMainComponent(graph, badge)?.id).toBe(large.id)
    expect(dotWidth()).toBe(8)
    expect(graph.getChildren(badge.id).map((node) => node.name)).toEqual(['Dot'])
  })

  test('a binding through an alias keeps the variant from pinning the aliased mode', () => {
    const { editor, graph, collection, compact, roomy, scale, loose, chip } = withOwnLayers()
    const theme = graph.createCollection('Theme')
    const alias = graph.createVariable('Alias', 'STRING', theme.id, 'tight')
    alias.valuesByMode[theme.defaultModeId] = { aliasId: scale.id }
    graph.updateNode(chip.id, { variantBindings: { 'prop:scale': alias.id } })
    graph.updateNode(loose.id, { variableModes: { [collection.id]: compact } })

    editor.setActiveMode(collection.id, roomy)
    const shown = [chip.componentId]
    for (let round = 0; round < 3; round++) {
      reconcileVariableBindings(graph)
      shown.push(chip.componentId)
    }

    expect(shown).toEqual([loose.id, loose.id, loose.id, loose.id])
  })

  test('a plugin write to a layer a mode switch set aside changes nothing', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    const proxy = expectDefined(new FigmaAPI(graph).getNodeById(badgeId))
    editor.setActiveMode(collection.id, roomy)

    proxy.opacity = 0.5
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(1)
    expect(chip.instanceOverrides.descendants.get(badgeId)?.has('opacity')).not.toBe(true)
  })

  test('undoing a delete again after a redo brings back the layers a mode switch set aside', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)

    editor.select([chip.id])
    editor.deleteSelected()
    editor.undo.undo()
    editor.undo.redo()
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    const restored = expectDefined(graph.getNode(chip.id))
    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(restored.instanceOverrides.descendants.get(badgeId)?.has('opacity')).toBe(true)
  })

  test('undoing a paste that replaced an instance brings back the layers a mode switch set aside', async () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)
    const source = createEditor()
    const pasted = source.graph.createNode('RECTANGLE', source.state.currentPageId, {
      name: 'Pasted',
      width: 20,
      height: 20
    })

    editor.select([chip.id])
    await editor.pasteFromHTML(buildOpenPencilClipboardHTML([pasted], source.graph), undefined, {
      replaceSelection: true
    })
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
  })

  test('a subtree put back from its snapshot keeps the layers a mode switch set aside', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)
    const snapshot = snapshotSubtree(graph, chip.id)
    const parentId = expectDefined(chip.parentId)

    graph.deleteNode(chip.id)
    restoreSubtree(graph, expectDefined(snapshot.get(chip.id)), parentId, snapshot)
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
  })

  test('a duplicate of an instance with a nested instance kept on its variant follows its source', () => {
    const { editor, graph, density, roomy, compact, card, source, large } = badgedCard()
    const original = expectDefined(graph.getInstances(card.id)[0])
    editor.setActiveMode(density.id, roomy)
    editor.setActiveMode(density.id, compact)

    editor.select([original.id])
    editor.duplicateSelected()
    const copy = expectDefined(graph.getInstances(card.id).find((node) => node.id !== original.id))
    const badge = expectDefined(graph.getChildren(copy.id)[0])
    graph.updateNode(source.id, { variantBindings: {} })
    graph.swapInstanceComponent(source.id, large.id)
    graph.syncInstances(card.id)

    expect(instanceMainComponent(graph, badge)?.id).toBe(large.id)
    expect(graph.getChildren(badge.id).map((node) => node.name)).toEqual(['Dot'])
  })

  test('an instance reset after a nested instance was kept on its variant follows its source', () => {
    const { editor, graph, density, roomy, compact, card, source, large, badge } = badgedCard()
    const original = expectDefined(graph.getInstances(card.id)[0])
    editor.setActiveMode(density.id, roomy)
    editor.setActiveMode(density.id, compact)

    expectDefined(new FigmaAPI(graph).getNodeById(original.id)).resetOverrides()
    graph.updateNode(source.id, { variantBindings: {} })
    graph.swapInstanceComponent(source.id, large.id)
    graph.syncInstances(card.id)

    expect(instanceMainComponent(graph, badge)?.id).toBe(large.id)
    expect(graph.getChildren(badge.id).map((node) => node.name)).toEqual(['Dot'])
  })

  test('a delete of more instances than undo keeps steps still brings back every set-aside layer', () => {
    const { editor, graph, collection, compact, roomy, tight, frame, chip } = withOwnLayers()
    const chips = [chip]
    for (let index = 0; index < DEFAULT_HISTORY_LIMIT; index++) {
      chips.push(
        expectDefined(
          graph.createInstance(tight.id, frame.id, { variantBindings: { ...chip.variantBindings } })
        )
      )
    }
    const badgeIds = chips.map((placed) => layerNamed(graph, placed.id, 'Badge').id)
    editor.updateNodeWithUndo(expectDefined(badgeIds[0]), { opacity: 0.3 })
    editor.setActiveMode(collection.id, roomy)

    editor.select([frame.id])
    editor.deleteSelected()
    editor.undo.undo()
    editor.setActiveMode(collection.id, compact)

    expect(chips.map((placed) => layerNamed(graph, placed.id, 'Badge').id)).toEqual(badgeIds)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(chip.instanceOverrides.descendants.get(expectDefined(badgeIds[0]))?.has('opacity')).toBe(
      true
    )
  })
})
