import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected a value')
  }
  return value
}

function cardWithIcon() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const icon = (name: string, x: number, shape: string) => {
    const component = graph.createNode('COMPONENT', page, { name, x })
    graph.createNode('RECTANGLE', component.id, { name: shape, width: 4, height: 4 })
    return component
  }
  const iconA = icon('Icon A', 0, 'A shape')
  const iconB = icon('Icon B', 100, 'B shape')
  const iconC = icon('Icon C', 200, 'C shape')
  const card = graph.createNode('COMPONENT', page, { name: 'Card', x: 400 })
  const source = present(graph.createInstance(iconA.id, card.id, { name: 'Icon' }))
  const placed = present(graph.createInstance(card.id, page, { x: 800 }))
  const copy = present(graph.getChildren(placed.id)[0])
  const shapes = () => graph.getChildren(copy.id).map((node) => node.name)
  return { graph, iconB, iconC, card, source, copy, shapes }
}

describe('syncing a nested instance', () => {
  test('brings a copy to the component its source was switched to', () => {
    const { graph, iconB, card, source, copy, shapes } = cardWithIcon()

    graph.swapInstanceComponent(source.id, iconB.id)
    graph.syncInstances(card.id)

    expect(instanceMainComponent(graph, copy)?.id).toBe(iconB.id)
    expect(shapes()).toEqual(['B shape'])
  })

  test('keeps a copy swapped in the instance on its own component', () => {
    const { graph, iconB, iconC, card, source, copy, shapes } = cardWithIcon()
    graph.swapInstanceComponent(copy.id, iconC.id)

    graph.swapInstanceComponent(source.id, iconB.id)
    graph.syncInstances(card.id)

    expect(instanceMainComponent(graph, copy)?.id).toBe(iconC.id)
    expect(shapes()).toEqual(['C shape'])
  })

  test('leaves the link of a copy that shows what its source shows', () => {
    const { graph, card, copy } = cardWithIcon()
    const link = copy.componentId

    graph.syncInstances(card.id)

    expect(copy.componentId).toBe(link)
  })
})
