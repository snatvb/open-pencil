import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#fig-tests/helpers/assert'
import { sceneNodeToKiwi, variantBindingsOf } from '#fig/node-change/index'

import type { NodeChange, VariableConsumptionEntry } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function chipFile() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Density')
  const scale = graph.createVariable('Scale', 'STRING', collection.id, 'tight')
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Chip',
    componentPropertyDefinitions: [
      { id: '7:1', name: 'Scale', type: 'VARIANT', defaultValue: 'tight' }
    ]
  })
  const tight = graph.createNode('COMPONENT', set.id, {
    name: 'Scale=tight',
    width: 40,
    height: 20,
    componentPropertyValues: { Scale: 'tight' }
  })
  const bind = (parentId: string) =>
    expectDefined(
      graph.createInstance(tight.id, parentId, { variantBindings: { '7:1': scale.id } })
    )
  return { graph, page, scale, set, bind }
}

function records(graph: SceneGraph, node: SceneNode): NodeChange[] {
  return sceneNodeToKiwi(node, { sessionID: 1, localID: 1 }, 0, { value: 2 }, graph, [])
}

function variantEntry(record: NodeChange | undefined): VariableConsumptionEntry | undefined {
  return record?.parameterConsumptionMap?.entries?.find(
    (entry) => entry.variableField === 'VARIANT_PROPERTIES'
  )
}

function boundProperty(entry: VariableConsumptionEntry | undefined) {
  const expression = entry?.variableData?.value?.expressionValue
  return expectDefined(expression?.expressionArguments?.[0]?.value?.mapValue?.values?.at(0))
}

describe('variant bindings in .fig records', () => {
  test('are written as Figma resolves them, keyed by the property', () => {
    const { graph, page, scale, bind } = chipFile()
    const chip = bind(page)

    const entry = variantEntry(records(graph, chip)[0])

    expect(entry?.variableData?.value?.expressionValue?.expressionFunction).toBe('RESOLVE_VARIANT')
    const property = boundProperty(entry)
    expect(property.key).toBe('Scale')
    expect(guidToString(expectDefined(property.guidKey))).toBe('7:1')
    expect(guidToString(expectDefined(property.value?.value?.alias?.guid))).toBe(scale.id)
  })

  test('are read back by the property they name', () => {
    const { graph, page, scale, bind } = chipFile()

    const [record] = records(graph, bind(page))

    expect(variantBindingsOf(expectDefined(record))).toEqual({ '7:1': scale.id })
  })

  test('are read by property name when the record names no property', () => {
    const { graph, page, scale, bind } = chipFile()
    const [record] = records(graph, bind(page))
    delete boundProperty(variantEntry(record)).guidKey

    expect(variantBindingsOf(expectDefined(record))).toEqual({ Scale: scale.id })
  })

  test('follow a renamed property', () => {
    const { graph, page, set, bind } = chipFile()
    const chip = bind(page)
    graph.updateNode(set.id, {
      componentPropertyDefinitions: [
        { id: '7:1', name: 'Density', type: 'VARIANT', defaultValue: 'tight' }
      ]
    })

    const property = boundProperty(variantEntry(records(graph, chip)[0]))

    expect(property.key).toBe('Density')
    expect(guidToString(expectDefined(property.guidKey))).toBe('7:1')
  })

  test('are written only for instances', () => {
    const { graph, page, scale } = chipFile()
    const frame = graph.createNode('FRAME', page, { variantBindings: { '7:1': scale.id } })

    expect(variantEntry(records(graph, frame)[0])).toBeUndefined()
  })
})
