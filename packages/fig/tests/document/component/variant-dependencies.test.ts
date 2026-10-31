import { expect, test } from 'bun:test'

import {
  boundBadgeRecords,
  LARGE_DOT,
  LARGE_RING,
  MEDIUM_DOT,
  PANEL_BADGE,
  ROOMY_PANEL,
  SIZE_PROPERTY,
  sizeBinding,
  SMALL_DOT
} from '#fig-tests/helpers/bound-variants'
import { guid } from '#fig-tests/helpers/guid'
import { collectSceneDependencies } from '#fig/document/dependency-closure'
import { createSourceIndex } from '#fig/instance-overrides/source-index'
import { symbolOverridesOf } from '#fig/instance-overrides/types'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

function loaded(changes: NodeChange[]): (id: GUID) => boolean {
  const { contentIds } = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  return (id) => contentIds.has(guidToString(id))
}

function isRecord(record: NodeChange, id: GUID): boolean {
  return record.guid !== undefined && guidToString(record.guid) === guidToString(id)
}

function withoutOverrideBindings(changes: NodeChange[]): NodeChange[] {
  return changes.map((record) =>
    record.type === 'INSTANCE' && record.symbolData
      ? { ...record, symbolData: { symbolID: record.symbolData.symbolID } }
      : record
  )
}

test('loads the variants a bound string variable can pick and no others', () => {
  const isLoaded = loaded(boundBadgeRecords())

  expect(isLoaded(SMALL_DOT)).toBe(true)
  expect(isLoaded(LARGE_DOT)).toBe(true)
  expect(isLoaded(MEDIUM_DOT)).toBe(false)
  expect(isLoaded(LARGE_RING)).toBe(false)
})

test('loads no other variant for an instance without a variant binding', () => {
  const isLoaded = loaded(withoutOverrideBindings(boundBadgeRecords()))

  expect(isLoaded(SMALL_DOT)).toBe(true)
  expect(isLoaded(LARGE_DOT)).toBe(false)
})

test('follows a binding a component sets on its own nested instance', () => {
  const changes = withoutOverrideBindings(boundBadgeRecords()).map((record) =>
    isRecord(record, PANEL_BADGE)
      ? ({ ...record, parameterConsumptionMap: sizeBinding() } as NodeChange)
      : record
  )

  expect(loaded(changes)(LARGE_DOT)).toBe(true)
})

test('loads nothing more when no variant has a value the variable takes', () => {
  const changes = boundBadgeRecords().map((record) =>
    record.name === 'Large size'
      ? {
          ...record,
          variableDataValues: {
            entries: (record.variableDataValues?.entries ?? []).map(({ modeID }) => ({
              modeID,
              variableData: { dataType: 'STRING', value: { textValue: 'huge' } }
            }))
          }
        }
      : record
  )

  expect(loaded(changes)(LARGE_DOT)).toBe(false)
})

const HALO = guid(38)
const SMALL_HALO = guid(71)
const LARGE_HALO = guid(72)

function withHaloInLargeDot(changes: NodeChange[]): NodeChange[] {
  const halo = (id: GUID, name: string, position: string): NodeChange => ({
    guid: id,
    type: 'SYMBOL',
    name,
    parentIndex: { guid: guid(70), position }
  })
  const bindsHalo = (record: NodeChange): NodeChange =>
    ({
      ...record,
      symbolData: {
        ...record.symbolData,
        symbolOverrides: [
          ...symbolOverridesOf(record),
          { guidPath: { guids: [PANEL_BADGE, HALO] }, parameterConsumptionMap: sizeBinding() }
        ]
      }
    }) as NodeChange
  return [
    ...changes.map((record) => (isRecord(record, ROOMY_PANEL) ? bindsHalo(record) : record)),
    {
      guid: guid(70),
      type: 'FRAME',
      name: 'Halo',
      parentIndex: { guid: guid(3), position: '#' },
      componentPropDefs: [{ id: SIZE_PROPERTY, name: 'Size', type: 'VARIANT' }]
    } as NodeChange,
    halo(SMALL_HALO, 'Size=small', 'a'),
    halo(LARGE_HALO, 'Size=large', 'b'),
    {
      guid: HALO,
      type: 'INSTANCE',
      name: 'Halo',
      parentIndex: { guid: LARGE_DOT, position: 'b' },
      symbolData: { symbolID: LARGE_HALO }
    }
  ]
}

test('follows a binding addressed to a layer of a variant the variable picks', () => {
  expect(loaded(withHaloInLargeDot(boundBadgeRecords()))(SMALL_HALO)).toBe(true)
})
