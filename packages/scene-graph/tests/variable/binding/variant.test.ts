import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { recordInstanceOverride } from '@open-pencil/scene-graph/instances'
import { collectionsBoundIn, layersUsingVariables, reconcileVariableBindings, showBoundVariants, unbindVariantProperty } from '@open-pencil/scene-graph/variables'

const SIZES = { tight: { width: 40, height: 20 }, loose: { width: 80, height: 30 } }

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected a value')
  }
  return value
}

function chipSet() {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Density')
  const compact = collection.defaultModeId
  const roomy = graph.createMode(collection.id, 'Roomy') ?? ''
  const scale = graph.createVariable('Scale', 'STRING', collection.id, 'tight')
  scale.valuesByMode[roomy] = 'loose'
  const page = graph.getPages()[0].id
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Chip',
    componentPropertyDefinitions: [
      { id: 'prop:scale', name: 'Scale', type: 'VARIANT', defaultValue: 'tight' },
      { id: 'prop:tone', name: 'Tone', type: 'VARIANT', defaultValue: 'plain' },
      { id: 'prop:label', name: 'Label', type: 'TEXT', defaultValue: 'Chip' }
    ]
  })
  const variant = (scaleValue: 'tight' | 'loose', tone: string, y: number): SceneNode => {
    const component = graph.createNode('COMPONENT', set.id, {
      name: `Scale=${scaleValue}, Tone=${tone}`,
      y,
      ...SIZES[scaleValue],
      componentPropertyValues: { Scale: scaleValue, Tone: tone }
    })
    graph.createNode('RECTANGLE', component.id, { name: 'Background', ...SIZES[scaleValue] })
    graph.createNode('TEXT', component.id, {
      name: 'Label',
      text: 'Chip',
      componentPropertyReferences: [{ propertyId: 'prop:label', field: 'TEXT' }]
    })
    return component
  }
  const tightPlain = variant('tight', 'plain', 0)
  const loosePlain = variant('loose', 'plain', 100)
  const tightBold = variant('tight', 'bold', 200)
  const frame = graph.createNode('FRAME', page, { variableModes: { [collection.id]: roomy } })
  const place = (component: SceneNode, parentId = frame.id): SceneNode =>
    present(
      graph.createInstance(component.id, parentId, {
        variantBindings: { 'prop:scale': scale.id }
      })
    )
  const setMode = (modeId: string) => {
    graph.updateNode(frame.id, { variableModes: { [collection.id]: modeId } })
    return reconcileVariableBindings(graph, { subtrees: [frame.id] })
  }
  return {
    graph,
    compact,
    roomy,
    collection,
    scale,
    set,
    page,
    frame,
    place,
    setMode,
    variants: { tightPlain, loosePlain, tightBold }
  }
}

function nestedChip() {
  const chips = chipSet()
  const { graph, page, frame, place, variants } = chips
  const card = graph.createNode('COMPONENT', page, { name: 'Card', x: 500 })
  const source = place(variants.tightPlain, card.id)
  const cardInstance = present(graph.createInstance(card.id, frame.id))
  const occurrence = () => present(graph.getChildren(cardInstance.id)[0])
  return { ...chips, card, source, cardInstance, occurrence }
}

function mainComponentName(graph: SceneGraph, node: SceneNode): string | undefined {
  let current = node.componentId ? graph.getNode(node.componentId) : undefined
  while (current?.type === 'INSTANCE' && current.componentId) {
    current = graph.getNode(current.componentId)
  }
  return current?.name
}

