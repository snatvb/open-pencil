import { describe, expect, test } from 'bun:test'

import {
  FigmaAPI,
  type FigmaComponentSetNode,
  type FigmaNodeProxy
} from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'

// Recorded by running the same script in Figma desktop: variant edits through the Plugin API
// rename the variants, instances follow, and the value lists follow the variants' names.

function variants() {
  const figma = new FigmaAPI(new SceneGraph())
  const base = figma.createComponent()
  base.name = 'State=Default'
  const hover = figma.createComponent()
  hover.name = 'State=Hover'
  const set = figma.combineAsVariants([base, hover], figma.currentPage)
  const instance = base.createInstance()
  return { figma, set, base, hover, instance }
}

const names = (set: FigmaComponentSetNode) => set.children.map((child) => child.name)
const variantProperties = (node: FigmaNodeProxy) =>
  (node as FigmaNodeProxy & { variantProperties: Record<string, string> | null }).variantProperties

describe('variant properties through the Plugin API', () => {
  test('variants and their instances read their values; other components read null', () => {
    const { figma, base, instance } = variants()
    expect(variantProperties(base)).toEqual({ State: 'Default' })
    expect(variantProperties(instance)).toEqual({ State: 'Default' })
    const lone = figma.createComponent()
    expect(variantProperties(lone)).toBeNull()
    expect(variantProperties(lone.createInstance())).toBeNull()
  })

  test('renaming an axis renames every variant, and instances switch by the new name', () => {
    const { set, instance } = variants()
    expect(set.editComponentProperty('State', { name: 'Mode' })).toBe('Mode')
    expect(names(set)).toEqual(['Mode=Default', 'Mode=Hover'])
    expect(set.componentPropertyDefinitions).toEqual({
      Mode: { type: 'VARIANT', defaultValue: 'Default', variantOptions: ['Default', 'Hover'] }
    })
    expect(variantProperties(instance)).toEqual({ Mode: 'Default' })
    instance.setProperties({ Mode: 'Hover' })
    expect(instance.mainComponent?.name).toBe('Mode=Hover')
  })

  test('adding an axis appends its value to every variant', () => {
    const { set, instance } = variants()
    expect(set.addComponentProperty('Size', 'VARIANT', 'sm')).toBe('Size')
    expect(names(set)).toEqual(['State=Default, Size=sm', 'State=Hover, Size=sm'])
    expect(set.componentPropertyDefinitions.Size).toEqual({
      type: 'VARIANT',
      defaultValue: 'sm',
      variantOptions: ['sm']
    })
    expect(variantProperties(instance)).toEqual({ State: 'Default', Size: 'sm' })
  })

  test('value lists follow the variants’ names', () => {
    const { set, base, hover } = variants()
    hover.name = 'State=Pressed'
    base.name = 'State=Base'
    expect(set.componentPropertyDefinitions.State).toEqual({
      type: 'VARIANT',
      defaultValue: 'Base',
      variantOptions: ['Pressed', 'Base']
    })
    expect(variantProperties(hover)).toEqual({ State: 'Pressed' })
  })

  test('a variant renamed to another’s values keeps its own, where Figma leaves the set in error', () => {
    const { set, hover, instance } = variants()
    hover.name = 'State=Default'
    expect(variantProperties(hover)).toEqual({ State: 'Hover' })
    expect(set.componentPropertyDefinitions.State).toMatchObject({
      variantOptions: ['Default', 'Hover']
    })
    instance.setProperties({ State: 'Hover' })
    expect(instance.mainComponent?.id).toBe(hover.id)
  })

  test('variant edits fail as Figma’s do', () => {
    const { set, base } = variants()
    set.addComponentProperty('Size', 'VARIANT', 'sm')
    expect(() => set.addComponentProperty('Size', 'VARIANT', 'md')).toThrow(
      'in addComponentProperty: Node already has a variant property with name Size'
    )
    expect(() => set.addComponentProperty('Empty', 'VARIANT', '')).toThrow(
      'in addComponentProperty: Component property default value cannot be empty'
    )
    expect(() => base.addComponentProperty('X', 'VARIANT', 'a')).toThrow(
      'in addComponentProperty: Can only add variant property to a component set'
    )
    expect(() => set.editComponentProperty('Size', { defaultValue: 'lg' })).toThrow(
      'in editComponentProperty: Cannot change defaultValue of a variant property'
    )
    expect(() => set.editComponentProperty('Nope', { name: 'x' })).toThrow(
      'in editComponentProperty: Invalid variant property name'
    )
    expect(() => set.deleteComponentProperty('Size')).toThrow(
      'in deleteComponentProperty: Invalid component property name'
    )
    expect(names(set)).toEqual(['State=Default, Size=sm', 'State=Hover, Size=sm'])
  })

  test('renames that would break the set are refused, where Figma leaves the set in error', () => {
    const { set } = variants()
    set.addComponentProperty('Size', 'VARIANT', 'sm')
    expect(() => set.editComponentProperty('Size', { name: 'State' })).toThrow(
      'in editComponentProperty: Node already has a variant property with name State'
    )
    expect(() => set.editComponentProperty('Size', { name: '' })).toThrow(
      'Property name must not be empty'
    )
    expect(names(set)).toEqual(['State=Default, Size=sm', 'State=Hover, Size=sm'])
  })
})

