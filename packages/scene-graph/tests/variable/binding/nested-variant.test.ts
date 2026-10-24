import { expect, test } from 'bun:test'

import {
  instanceMainComponent,
  reconcileVariableBindings,
  recordInstanceOverride,
  SceneGraph,
  showBoundVariants,
  type SceneNode
} from '@open-pencil/scene-graph'

function nestedBadges() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const density = graph.createCollection('Density')
  const compact = density.defaultModeId
  const roomy = graph.createMode(density.id, 'Roomy') ?? ''
  const innerSize = graph.createVariable('Inner size', 'STRING', density.id, 'sm')
  innerSize.valuesByMode[roomy] = 'md'
  const outerSize = graph.createVariable('Outer size', 'STRING', density.id, 'large')
  const set = (name: string, property: string, values: string[]) => {
    const parent = graph.createNode('COMPONENT_SET', pageId, {
      name,
      componentPropertyDefinitions: [
        { id: property, name: 'Size', type: 'VARIANT', defaultValue: values[0] }
      ]
    })
    return values.map((value) =>
      graph.createNode('COMPONENT', parent.id, {
        name: `Size=${value}`,
        componentPropertyValues: { Size: value }
      })
    )
  }
  const [smallShield, mediumShield] = set('Shield', 'shield:size', ['sm', 'md'])
  for (const shield of [smallShield, mediumShield]) {
    graph.createNode('TEXT', shield.id, { name: 'Digit', text: '1', x: 1, y: 1 })
  }
  const [smallBadge, largeBadge] = set('Badge', 'badge:size', ['small', 'large'])
  const nested = (badge: SceneNode, shield: SceneNode) => {
    const copy = graph.createInstance(shield.id, badge.id, {
      name: 'Shield',
      variantBindings: { 'shield:size': innerSize.id }
    })
    if (!copy) throw new Error('Expected shield')
    return copy
  }
  nested(smallBadge, smallShield)
  const largeShield = nested(largeBadge, mediumShield)
  graph.updateNode(largeShield.id, { variableModes: { [density.id]: roomy } })
  const digitInLarge = graph.getChildren(largeShield.id)[0]
  graph.updateNode(digitInLarge.id, {
    x: 7,
    y: 3,
    width: 12,
    height: 11,
    derivedTextGlyphs: [{ commandsBlob: new Uint8Array([1, 2]), x: 0, y: 9, fontSize: 12 }]
  })
  const host = graph.createNode('FRAME', pageId, { variableModes: { [density.id]: compact } })
  const placed = graph.createInstance(smallBadge.id, host.id, {
    variantBindings: { 'badge:size': outerSize.id }
  })
  if (!placed) throw new Error('Expected badge')
  return { graph, placed, largeShield }
}

test('a nested copy whose binding picks what its new layer shows takes that layer as drawn', () => {
  const { graph, placed, largeShield } = nestedBadges()
  reconcileVariableBindings(graph)
  const shield = graph.getChildren(placed.id)[0]
  const digit = graph.getChildren(shield.id)[0]

  expect(shield.componentId).toBe(largeShield.id)
  expect([digit.x, digit.y]).toEqual([7, 3])
})

test('opening a file, a nested text drawn as its new layer takes the size and glyphs saved there', () => {
  const { graph, placed, largeShield } = nestedBadges()
  showBoundVariants(graph, [placed])
  const digit = graph.getChildren(graph.getChildren(placed.id)[0].id)[0]
  const saved = graph.getChildren(largeShield.id)[0]

  expect([digit.width, digit.height]).toEqual([12, 11])
  expect(digit.derivedTextGlyphs).toEqual(saved.derivedTextGlyphs)
})

test('a mode switch leaves the glyphs of a relinked text to be drawn again', () => {
  const { graph, placed } = nestedBadges()
  reconcileVariableBindings(graph)
  const digit = graph.getChildren(graph.getChildren(placed.id)[0].id)[0]

  expect(digit.derivedTextGlyphs).toBeNull()
})