describe('variant bindings', () => {
  test('a bound property switches the instance to the variant its mode selects', () => {
    const { graph, frame, place, variants } = chipSet()
    const chip = place(variants.tightPlain)

    expect(reconcileVariableBindings(graph, { subtrees: [frame.id] })).toContain(chip.id)

    expect(chip.componentId).toBe(variants.loosePlain.id)
    expect({ width: chip.width, height: chip.height }).toEqual(SIZES.loose)
  })

  test('switching the mode back returns the instance to the first variant', () => {
    const { compact, roomy, setMode, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    setMode(roomy)

    setMode(compact)

    expect(chip.componentId).toBe(variants.tightPlain.id)
    expect({ width: chip.width, height: chip.height }).toEqual(SIZES.tight)
  })

  test('the binding decides over the variant the instance was placed as', () => {
    const { compact, setMode, place, variants } = chipSet()
    const chip = place(variants.loosePlain)

    setMode(compact)

    expect(chip.componentId).toBe(variants.tightPlain.id)
  })

  test('values no variant has exactly keep the current variant', () => {
    const { graph, frame, place, variants } = chipSet()
    const chip = place(variants.tightBold)

    expect(reconcileVariableBindings(graph, { subtrees: [frame.id] })).not.toContain(chip.id)

    expect(chip.componentId).toBe(variants.tightBold.id)
  })

  test('a swap keeps the text the instance assigns its properties', () => {
    const { graph, frame, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    graph.updateNode(chip.id, { componentPropertyAssignments: { 'prop:label': 'Hello' } })

    reconcileVariableBindings(graph, { subtrees: [frame.id] })

    expect(graph.getChildren(chip.id).map((child) => child.text)).toContain('Hello')
  })

  test('a swap reports the property assignments it applied again', () => {
    const { graph, frame, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    graph.updateNode(chip.id, { componentPropertyAssignments: { 'prop:label': 'Hello' } })
    const reapplied: string[] = []

    reconcileVariableBindings(
      graph,
      { subtrees: [frame.id] },
      {
        onVariantSwap: (instanceId, definitions) => {
          reapplied.push(...definitions.map((definition) => `${instanceId}/${definition.id}`))
        }
      }
    )

    expect(reapplied).toEqual([`${chip.id}/prop:label`])
  })

  test('a variable bound to a variant property reaches the instance', () => {
    const { graph, collection, scale, frame, place, variants } = chipSet()
    const chip = place(variants.tightPlain)

    expect(layersUsingVariables(graph, [scale.id])).toEqual([chip])
    expect(collectionsBoundIn(graph, [frame.id])).toEqual(new Set([collection.id]))
  })

  test('a renamed variant property stays bound', () => {
    const { graph, set, roomy, setMode, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    graph.updateNode(set.id, {
      componentPropertyDefinitions: set.componentPropertyDefinitions.map((definition) =>
        definition.id === 'prop:scale' ? { ...definition, name: 'Density' } : definition
      )
    })
    for (const variant of Object.values(variants)) {
      const { Scale: density = '', ...others } = variant.componentPropertyValues
      graph.updateNode(variant.id, { componentPropertyValues: { ...others, Density: density } })
    }

    setMode(roomy)

    expect(chip.componentId).toBe(variants.loosePlain.id)
  })

  test('a detached instance keeps no variant bindings', () => {
    const { graph, place, variants } = chipSet()
    const chip = place(variants.tightPlain)

    graph.detachInstance(chip.id)

    expect(chip.variantBindings).toEqual({})
  })

  test('overrides inside the instance follow it to the new variant and back', () => {
    const { graph, compact, roomy, setMode, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    setMode(compact)
    const background = () => present(graph.getChildren(chip.id)[0])
    graph.updateNode(background().id, { visible: false })
    recordInstanceOverride(graph, background().id, ['visible'])

    setMode(roomy)
    expect(background().visible).toBe(false)
    expect(background().width).toBe(SIZES.loose.width)

    setMode(compact)
    expect(background().visible).toBe(false)
    expect([...chip.instanceOverrides.descendants.keys()]).toEqual([background().id])
  })

  test('a binding overridden inside the instance keeps the new variant’s other bindings', () => {
    const { graph, collection, compact, roomy, setMode, place, variants } = chipSet()
    const strong = graph.createVariable('Strong', 'FLOAT', collection.id, 0.9)
    const round = graph.createVariable('Round', 'FLOAT', collection.id, 6)
    const looseBackground = present(graph.getChildren(variants.loosePlain.id)[0])
    graph.bindVariable(looseBackground.id, 'opacity', strong.id)
    const chip = place(variants.tightPlain)
    setMode(compact)
    const background = () => present(graph.getChildren(chip.id)[0])
    graph.bindVariable(background().id, 'cornerRadius', round.id)
    recordInstanceOverride(graph, background().id, ['boundVariables/cornerRadius'])

    setMode(roomy)

    expect(background().boundVariables).toEqual({ opacity: strong.id, cornerRadius: round.id })
    expect(background().opacity).toBe(0.9)
    expect(background().cornerRadius).toBe(6)
  })

  test('overrides on layers inside a nested instance follow a swap', () => {
    const { graph, page, compact, roomy, setMode, place, variants } = chipSet()
    const icon = graph.createNode('COMPONENT', page, { name: 'Icon', x: 900 })
    graph.createNode('RECTANGLE', icon.id, { name: 'Glyph', width: 5, height: 5 })
    for (const variant of [variants.tightPlain, variants.loosePlain]) {
      present(graph.createInstance(icon.id, variant.id, { name: 'Icon' }))
    }
    const chip = place(variants.tightPlain)
    setMode(compact)
    const nested = present(graph.getChildren(chip.id).find((node) => node.name === 'Icon'))
    const glyph = present(graph.getChildren(nested.id)[0])
    graph.updateNode(glyph.id, { visible: false })
    recordInstanceOverride(graph, glyph.id, ['visible'])

    setMode(roomy)

    expect(chip.componentId).toBe(variants.loosePlain.id)
    expect(graph.getNode(glyph.id)?.visible).toBe(false)
    expect(nested.instanceOverrides.descendants.get(glyph.id)?.has('visible')).toBe(true)
  })

  test('removing a binding by name leaves the others', () => {
    const { graph, scale, place, variants } = chipSet()
    const chip = place(variants.tightPlain)
    graph.updateNode(chip.id, {
      variantBindings: { 'prop:scale': scale.id, 'prop:tone': scale.id }
    })

    expect(unbindVariantProperty(graph, chip.id, 'Scale')).toBe(true)

    expect(chip.variantBindings).toEqual({ 'prop:tone': scale.id })
  })

  test('a bound instance inside a bound instance that swaps is neither swapped nor reported', () => {
    const { graph, scale, place, variants } = chipSet()
    const inner = place(variants.tightPlain)
    const outer = place(variants.tightPlain)
    graph.reparentNode(inner.id, outer.id)
    const swapped: string[] = []

    const changed = reconcileVariableBindings(
      graph,
      { variables: [scale.id] },
      { onVariantSwap: (instanceId) => swapped.push(instanceId) }
    )

    expect(swapped).toEqual([outer.id])
    expect(changed).toEqual([outer.id])
  })

  test('showing bound variants switches instances without recording an override', () => {
    const { graph, place, variants } = chipSet()
    const chip = place(variants.tightPlain)

    expect(showBoundVariants(graph, [chip])).toEqual([chip.id])

    expect(chip.componentId).toBe(variants.loosePlain.id)
    expect(chip.instanceOverrides.self.has('componentId')).toBe(false)
  })
})

describe('variant bindings of nested instances', () => {
  test('an occurrence of a nested instance switches without recording an override', () => {
    const { graph, roomy, setMode, cardInstance, occurrence } = nestedChip()

    setMode(roomy)

    expect(mainComponentName(graph, occurrence())).toBe('Scale=loose, Tone=plain')
    const recorded = [...cardInstance.instanceOverrides.descendants.values()].flatMap((fields) => [
      ...fields.keys()
    ])
    expect(recorded).not.toContain('componentId')
  })

  test('an occurrence switched back shows its source variant again', () => {
    const { graph, roomy, compact, setMode, occurrence } = nestedChip()
    setMode(roomy)

    setMode(compact)

    expect(mainComponentName(graph, occurrence())).toBe('Scale=tight, Tone=plain')
    expect(occurrence().width).toBe(SIZES.tight.width)
  })

  test('syncing the outer component keeps the variant an occurrence shows', () => {
    const { graph, card, roomy, setMode, occurrence } = nestedChip()
    setMode(roomy)

    graph.syncInstances(card.id)

    expect(present(graph.getChildren(occurrence().id)[0]).width).toBe(SIZES.loose.width)
  })

  test('a binding removed from the nested instance leaves its occurrences', () => {
    const { graph, card, source, occurrence } = nestedChip()

    graph.updateNode(source.id, { variantBindings: {} })
    graph.syncInstances(card.id)

    expect(occurrence().variantBindings).toEqual({})
  })

  test('an occurrence unbound by name keeps its own choice through a sync', () => {
    const { graph, card, cardInstance, occurrence } = nestedChip()

    unbindVariantProperty(graph, occurrence().id, 'Scale')
    graph.syncInstances(card.id)

    expect(occurrence().variantBindings).toEqual({})
    const fields = cardInstance.instanceOverrides.descendants.get(occurrence().id)
    expect(fields?.has('variantBindings')).toBe(true)
  })

  test('an occurrence keeps its name when its binding switches it', () => {
    const { graph, roomy, setMode, source, occurrence } = nestedChip()

    setMode(roomy)

    expect(mainComponentName(graph, occurrence())).toBe('Scale=loose, Tone=plain')
    expect(occurrence().name).toBe(source.name)
  })

  test('an occurrence keeps the variant its binding chose when the outer instance switches', () => {
    const { graph, page, frame, place, roomy, setMode, variants } = chipSet()
    const cards = graph.createNode('COMPONENT_SET', page, { name: 'Card', x: 500 })
    const card = (state: string, y: number) => {
      const component = graph.createNode('COMPONENT', cards.id, { name: `State=${state}`, y })
      place(variants.tightPlain, component.id)
      return component
    }
    const first = card('A', 0)
    const second = card('B', 100)
    const cardInstance = present(graph.createInstance(first.id, frame.id))
    setMode(roomy)
    const occurrence = present(graph.getChildren(cardInstance.id)[0])

    graph.swapInstanceComponent(cardInstance.id, second.id)

    expect(graph.getChildren(cardInstance.id)[0]?.id).toBe(occurrence.id)
    expect(mainComponentName(graph, occurrence)).toBe('Scale=loose, Tone=plain')
    expect(present(graph.getChildren(occurrence.id)[0]).width).toBe(SIZES.loose.width)
  })

  test('an occurrence follows a mode its source in the component switches with in the same pass', () => {
    const { graph, page, collection, roomy, scale, place, variants } = chipSet()
    const card = graph.createNode('COMPONENT', page, { name: 'Card', x: 500 })
    const source = place(variants.tightPlain, card.id)
    const cardInstance = present(graph.createInstance(card.id, page, { x: 900 }))
    const occurrence = present(graph.getChildren(cardInstance.id)[0])

    graph.setActiveMode(collection.id, roomy)
    reconcileVariableBindings(graph, { variables: [scale.id] })

    expect(mainComponentName(graph, source)).toBe('Scale=loose, Tone=plain')
    expect(mainComponentName(graph, occurrence)).toBe('Scale=loose, Tone=plain')
    expect(present(graph.getChildren(occurrence.id)[0]).width).toBe(SIZES.loose.width)
  })

  test('an instance a swap brings in resolves in the modes the new variant sets', () => {
    const { graph, page, place, setMode, roomy, variants } = chipSet()
    const shade = graph.createCollection('Shade')
    const dark = graph.createMode(shade.id, 'Dark') ?? ''
    const tone = graph.createVariable('Tone', 'STRING', shade.id, 'plain')
    tone.valuesByMode[dark] = 'bold'
    const dots = graph.createNode('COMPONENT_SET', page, {
      name: 'Dot',
      x: 800,
      componentPropertyDefinitions: [
        { id: 'prop:dot', name: 'Tone', type: 'VARIANT', defaultValue: 'plain' }
      ]
    })
    const plainDot = graph.createNode('COMPONENT', dots.id, {
      name: 'Tone=plain',
      componentPropertyValues: { Tone: 'plain' }
    })
    graph.createNode('COMPONENT', dots.id, {
      name: 'Tone=bold',
      y: 50,
      componentPropertyValues: { Tone: 'bold' }
    })
    graph.updateNode(variants.loosePlain.id, { variableModes: { [shade.id]: dark } })
    graph.createInstance(plainDot.id, variants.loosePlain.id, {
      variantBindings: { 'prop:dot': tone.id }
    })
    const chip = place(variants.tightPlain)

    setMode(roomy)

    const dot = present(graph.getChildren(chip.id).find((node) => node.type === 'INSTANCE'))
    expect(mainComponentName(graph, dot)).toBe('Tone=bold')
  })
})
