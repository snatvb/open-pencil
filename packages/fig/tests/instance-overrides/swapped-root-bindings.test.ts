import { describe, expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { interpretInstance } from '#fig/instance-overrides/interpret'

import type { NodeChange, VariableConsumptionEntry } from '@open-pencil/kiwi/fig/codec'

const NARROW_WIDTH = guid(50)
const WIDE_WIDTH = guid(51)
const DIMMED = guid(52)

function binding(field: string, variable: typeof NARROW_WIDTH): VariableConsumptionEntry {
  return {
    variableField: field,
    variableData: {
      value: { alias: { guid: variable } },
      dataType: 'ALIAS',
      resolvedDataType: 'FLOAT'
    }
  }
}

function swappedLayer() {
  const changes = [
    {
      guid: guid(1),
      type: 'SYMBOL',
      name: 'Narrow',
      size: { x: 32, y: 24 },
      parameterConsumptionMap: { entries: [binding('WIDTH', NARROW_WIDTH)] }
    },
    {
      guid: guid(2),
      type: 'SYMBOL',
      name: 'Wide',
      size: { x: 64, y: 24 },
      parameterConsumptionMap: { entries: [binding('WIDTH', WIDE_WIDTH)] }
    },
    { guid: guid(3), type: 'SYMBOL', name: 'Row', size: { x: 200, y: 24 } },
    {
      guid: guid(4),
      type: 'INSTANCE',
      name: 'Value',
      parentIndex: { guid: guid(3), position: '!' },
      symbolData: { symbolID: guid(1) },
      size: { x: 32, y: 24 },
      parameterConsumptionMap: {
        entries: [binding('WIDTH', NARROW_WIDTH), binding('OPACITY', DIMMED)]
      }
    },
    {
      guid: guid(5),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(3),
        symbolOverrides: [{ guidPath: { guids: [guid(4)] }, overriddenSymbolID: guid(2) }]
      }
    }
  ] as NodeChange[]
  return interpretInstance(changes, '1:5').children[0]
}

describe('a layer swapped by an outer instance', () => {
  test('takes the bindings it only copied from the replaced component from the replacement', () => {
    const entries = swappedLayer().properties.parameterConsumptionMap?.entries ?? []
    expect(entries).toContainEqual(binding('WIDTH', WIDE_WIDTH))
    expect(entries).not.toContainEqual(binding('WIDTH', NARROW_WIDTH))
  })

  test('keeps a binding of its own', () => {
    const entries = swappedLayer().properties.parameterConsumptionMap?.entries ?? []
    expect(entries).toContainEqual(binding('OPACITY', DIMMED))
  })

  test('does not pin the size it saved around the replaced component', () => {
    const layer = swappedLayer()
    expect(layer.properties.size).toEqual({ x: 32, y: 24 })
    expect(layer.derivedSize).toBeUndefined()
  })
})
