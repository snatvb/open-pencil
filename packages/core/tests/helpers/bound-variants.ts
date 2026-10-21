import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor } from '@open-pencil/core/editor'

export function boundChip(depth = 0, fanOut = 1) {
  const editor = createEditor()
  const { graph } = editor
  const page = editor.state.currentPageId
  const collection = graph.createCollection('Density')
  const compact = collection.defaultModeId
  const roomy = expectDefined(graph.createMode(collection.id, 'Roomy'))
  const scale = graph.createVariable('Scale', 'STRING', collection.id, 'tight')
  scale.valuesByMode[roomy] = 'loose'
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Chip',
    componentPropertyDefinitions: [
      { id: 'prop:scale', name: 'Scale', type: 'VARIANT', defaultValue: 'tight' }
    ]
  })
  const variant = (value: string, y: number, width: number) => {
    const component = graph.createNode('COMPONENT', set.id, {
      name: `Scale=${value}`,
      y,
      width,
      height: 20,
      componentPropertyValues: { Scale: value }
    })
    graph.createNode('RECTANGLE', component.id, { name: 'Background', width, height: 20 })
    let parentId = component.id
    for (let level = 0; level < depth; level++) {
      let lastId = parentId
      for (let sibling = 0; sibling < fanOut; sibling++) {
        lastId = graph.createNode('FRAME', parentId, { name: 'Frame', width, height: 20 }).id
      }
      parentId = lastId
    }
    return component
  }
  const tight = variant('tight', 0, 40)
  const loose = variant('loose', 100, 80)
  const frame = graph.createNode('FRAME', page, { x: 500 })
  const chip = expectDefined(
    graph.createInstance(tight.id, frame.id, { variantBindings: { 'prop:scale': scale.id } })
  )
  const background = () => expectDefined(graph.getChildren(chip.id)[0])
  const setMode = (modeId: string) =>
    editor.updateNodeWithUndo(frame.id, { variableModes: { [collection.id]: modeId } })
  const deepest = () => {
    let node = chip
    for (let level = 0; level < depth; level++) {
      node = expectDefined(graph.getChildren(node.id).at(-1))
    }
    return node
  }
  return {
    editor,
    graph,
    collection,
    scale,
    compact,
    roomy,
    tight,
    loose,
    chip,
    frame,
    background,
    deepest,
    setMode
  }
}

export function withOwnLayers() {
  const chip = boundChip()
  chip.graph.createNode('RECTANGLE', chip.tight.id, { name: 'Badge', width: 4, height: 4 })
  chip.graph.createNode('RECTANGLE', chip.loose.id, { name: 'Icon', width: 8, height: 8 })
  chip.graph.syncInstance(chip.chip.id)
  return chip
}

export function layerNamed(
  graph: ReturnType<typeof createEditor>['graph'],
  parentId: string,
  name: string
) {
  return expectDefined(graph.getChildren(parentId).find((node) => node.name === name))
}

export function badgedCard() {
  const editor = createEditor()
  const { graph } = editor
  const page = editor.state.currentPageId
  const density = graph.createCollection('Density')
  const roomy = expectDefined(graph.createMode(density.id, 'Roomy'))
  const size = graph.createVariable('Size', 'STRING', density.id, 'S')
  size.valuesByMode[roomy] = 'L'
  const badges = graph.createNode('COMPONENT_SET', page, {
    name: 'Badge',
    componentPropertyDefinitions: [
      { id: 'prop:size', name: 'Size', type: 'VARIANT', defaultValue: 'S' }
    ]
  })
  const small = graph.createNode('COMPONENT', badges.id, {
    name: 'Size=S',
    componentPropertyValues: { Size: 'S' }
  })
  graph.createNode('RECTANGLE', small.id, { name: 'Dot', width: 4, height: 4 })
  graph.createNode('RECTANGLE', small.id, { name: 'Ring', width: 2, height: 2 })
  const large = graph.createNode('COMPONENT', badges.id, {
    name: 'Size=L',
    y: 50,
    componentPropertyValues: { Size: 'L' }
  })
  graph.createNode('RECTANGLE', large.id, { name: 'Dot', width: 8, height: 8 })
  const card = graph.createNode('COMPONENT', page, { name: 'Card', x: 300 })
  const source = expectDefined(
    graph.createInstance(small.id, card.id, {
      name: 'Badge',
      variantBindings: { 'prop:size': size.id }
    })
  )
  const placed = expectDefined(graph.createInstance(card.id, page, { x: 900 }))
  const badge = expectDefined(graph.getChildren(placed.id)[0])
  const dotWidth = () => expectDefined(graph.getChildren(badge.id)[0]).width
  return {
    editor,
    graph,
    density,
    roomy,
    compact: density.defaultModeId,
    card,
    source,
    large,
    badge,
    dotWidth
  }
}