function shieldsWithTone() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const density = graph.createCollection('Density')
  const roomy = graph.createMode(density.id, 'Roomy') ?? ''
  const innerSize = graph.createVariable('Inner size', 'STRING', density.id, 'sm')
  innerSize.valuesByMode[roomy] = 'md'
  const outerSize = graph.createVariable('Outer size', 'STRING', density.id, 'large')
  const shieldSet = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Shield',
    componentPropertyDefinitions: [
      { id: 'shield:size', name: 'Size', type: 'VARIANT', defaultValue: 'sm' },
      { id: 'shield:tone', name: 'Tone', type: 'VARIANT', defaultValue: 'blue' }
    ]
  })
  const shields = new Map<string, SceneNode>()
  for (const size of ['sm', 'md']) {
    for (const tone of ['blue', 'red']) {
      shields.set(
        `${size}/${tone}`,
        graph.createNode('COMPONENT', shieldSet.id, {
          name: `Size=${size}, Tone=${tone}`,
          componentPropertyValues: { Size: size, Tone: tone }
        })
      )
    }
  }
  const badgeSet = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Badge',
    componentPropertyDefinitions: [
      { id: 'badge:size', name: 'Size', type: 'VARIANT', defaultValue: 'small' }
    ]
  })
  const badge = (value: string, shield: string) => {
    const component = graph.createNode('COMPONENT', badgeSet.id, {
      name: `Size=${value}`,
      componentPropertyValues: { Size: value }
    })
    const nested = graph.createInstance(shields.get(shield)?.id ?? '', component.id, {
      name: 'Shield',
      variantBindings: { 'shield:size': innerSize.id }
    })
    if (!nested) throw new Error('Expected shield')
    return { component, nested }
  }
  const small = badge('small', 'md/blue')
  const large = badge('large', 'sm/red')
  const host = graph.createNode('FRAME', pageId, { variableModes: { [density.id]: roomy } })
  const placed = graph.createInstance(small.component.id, host.id, {
    variantBindings: { 'badge:size': outerSize.id }
  })
  if (!placed) throw new Error('Expected badge')
  return { graph, density, roomy, placed, large }
}

test('a copy follows its new layer when the binding agrees there, whatever else differs', () => {
  const { graph, density, roomy, placed, large } = shieldsWithTone()
  graph.updateNode(large.nested.id, { variableModes: { [density.id]: roomy } })
  reconcileVariableBindings(graph)
  const shield = graph.getChildren(placed.id)[0]

  expect(instanceMainComponent(graph, shield)?.name).toBe('Size=md, Tone=red')
})

test('opening a file, a copy that keeps its bound variant keeps its own saved layout', () => {
  const { graph, placed, large } = shieldsWithTone()
  graph.updateNode(large.nested.id, { derivedLayout: { width: 11, height: 11 } })
  const shield = graph.getChildren(placed.id)[0]
  graph.updateNode(shield.id, { derivedLayout: { width: 99, height: 99 } })
  showBoundVariants(graph, [placed])
  const kept = graph.getChildren(placed.id)[0]

  expect(instanceMainComponent(graph, kept)?.name).not.toBe('Size=sm, Tone=red')
  expect(kept.derivedLayout).toEqual({ width: 99, height: 99 })
})

test('a width set on a text copy survives a mode round trip that switches its variant', () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const theme = graph.createCollection('Theme')
  const dark = graph.createMode(theme.id, 'Dark') ?? ''
  const state = graph.createVariable('State', 'STRING', theme.id, 'Off')
  state.valuesByMode[dark] = 'On'
  const set = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Switch',
    componentPropertyDefinitions: [
      { id: 'state', name: 'State', type: 'VARIANT', defaultValue: 'Off' }
    ]
  })
  const variant = (value: string, width: number) => {
    const component = graph.createNode('COMPONENT', set.id, {
      name: `State=${value}`,
      componentPropertyValues: { State: value },
      width: 200,
      height: 50
    })
    graph.createNode('TEXT', component.id, {
      name: 'Label',
      text: 'Hi',
      textAutoResize: 'NONE',
      width,
      height: 20
    })
    return component
  }
  const off = variant('Off', 100)
  variant('On', 80)
  const host = graph.createNode('FRAME', pageId)
  const instance = graph.createInstance(off.id, host.id, { variantBindings: { state: state.id } })
  if (!instance) throw new Error('Expected switch')
  const label = () => graph.getChildren(instance.id)[0]
  graph.updateNode(label().id, { width: 150 })
  recordInstanceOverride(graph, label().id, ['width'])
  graph.updateNode(host.id, { variableModes: { [theme.id]: dark } })
  reconcileVariableBindings(graph)
  graph.updateNode(host.id, { variableModes: {} })
  reconcileVariableBindings(graph)

  expect(label().width).toBe(150)
})
