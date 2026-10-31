import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { boundChip, layerNamed, withOwnLayers } from '#core-tests/helpers/bound-variants'

describe('variant bindings in the editor', () => {
  test('choosing a variant removes the binding of its property, and undo brings it back', () => {
    const { editor, scale, loose, chip } = boundChip()

    expect(editor.switchInstanceVariant(chip.id, 'Scale', 'loose').kind).toBe('changed')
    expect(chip.componentId).toBe(loose.id)
    expect(chip.variantBindings).toEqual({})

    editor.undo.undo()
    expect(chip.variantBindings).toEqual({ 'prop:scale': scale.id })
  })

  test('choosing the variant already shown still removes the binding', () => {
    const { editor, scale, chip } = boundChip()

    expect(editor.switchInstanceVariant(chip.id, 'Scale', 'tight').kind).toBe('unchanged')
    expect(chip.variantBindings).toEqual({})

    editor.undo.undo()
    expect(chip.variantBindings).toEqual({ 'prop:scale': scale.id })
  })

  test('a chosen variant stays when the mode changes', () => {
    const { editor, roomy, tight, chip, setMode } = boundChip()
    editor.switchInstanceVariant(chip.id, 'Scale', 'loose')
    editor.switchInstanceVariant(chip.id, 'Scale', 'tight')

    setMode(roomy)

    expect(chip.componentId).toBe(tight.id)
  })

  test('layer overrides follow a mode switch and its undo', () => {
    const { editor, roomy, loose, tight, chip, background, setMode } = boundChip()
    editor.updateNodeWithUndo(background().id, { visible: false })

    setMode(roomy)
    expect(chip.componentId).toBe(loose.id)
    expect(background().visible).toBe(false)

    editor.undo.undo()
    expect(chip.componentId).toBe(tight.id)
    expect(background().visible).toBe(false)
    expect(background().width).toBe(40)
  })

  test('layer overrides follow a chosen variant and its undo', () => {
    const { editor, chip, background } = boundChip()
    editor.updateNodeWithUndo(background().id, { visible: false })

    editor.switchInstanceVariant(chip.id, 'Scale', 'loose')
    expect(background().visible).toBe(false)

    editor.undo.undo()
    expect(background().visible).toBe(false)
  })

  test('an edit made before a mode switch stays undoable after it', () => {
    const { editor, roomy, chip, background, setMode } = boundChip()
    const backgroundId = background().id
    editor.updateNodeWithUndo(backgroundId, { visible: false })
    editor.updateNodeWithUndo(backgroundId, { opacity: 0.5 })

    setMode(roomy)
    expect(background().id).toBe(backgroundId)
    editor.undo.undo()
    editor.undo.undo()

    expect(background().opacity).toBe(1)
    expect(background().visible).toBe(false)
    expect([...chip.instanceOverrides.descendants.keys()]).toEqual([backgroundId])
  })

  test('undoing a mode switch brings back a layer the new variant lacks, with its ID and override', () => {
    const { editor, graph, roomy, chip, setMode } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })

    setMode(roomy)
    editor.undo.undo()

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(chip.instanceOverrides.descendants.get(badgeId)?.has('opacity')).toBe(true)
  })

  test('redoing a mode switch brings back the layers it added, so later edits redo on them', () => {
    const { editor, graph, roomy, chip, setMode } = withOwnLayers()
    setMode(roomy)
    const iconId = layerNamed(graph, chip.id, 'Icon').id
    editor.updateNodeWithUndo(iconId, { opacity: 0.4 })

    editor.undo.undo()
    editor.undo.undo()
    editor.undo.redo()
    editor.undo.redo()

    expect(layerNamed(graph, chip.id, 'Icon').id).toBe(iconId)
    expect(layerNamed(graph, chip.id, 'Icon').opacity).toBe(0.4)
  })

  test('undoing a variable change that switched a variant brings back its layers', () => {
    const { editor, graph, scale, compact, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })

    editor.updateVariableValue(scale.id, compact, 'loose')
    editor.undo.undo()

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
  })

  test('an active mode switched there and back keeps a layer the other variant lacks', () => {
    const { editor, graph, collection, compact, roomy, chip } = withOwnLayers()
    const badgeId = layerNamed(graph, chip.id, 'Badge').id
    editor.updateNodeWithUndo(badgeId, { opacity: 0.3 })
    editor.updateNodeWithUndo(badgeId, { visible: false })

    editor.setActiveMode(collection.id, roomy)
    editor.setActiveMode(collection.id, compact)

    expect(layerNamed(graph, chip.id, 'Badge').id).toBe(badgeId)
    expect(layerNamed(graph, chip.id, 'Badge').opacity).toBe(0.3)
    expect(chip.instanceOverrides.descendants.get(badgeId)?.has('opacity')).toBe(true)
    editor.undo.undo()
    expect(layerNamed(graph, chip.id, 'Badge').visible).toBe(true)
  })

  test('undoing a mode switch brings back a layer with no source link once', () => {
    const { editor, graph, scale, compact, chip } = withOwnLayers()
    graph.updateNode(layerNamed(graph, chip.id, 'Badge').id, { componentId: null })

    editor.updateVariableValue(scale.id, compact, 'loose')
    editor.undo.undo()

    expect(graph.getChildren(chip.id).filter((node) => node.name === 'Badge')).toHaveLength(1)
  })

  test('undoing a choice on a nested instance restores what its owner overrides', () => {
    const { editor, graph, scale, tight, loose, frame } = boundChip()
    const card = graph.createNode('COMPONENT', frame.id, { name: 'Card' })
    const cardInstance = expectDefined(graph.createInstance(card.id, frame.id, { y: 200 }))
    const nested = expectDefined(
      graph.createInstance(tight.id, cardInstance.id, {
        variantBindings: { 'prop:scale': scale.id }
      })
    )
    const before = [...cardInstance.instanceOverrides.descendants.entries()].map(([id, fields]) => [
      id,
      [...fields.keys()]
    ])

    editor.switchInstanceVariant(nested.id, 'Scale', 'loose')
    expect(nested.componentId).toBe(loose.id)
    expect(cardInstance.instanceOverrides.descendants.get(nested.id)?.has('variantBindings')).toBe(
      true
    )
    editor.undo.undo()

    expect(nested.variantBindings).toEqual({ 'prop:scale': scale.id })
    expect(
      [...cardInstance.instanceOverrides.descendants.entries()].map(([id, fields]) => [
        id,
        [...fields.keys()]
      ])
    ).toEqual(before)
  })

  test('switching a deep bound instance and back stays linear in its layers', () => {
    const { editor, compact, roomy, deepest, setMode } = boundChip(24, 3)
    editor.updateNodeWithUndo(deepest().id, { opacity: 0.5 })
    const started = performance.now()
    for (let round = 0; round < 5; round++) {
      setMode(roomy)
      setMode(compact)
    }
    expect(performance.now() - started).toBeLessThan(1000)
    expect(deepest().opacity).toBe(0.5)
  })
})
