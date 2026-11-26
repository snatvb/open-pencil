import { beforeAll, describe, expect, test } from 'bun:test'

import { createAPI } from '#core-tests/helpers/figma-api'

import { FigmaAPI, type FigmaEffect } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'
import { registerTestFont } from '@open-pencil/test-support/fonts/bundled'
beforeAll(() => registerTestFont())

// Expected values and messages were recorded by running the same calls in Figma desktop.

const DROP = {
  type: 'DROP_SHADOW' as const,
  color: { r: 1, g: 0, b: 0, a: 1 },
  offset: { x: 1, y: 2 },
  radius: 3,
  spread: 4,
  visible: true,
  blendMode: 'NORMAL' as const
}

/** Light and Dark shadow tokens, as the probe in Figma set them up. */
function elevation() {
  const api = createAPI()
  const collection = api.variables.createVariableCollection('Elevation')
  const light = collection.defaultModeId
  const dark = collection.addMode('Dark')
  const color = api.variables.createVariable('shadowColor', collection, 'COLOR')
  color.setValueForMode(light, { r: 0, g: 0, b: 0.5, a: 0.25 })
  color.setValueForMode(dark, { r: 0, g: 0, b: 0, a: 0.6 })
  const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
  radius.setValueForMode(light, 8)
  radius.setValueForMode(dark, 24)
  const label = api.variables.createVariable('label', collection, 'STRING')
  return { api, collection, dark, color, radius, label }
}

const alias = (id: string) => ({ type: 'VARIABLE_ALIAS' as const, id })

function firstDropShadow(effects: readonly FigmaEffect[]) {
  const [effect] = effects
  if (effect?.type !== 'DROP_SHADOW') {
    throw new Error('expected the bound drop shadow')
  }
  return effect
}

describe('setBoundVariableForEffect', () => {
  test('returns a bound copy whose values are not resolved and whose spread reads 0', () => {
    const { api, color } = elevation()
    const bound = api.variables.setBoundVariableForEffect(DROP, 'color', color)

    expect(bound).toEqual({ ...DROP, spread: 0, boundVariables: { color: alias(color.id) } })
    expect(DROP).not.toHaveProperty('boundVariables')
    expect(api.variables.setBoundVariableForEffect(bound, 'color', null).boundVariables).toEqual({})
  })

  test('binding keeps the effect’s other bindings and null clears them all', () => {
    const { api, color, radius } = elevation()
    const both = api.variables.setBoundVariableForEffect(
      api.variables.setBoundVariableForEffect(DROP, 'color', color),
      'radius',
      radius
    )

    expect(both.boundVariables).toEqual({ color: alias(color.id), radius: alias(radius.id) })
    expect(api.variables.setBoundVariableForEffect(both, 'radius', null).boundVariables).toEqual({})
  })

  test('returns a copy that shares no aliases with the effect it was made from', () => {
    const { api, color, radius } = elevation()
    const bound = api.variables.setBoundVariableForEffect(DROP, 'color', color)
    const copy = api.variables.setBoundVariableForEffect(bound, 'radius', radius)
    const aliases = copy.boundVariables
    if (aliases && 'color' in aliases && aliases.color) aliases.color.id = radius.id

    expect(bound.boundVariables).toEqual({ color: alias(color.id) })
  })

  test('binds every shadow property and a blur’s radius only', () => {
    const { api, radius } = elevation()
    for (const field of ['radius', 'spread', 'offsetX', 'offsetY'] as const)
      expect(api.variables.setBoundVariableForEffect(DROP, field, radius).boundVariables).toEqual({
        [field]: alias(radius.id)
      })

    const blur = {
      type: 'LAYER_BLUR' as const,
      radius: 4,
      visible: true,
      blurType: 'NORMAL' as const
    }
    expect<unknown>(api.variables.setBoundVariableForEffect(blur, 'radius', radius)).toEqual({
      ...blur,
      boundVariables: { radius: alias(radius.id) }
    })
    expect(() => api.variables.setBoundVariableForEffect(blur, 'color', radius)).toThrow(
      'in setBoundVariableForEffect: Property "field" failed validation: Invalid input: expected "radius"'
    )
  })

  test('refuses other fields, the wrong variable type, and a variable ID', () => {
    const { api, color, radius, label } = elevation()
    const bind = (field: string, variable: unknown) => () =>
      Reflect.apply(api.variables.setBoundVariableForEffect, api.variables, [DROP, field, variable])

    expect(bind('offset', radius)).toThrow(
      'in setBoundVariableForEffect: Property "field" failed validation: Invalid option: expected one of "color"|"radius"|"spread"|"offsetX"|"offsetY"'
    )
    expect(bind('color', radius)).toThrow(
      'in setBoundVariableForEffect: can only bind color variables to color'
    )
    expect(bind('radius', color)).toThrow(
      'in setBoundVariableForEffect: can only bind float variables to radius'
    )
    expect(bind('offsetX', label)).toThrow(
      'in setBoundVariableForEffect: can only bind float variables to offsetX'
    )
    expect(bind('radius', radius.id)).toThrow(
      'in setBoundVariableForEffect: Expected node, got string'
    )
  })
})

