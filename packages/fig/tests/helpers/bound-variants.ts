import { guid } from '#fig-tests/helpers/guid'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

export const DENSITY = guid(10)
export const COMPACT = guid(11)
export const ROOMY = guid(12)
export const SIZE_VARIABLE = guid(14)
export const SIZE_PROPERTY = guid(21)
export const SMALL_DOT = guid(30)
export const LARGE_DOT = guid(32)
export const LARGE_DOT_DIGIT = guid(33)
export const MEDIUM_DOT = guid(34)
export const LARGE_RING = guid(36)
export const PANEL = guid(40)
export const PANEL_BADGE = guid(41)
export const ROOMY_PANEL = guid(51)
export const COMPACT_PANEL = guid(53)

const under = (parent: GUID, position: string) => ({ guid: parent, position })

function modes(mode: GUID) {
  return { entries: [{ variableSetID: { guid: DENSITY }, variableModeID: mode }] }
}

function text(id: number, parent: GUID, fontSize: number): NodeChange {
  return {
    guid: guid(id),
    type: 'TEXT',
    name: 'Digit',
    parentIndex: under(parent, '!'),
    size: { x: 10, y: fontSize },
    fontSize,
    textData: { characters: '1' }
  }
}

function variant(id: number, name: string, fontSize: number, mode?: GUID): NodeChange[] {
  return [
    {
      guid: guid(id),
      type: 'SYMBOL',
      name,
      parentIndex: under(guid(20), String.fromCharCode(97 + id - 30)),
      size: { x: fontSize, y: fontSize },
      ...(mode ? { variableModeBySetMap: modes(mode) } : {})
    },
    text(id + 1, guid(id), fontSize)
  ]
}

export function sizeBinding(variable: GUID = SIZE_VARIABLE) {
  return {
    entries: [
      {
        variableField: 'VARIANT_PROPERTIES',
        variableData: {
          dataType: 'EXPRESSION',
          resolvedDataType: 'SYMBOL_ID',
          value: {
            expressionValue: {
              expressionFunction: 'RESOLVE_VARIANT',
              expressionArguments: [
                {
                  dataType: 'MAP',
                  resolvedDataType: 'MAP',
                  value: {
                    mapValue: {
                      values: [
                        {
                          key: 'Size',
                          guidKey: SIZE_PROPERTY,
                          value: {
                            dataType: 'ALIAS',
                            resolvedDataType: 'STRING',
                            value: { alias: { guid: variable } }
                          }
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      }
    ]
  }
}

function stringValue(textValue: string) {
  return { dataType: 'STRING', value: { textValue } }
}

function panelOccurrence(id: number, host: GUID): NodeChange {
  return {
    guid: guid(id),
    type: 'INSTANCE',
    name: 'Panel occurrence',
    parentIndex: under(host, String.fromCharCode(97 + id - 50)),
    size: { x: 40, y: 40 },
    symbolData: {
      symbolID: PANEL,
      symbolOverrides: [
        {
          guidPath: { guids: [PANEL_BADGE] },
          parameterConsumptionMap: sizeBinding()
        }
      ]
    }
  } as NodeChange
}

export function boundBadgeRecords(): NodeChange[] {
  return [
    { guid: guid(1), type: 'DOCUMENT', name: 'Document' },
    { guid: guid(2), type: 'CANVAS', name: 'Page', parentIndex: under(guid(1), '!') },
    {
      guid: guid(3),
      type: 'CANVAS',
      name: 'Internal',
      internalOnly: true,
      parentIndex: under(guid(1), '"')
    },
    {
      guid: DENSITY,
      type: 'VARIABLE_SET',
      name: 'Density',
      variableSetModes: [
        { id: COMPACT, name: 'Compact', sortPosition: 'a' },
        { id: ROOMY, name: 'Roomy', sortPosition: 'b' }
      ]
    },
    {
      guid: SIZE_VARIABLE,
      type: 'VARIABLE',
      name: 'Size',
      variableResolvedType: 'STRING',
      variableSetID: { guid: DENSITY },
      variableDataValues: {
        entries: [
          { modeID: COMPACT, variableData: stringValue('small') },
          {
            modeID: ROOMY,
            variableData: { dataType: 'ALIAS', value: { alias: { guid: guid(15) } } }
          }
        ]
      }
    },
    {
      guid: guid(15),
      type: 'VARIABLE',
      name: 'Large size',
      variableResolvedType: 'STRING',
      variableSetID: { guid: DENSITY },
      variableDataValues: {
        entries: [COMPACT, ROOMY].map((modeID) => ({
          modeID,
          variableData: stringValue('large')
        }))
      }
    },
    {
      guid: guid(20),
      type: 'FRAME',
      name: 'Badge',
      parentIndex: under(guid(3), '!'),
      size: { x: 100, y: 100 },
      componentPropDefs: [
        { id: SIZE_PROPERTY, name: 'Size', type: 'VARIANT' },
        { id: guid(22), name: 'Kind', type: 'VARIANT' }
      ]
    },
    ...variant(30, 'Kind=dot, Size=small', 12),
    ...variant(32, 'Kind=dot, Size=large', 20, ROOMY),
    ...variant(34, 'Kind=dot, Size=medium', 16),
    ...variant(36, 'Kind=ring, Size=large', 20, ROOMY),
    {
      guid: PANEL,
      type: 'SYMBOL',
      name: 'Panel',
      parentIndex: under(guid(3), '"'),
      size: { x: 40, y: 40 }
    },
    {
      guid: PANEL_BADGE,
      type: 'INSTANCE',
      name: 'Badge',
      parentIndex: under(PANEL, '!'),
      size: { x: 12, y: 12 },
      symbolData: { symbolID: SMALL_DOT }
    },
    {
      guid: guid(50),
      type: 'FRAME',
      name: 'Roomy host',
      parentIndex: under(guid(2), '!'),
      size: { x: 100, y: 100 },
      variableModeBySetMap: modes(ROOMY)
    },
    panelOccurrence(51, guid(50)),
    {
      guid: guid(52),
      type: 'FRAME',
      name: 'Compact host',
      parentIndex: under(guid(2), '"'),
      size: { x: 100, y: 100 }
    },
    panelOccurrence(53, guid(52))
  ] as NodeChange[]
}
