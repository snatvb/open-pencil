import { expect, test } from 'bun:test'

import { expectDefined } from '#fig-tests/helpers/assert'
import {
  boundBadgeRecords,
  COMPACT_PANEL,
  LARGE_DOT,
  LARGE_DOT_DIGIT,
  PANEL,
  PANEL_BADGE,
  ROOMY_PANEL,
  SMALL_DOT
} from '#fig-tests/helpers/bound-variants'

import { materializeDocument } from '@open-pencil/fig'
import type { GUID } from '@open-pencil/kiwi/fig'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

function imported() {
  const { graph, sources } = materializeDocument(boundBadgeRecords())
  const layer = (id: GUID): SceneNode =>
    expectDefined(graph.getNode(expectDefined(sources.get(guidToString(id)))))
  return { graph, layer }
}

function badgeOf(graph: SceneGraph, panel: SceneNode): SceneNode {
  return expectDefined(graph.getNode(expectDefined(panel.childIds[0])))
}

function digitOf(graph: SceneGraph, badge: SceneNode): SceneNode {
  return expectDefined(graph.getNode(expectDefined(badge.childIds[0])))
}

test('an imported instance shows the variant its string variable picks in its mode', () => {
  const { graph, layer } = imported()
  const roomy = badgeOf(graph, layer(ROOMY_PANEL))
  const compact = badgeOf(graph, layer(COMPACT_PANEL))

  expect(roomy.componentId).toBe(layer(LARGE_DOT).id)
  expect(digitOf(graph, roomy).fontSize).toBe(20)
  expect(compact.componentId).toBe(layer(SMALL_DOT).id)
  expect(digitOf(graph, compact).fontSize).toBe(12)
})

test('a component definition keeps the variant it saved', () => {
  const { graph, layer } = imported()

  expect(badgeOf(graph, layer(PANEL)).componentId).toBe(layer(SMALL_DOT).id)
})

function importedWithSavedDigit() {
  const records = boundBadgeRecords().map((record) =>
    record.guid && guidToString(record.guid) === guidToString(ROOMY_PANEL)
      ? {
          ...record,
          derivedSymbolData: [
            {
              guidPath: { guids: [PANEL_BADGE, LARGE_DOT_DIGIT] },
              size: { x: 17, y: 21 },
              transform: { m00: 1, m01: 0, m02: 2, m10: 0, m11: 1, m12: 3 }
            }
          ]
        }
      : record
  )
  const { graph, sources } = materializeDocument(records)
  const layer = (id: GUID): SceneNode =>
    expectDefined(graph.getNode(expectDefined(sources.get(guidToString(id)))))
  const digit = () => digitOf(graph, badgeOf(graph, layer(ROOMY_PANEL)))
  return { graph, layer, digit }
}

test('layers of the variant a binding picks take the geometry the file saved for them', () => {
  const { digit } = importedWithSavedDigit()

  expect([digit().width, digit().height, digit().x, digit().y]).toEqual([17, 21, 2, 3])
})

test('a variant chosen after opening shows its own geometry, not the saved one', () => {
  const { graph, layer, digit } = importedWithSavedDigit()
  const badge = badgeOf(graph, layer(ROOMY_PANEL))
  graph.swapInstanceComponent(badge.id, layer(SMALL_DOT).id)
  graph.swapInstanceComponent(badge.id, layer(LARGE_DOT).id)

  expect([digit().width, digit().height]).toEqual([10, 20])
})