// Recorded in Figma 126: an instance reads its own variant, as its main component names it.
test("an instance's componentProperties report its own variant", () => {
  const { hover } = variants()
  const instance = hover.createInstance()
  expect(instance.componentProperties.State?.value).toBe('Hover')
  expect(instance.componentProperties.State?.type).toBe('VARIANT')

  instance.setProperties({ State: 'Default' })
  expect(instance.componentProperties.State?.value).toBe('Default')
})

test('setting a variant property unbinds it from its variable', () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const base = figma.createComponent()
  base.name = 'State=Default'
  const hover = figma.createComponent()
  hover.name = 'State=Hover'
  const set = figma.combineAsVariants([base, hover], figma.currentPage)
  const instance = base.createInstance()
  const collection = graph.createCollection('States')
  const state = graph.createVariable('State', 'STRING', collection.id, 'Default')
  const [property] = graph.getNode(set.id)?.componentPropertyDefinitions ?? []
  graph.updateNode(instance.id, { variantBindings: { [property.id]: state.id } })

  instance.setProperties({ State: 'Hover' })

  expect(graph.getNode(instance.id)?.variantBindings).toEqual({})
})

function boundVariantInstance() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const base = figma.createComponent()
  base.name = 'State=Default'
  const hover = figma.createComponent()
  hover.name = 'State=Hover'
  const set = figma.combineAsVariants([base, hover], figma.currentPage)
  const other = figma.createComponent()
  const instance = base.createInstance()
  const collection = graph.createCollection('States')
  const state = graph.createVariable('State', 'STRING', collection.id, 'Default')
  const [property] = graph.getNode(set.id)?.componentPropertyDefinitions ?? []
  const bindings = { [property.id]: state.id }
  graph.updateNode(instance.id, { variantBindings: bindings })
  const bindingsOf = () => graph.getNode(instance.id)?.variantBindings
  return { base, hover, other, instance, bindings, bindingsOf }
}

for (const pick of ['base', 'hover'] as const) {
  test(`swapping to a variant of the set unbinds its variant properties, ${pick} shown or not`, () => {
    const variant = boundVariantInstance()
    variant.instance.swapComponent(variant[pick])

    expect(variant.bindingsOf()).toEqual({})
  })
}

test('swapping to a component outside the set unbinds its variant properties', () => {
  const { other, instance, bindingsOf } = boundVariantInstance()

  instance.swapComponent(other)

  expect(bindingsOf()).toEqual({})
})
