import { expect, test } from 'bun:test'

import { assignNamedProperties } from '#design-jsx/component-properties'

import { SceneGraph } from '@open-pencil/scene-graph'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'

function boundIconPanel() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
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
  const [small, medium] = ['small', 'medium', 'large'].map((value) =>
    graph.createNode('COMPONENT', set.id, {
      name: `Size=${value}`,
      componentPropertyValues: { Size: value }
    })
  )
  const panel = graph.createNode('COMPONENT', pageId, {
    name: 'Panel',
    componentPropertyDefinitions: [
      { id: '9:1', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: small.id }
    ]
  })
  const icon = graph.createInstance(small.id, panel.id, {
    name: 'Icon',
    variantBindings: { '8:1': size.id }
  })
  if (!icon) throw new Error('Expected icon')
  graph.updateNode(icon.id, {
    componentPropertyReferences: [{ propertyId: '9:1', field: 'INSTANCE_SWAP' }]
  })
  const host = graph.createNode('FRAME', pageId, { name: 'Host' })
  const instance = graph.createInstance(panel.id, host.id)
  if (!instance) throw new Error('Expected instance')
  const switchToRoomy = () => {
    graph.updateNode(host.id, { variableModes: { [collection.id]: roomy } })
    reconcileVariableBindings(graph)
  }
  return { graph, instance, medium, switchToRoomy }
}

test('a swap prop on a variant-bound layer unbinds it, so a mode switch keeps the choice', () => {
  const { graph, instance, medium, switchToRoomy } = boundIconPanel()
  assignNamedProperties(graph, instance, { Icon: medium.id }, (id) => id)
  switchToRoomy()
  const icon = graph.getChildren(instance.id)[0]

  expect(instanceMainComponent(graph, icon)?.name).toBe('Size=medium')
  expect(icon.variantBindings).toEqual({})
})