describe('bound effects on a layer', () => {
  test('read resolved in the layer’s mode and carry their variables', () => {
    const { api, collection, dark, color, radius } = elevation()
    let effect = api.variables.setBoundVariableForEffect(DROP, 'color', color)
    effect = api.variables.setBoundVariableForEffect(effect, 'radius', radius)
    effect = api.variables.setBoundVariableForEffect(effect, 'offsetY', radius)
    const rect = api.createRectangle()
    rect.effects = [effect]
    const bindings = { color: alias(color.id), radius: alias(radius.id), offsetY: alias(radius.id) }

    expect(rect.effects).toEqual([
      {
        ...DROP,
        color: { r: 0, g: 0, b: 0.5, a: 0.25 },
        radius: 8,
        offset: { x: 1, y: 8 },
        spread: 0,
        boundVariables: bindings,
        showShadowBehindNode: true
      }
    ])
    expect(rect.boundVariables).toEqual({ effects: [alias(color.id), alias(radius.id)] })

    rect.setExplicitVariableModeForCollection(collection, dark)
    expect(rect.effects[0]).toMatchObject({
      color: { r: 0, g: 0, b: 0, a: 0.6 },
      radius: 24,
      offset: { x: 1, y: 24 }
    })
  })

  test('list each variable once, by ID, hidden effects included', () => {
    const { api, color, radius } = elevation()
    const rect = api.createRectangle()
    rect.effects = [
      { ...api.variables.setBoundVariableForEffect(DROP, 'radius', radius), visible: false },
      api.variables.setBoundVariableForEffect(DROP, 'color', color),
      api.variables.setBoundVariableForEffect(DROP, 'spread', radius)
    ]

    expect(rect.boundVariables).toEqual({ effects: [alias(color.id), alias(radius.id)] })
  })

  test('unbind when set without the reference, keeping the value', () => {
    const { api, collection, dark, radius } = elevation()
    const rect = api.createRectangle()
    rect.setExplicitVariableModeForCollection(collection, dark)
    rect.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', radius)]
    rect.effects = [api.variables.setBoundVariableForEffect(rect.effects[0], 'radius', null)]

    expect(rect.effects[0]).toMatchObject({ radius: 24, boundVariables: {} })
    expect(rect.boundVariables).toEqual({})
  })

  test('follow an effect style’s variables in the layer’s own mode', async () => {
    const { api, collection, dark, radius } = elevation()
    const style = api.createEffectStyle()
    style.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', radius)]
    const rect = api.createRectangle()
    await rect.setEffectStyleIdAsync(style.id)
    rect.setExplicitVariableModeForCollection(collection, dark)

    expect(rect.effects[0]).toMatchObject({
      radius: 24,
      boundVariables: { radius: alias(radius.id) }
    })
    expect(rect.boundVariables).toEqual({ effects: [alias(radius.id)] })

    await rect.setEffectStyleIdAsync('')
    expect(rect.boundVariables).toEqual({ effects: [alias(radius.id)] })
  })

  test('follow a style rebound to another variable of the same value', async () => {
    const { api, collection, radius } = elevation()
    const twin = api.variables.createVariable('twin', collection, 'FLOAT')
    twin.setValueForMode(collection.defaultModeId, 8)
    const style = api.createEffectStyle()
    style.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', radius)]
    const rect = api.createRectangle()
    await rect.setEffectStyleIdAsync(style.id)

    style.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', twin)]
    expect(rect.effects[0]).toMatchObject({ radius: 8, boundVariables: { radius: alias(twin.id) } })
    expect(rect.effectStyleId).toBe(style.id)

    twin.setValueForMode(collection.defaultModeId, 20)
    radius.setValueForMode(collection.defaultModeId, 50)
    expect(rect.effects[0]).toMatchObject({ radius: 20 })
    expect(rect.boundVariables).toEqual({ effects: [alias(twin.id)] })
  })

  describe('an effect style over a variable × number binding', () => {
    function doubledStyle(styleConstant: number | null) {
      const graph = new SceneGraph()
      const api = new FigmaAPI(graph)
      const collection = api.variables.createVariableCollection('Elevation')
      const dark = collection.addMode('Dark')
      const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
      radius.setValueForMode(collection.defaultModeId, 8)
      radius.setValueForMode(dark, 24)
      const shadow = api.variables.setBoundVariableForEffect(DROP, 'radius', radius)
      const style = api.createEffectStyle()
      style.effects = [shadow]
      const rect = api.createRectangle()
      rect.effects = [shadow]
      const styleNode = graph.getSharedStyleNode(style.id, 'EFFECT')
      if (!styleNode) {
        throw new Error('expected the style’s node')
      }
      graph.updateNode(rect.id, { variableBindingScales: { 'effects/0/radius': 2 } })
      if (styleConstant !== null) {
        graph.updateNode(styleNode.id, {
          variableBindingScales: { 'effects/0/radius': styleConstant }
        })
      }
      reconcileVariableBindings(graph)
      const radiusOf = () => rect.effects[0]?.type === 'DROP_SHADOW' && rect.effects[0].radius
      return { collection, dark, rect, style, radiusOf }
    }

    test('take the style’s plain alias in place of the layer’s multiple', async () => {
      const { collection, dark, rect, style, radiusOf } = doubledStyle(null)
      expect(radiusOf()).toBe(16)

      await rect.setEffectStyleIdAsync(style.id)

      expect(radiusOf()).toBe(8)
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radiusOf()).toBe(24)
    })

    test('take the style’s own multiple', async () => {
      const { collection, dark, rect, style, radiusOf } = doubledStyle(3)

      await rect.setEffectStyleIdAsync(style.id)

      expect(radiusOf()).toBe(24)
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radiusOf()).toBe(72)
    })
  })

  test('resolve in an instance’s mode', () => {
    const { api, collection, dark, color } = elevation()
    const component = api.createComponent()
    component.effects = [api.variables.setBoundVariableForEffect(DROP, 'color', color)]
    const instance = component.createInstance()
    instance.setExplicitVariableModeForCollection(collection, dark)

    expect(instance.effects[0].type === 'DROP_SHADOW' && instance.effects[0].color).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.6
    })
  })

  test('bind a set effect as a plain alias, whatever multiple was bound at its place', () => {
    const graph = new SceneGraph()
    const api = new FigmaAPI(graph)
    const collection = api.variables.createVariableCollection('Elevation')
    const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
    radius.setValueForMode(collection.defaultModeId, 8)
    const shadow = api.variables.setBoundVariableForEffect(DROP, 'radius', radius)
    const rect = api.createRectangle()
    rect.effects = [shadow, shadow]
    graph.updateNode(rect.id, { variableBindingScales: { 'effects/0/radius': 2 } })
    reconcileVariableBindings(graph)
    expect(rect.effects.map((effect) => effect.type === 'DROP_SHADOW' && effect.radius)).toEqual([
      16, 8
    ])

    rect.effects = [rect.effects[1]]

    expect(rect.effects[0]).toMatchObject({ radius: 8 })
    radius.setValueForMode(collection.defaultModeId, 10)
    expect(rect.effects[0]).toMatchObject({ radius: 10 })
  })

  describe('written back over a variable × number binding', () => {
    function doubled() {
      const graph = new SceneGraph()
      const api = new FigmaAPI(graph)
      const collection = api.variables.createVariableCollection('Elevation')
      const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
      radius.setValueForMode(collection.defaultModeId, 8)
      const rect = api.createRectangle()
      rect.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', radius)]
      graph.updateNode(rect.id, { variableBindingScales: { 'effects/0/radius': 2 } })
      reconcileVariableBindings(graph)
      const shadow = () => firstDropShadow(rect.effects)
      return { collection, radius, rect, shadow }
    }

    test('keep the multiple when the bound value is unchanged', () => {
      const { collection, radius, rect, shadow } = doubled()

      rect.effects = [{ ...shadow(), visible: false }]

      expect(rect.effects[0]).toMatchObject({ radius: 16, visible: false })
      radius.setValueForMode(collection.defaultModeId, 10)
      expect(rect.effects[0]).toMatchObject({ radius: 20 })
    })

    test('drop the multiple when the bound value changes', () => {
      const { collection, radius, rect, shadow } = doubled()

      rect.effects = [{ ...shadow(), radius: 5 }]

      radius.setValueForMode(collection.defaultModeId, 10)
      expect(rect.effects[0]).toMatchObject({ radius: 10 })
    })
  })

  describe('written back over a variable × number binding that differs by mode', () => {
    function doubledFirstOfTwo() {
      const graph = new SceneGraph()
      const api = new FigmaAPI(graph)
      const collection = api.variables.createVariableCollection('Elevation')
      const dark = collection.addMode('Dark')
      const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
      radius.setValueForMode(collection.defaultModeId, 8)
      radius.setValueForMode(dark, 24)
      const shadow = api.variables.setBoundVariableForEffect(DROP, 'radius', radius)
      const rect = api.createRectangle()
      rect.effects = [shadow, { ...shadow, spread: 1 }]
      graph.updateNode(rect.id, { variableBindingScales: { 'effects/0/radius': 2 } })
      reconcileVariableBindings(graph)
      const radii = () =>
        rect.effects.map((effect) => effect.type === 'DROP_SHADOW' && effect.radius)
      return { api, collection, dark, rect, radii }
    }

    test('keep the multiple with its effect when the effects come back reordered', () => {
      const { collection, dark, rect, radii } = doubledFirstOfTwo()
      expect(radii()).toEqual([16, 8])

      rect.effects = [...rect.effects].reverse()

      expect(radii()).toEqual([8, 16])
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radii()).toEqual([24, 48])
    })

    test('keep the multiple when only another field of its effect changes', () => {
      const { collection, dark, rect, radii } = doubledFirstOfTwo()

      const green = { r: 0, g: 1, b: 0, a: 1 }
      rect.effects = [{ ...firstDropShadow(rect.effects), color: green }, rect.effects[1]]

      expect(radii()).toEqual([16, 8])
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radii()).toEqual([48, 24])
    })

    test('drop the multiple when the bound field is written another number', () => {
      const { collection, dark, rect, radii } = doubledFirstOfTwo()

      rect.effects = [{ ...firstDropShadow(rect.effects), radius: 5 }, rect.effects[1]]

      expect(radii()).toEqual([8, 8])
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radii()).toEqual([24, 24])
    })

    test('drop the multiple when the field is bound to another variable', () => {
      const { api, collection, dark, rect, radii } = doubledFirstOfTwo()
      const twin = api.variables.createVariable('twin', collection, 'FLOAT')
      twin.setValueForMode(collection.defaultModeId, 8)
      twin.setValueForMode(dark, 24)

      const swapped = api.variables.setBoundVariableForEffect(rect.effects[0], 'radius', twin)
      rect.effects = [swapped, rect.effects[1]]

      expect(radii()).toEqual([8, 8])
      rect.setExplicitVariableModeForCollection(collection, dark)
      expect(radii()).toEqual([24, 24])
    })
  })

  describe('a variable × number binding reordered past an equal shadow', () => {
    function doubledBeside(twinBinding: 'unbound' | 'other variable') {
      const graph = new SceneGraph()
      const api = new FigmaAPI(graph)
      const collection = api.variables.createVariableCollection('Elevation')
      const radius = api.variables.createVariable('shadowRadius', collection, 'FLOAT')
      radius.setValueForMode(collection.defaultModeId, 8)
      const other = api.variables.createVariable('otherRadius', collection, 'FLOAT')
      other.setValueForMode(collection.defaultModeId, 16)
      const plain = { ...DROP, radius: 16, spread: 0 }
      const twin =
        twinBinding === 'unbound'
          ? plain
          : api.variables.setBoundVariableForEffect(plain, 'radius', other)
      const rect = api.createRectangle()
      rect.effects = [api.variables.setBoundVariableForEffect(DROP, 'radius', radius), twin]
      graph.updateNode(rect.id, { variableBindingScales: { 'effects/0/radius': 2 } })
      reconcileVariableBindings(graph)
      const radii = () =>
        rect.effects.map((effect) => effect.type === 'DROP_SHADOW' && effect.radius)
      return { collection, radius, other, rect, radii }
    }

    test('keeps the multiple on its effect when the twin is unbound', () => {
      const { collection, radius, rect, radii } = doubledBeside('unbound')
      expect(radii()).toEqual([16, 16])

      rect.effects = [...rect.effects].reverse()
      radius.setValueForMode(collection.defaultModeId, 10)

      expect(radii()).toEqual([16, 20])
    })

    test('keeps the multiple on its effect when the twin binds another variable', () => {
      const { collection, radius, other, rect, radii } = doubledBeside('other variable')
      expect(radii()).toEqual([16, 16])

      rect.effects = [...rect.effects].reverse()
      radius.setValueForMode(collection.defaultModeId, 10)
      other.setValueForMode(collection.defaultModeId, 12)

      expect(radii()).toEqual([12, 20])
    })
  })

  test('scale with an instance, whenever bound, and not with a plain layer', () => {
    const { api, collection, dark, radius } = elevation()
    const shadow = api.variables.setBoundVariableForEffect(DROP, 'radius', radius)
    const rect = api.createRectangle()
    rect.effects = [shadow]
    rect.rescale(2)
    rect.setExplicitVariableModeForCollection(collection, dark)
    expect(rect.effects[0]).toMatchObject({ radius: 24 })

    const component = api.createComponent()
    const child = api.createRectangle()
    component.appendChild(child)
    child.effects = [shadow]
    const instance = component.createInstance()
    instance.rescale(2)
    expect(instance.children[0].effects[0]).toMatchObject({ radius: 16 })
    instance.setExplicitVariableModeForCollection(collection, dark)
    expect(instance.children[0].effects[0]).toMatchObject({ radius: 48 })

    const scaled = component.createInstance()
    scaled.rescale(3)
    scaled.effects = [shadow]
    expect(scaled.effects[0]).toMatchObject({ radius: 24 })
  })
})
