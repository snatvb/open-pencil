import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph } from '@open-pencil/scene-graph'

import { reconcileVariableLayouts } from '#core/layout/variables'
import { fontManager } from '#core/text/font/manager'

beforeAll(async () => {
  await fontManager.markLoaded(
    'Inter',
    'Regular',
    expectDefined(await fontManager.fetchBundledFont('/InterVariable.ttf'), 'bundled Inter font')
  )
})

test('text a property assigns is measured again in the variant a binding switches to', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Density')
  const roomy = expectDefined(graph.createMode(collection.id, 'Roomy'))
  const scale = graph.createVariable('Scale', 'STRING', collection.id, 'tight')
  scale.valuesByMode[roomy] = 'loose'
  const set = graph.createNode('COMPONENT_SET', page, {
    componentPropertyDefinitions: [
      { id: 'prop:scale', name: 'Scale', type: 'VARIANT', defaultValue: 'tight' },
      { id: 'prop:label', name: 'Label', type: 'TEXT', defaultValue: 'Hi' }
    ]
  })
  const variant = (value: string, y: number) => {
    const component = graph.createNode('COMPONENT', set.id, {
      name: `Scale=${value}`,
      y,
      componentPropertyValues: { Scale: value }
    })
    graph.createNode('TEXT', component.id, {
      name: 'Label',
      text: 'Hi',
      width: 12,
      height: 15,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      componentPropertyReferences: [{ propertyId: 'prop:label', field: 'TEXT' }]
    })
    return component
  }
  const tight = variant('tight', 0)
  variant('loose', 100)
  const frame = graph.createNode('FRAME', page, { x: 500 })
  const chip = expectDefined(
    graph.createInstance(tight.id, frame.id, {
      variantBindings: { 'prop:scale': scale.id },
      componentPropertyAssignments: { 'prop:label': 'A much longer label' }
    })
  )

  graph.updateNode(frame.id, { variableModes: { [collection.id]: roomy } })
  reconcileVariableLayouts(graph, { subtrees: [frame.id] })

  const label = expectDefined(graph.getChildren(chip.id)[0])
  expect(label.text).toBe('A much longer label')
  expect(label.width).toBeGreaterThan(60)
})
