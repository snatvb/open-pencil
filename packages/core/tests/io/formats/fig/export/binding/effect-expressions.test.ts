import { beforeAll, describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { materializeDocument, parseFigBuffer } from '@open-pencil/fig'
import { symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import { initCodec, type NodeChange, type VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'
import { expectDefined } from '@open-pencil/test-support/assert'
import { guid } from '@open-pencil/test-support/fig/guid'

const COLLECTION = 3
const VARIABLE = 4
const FLAT = 10
const RAISED = 11
const RAISED_VALUE = 10
const FACTOR = 2
const NESTED_SCALE = 1.5
const OUTER_SCALE = 2

const VARIABLE_ALIAS: VariableDataEntry = {
  dataType: 'ALIAS',
  resolvedDataType: 'FLOAT',
  value: { alias: { guid: guid(VARIABLE) } }
}

function timesVariable(factor: number): VariableDataEntry {
  return {
    dataType: 'EXPRESSION',
    resolvedDataType: 'FLOAT',
    value: {
      expressionValue: {
        expressionFunction: 'MULTIPLY',
        expressionArguments: [
          { dataType: 'FLOAT', resolvedDataType: 'FLOAT', value: { floatValue: factor } },
          VARIABLE_ALIAS
        ]
      }
    }
  }
}

function shadow(factor: number) {
  return {
    type: 'DROP_SHADOW' as const,
    color: { r: 0, g: 0, b: 0, a: 0.5 },
    offset: { x: 0, y: 4 * factor },
    radius: 4 * factor,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL' as const,
    radiusVar: timesVariable(factor),
    yVar: timesVariable(factor)
  }
}

type NestedEffects = 'own' | 'inherited' | 'outer override'

/**
 * A card with a 2 × variable shadow, placed 1.5× inside a holder component, and the holder placed
 * 2× in Raised mode. Effects the nested card writes, itself or through the holder instance's
 * override, carry the nested card's own scale in their constants.
 */
function nestedCards(nestedEffects: NestedEffects): NodeChange[] {
  const nestedOwnEffects = [shadow(FACTOR * NESTED_SCALE)]
  return [
    { guid: guid(1), type: 'DOCUMENT' },
    { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
    {
      guid: guid(COLLECTION),
      type: 'VARIABLE_SET',
      variableSetModes: [
        { id: guid(FLAT), name: 'Flat', sortPosition: 'a' },
        { id: guid(RAISED), name: 'Raised', sortPosition: 'b' }
      ]
    },
    {
      guid: guid(VARIABLE),
      type: 'VARIABLE',
      name: 'Elevation',
      variableResolvedType: 'FLOAT',
      variableSetID: { guid: guid(COLLECTION) },
      variableDataValues: {
        entries: [
          { modeID: guid(FLAT), variableData: { dataType: 'FLOAT', value: { floatValue: 4 } } },
          {
            modeID: guid(RAISED),
            variableData: { dataType: 'FLOAT', value: { floatValue: RAISED_VALUE } }
          }
        ]
      }
    },
    {
      guid: guid(5),
      type: 'SYMBOL',
      name: 'Card',
      size: { x: 100, y: 60 },
      parentIndex: { guid: guid(2), position: 'a' },
      effects: [shadow(FACTOR)]
    },
    {
      guid: guid(6),
      type: 'SYMBOL',
      name: 'Holder',
      size: { x: 200, y: 120 },
      parentIndex: { guid: guid(2), position: 'b' }
    },
    {
      guid: guid(7),
      type: 'INSTANCE',
      name: 'Nested card',
      size: { x: 100 * NESTED_SCALE, y: 60 * NESTED_SCALE },
      parentIndex: { guid: guid(6), position: 'a' },
      symbolData: { symbolID: guid(5), uniformScaleFactor: NESTED_SCALE },
      ...(nestedEffects === 'own' && { effects: nestedOwnEffects })
    },
    {
      guid: guid(8),
      type: 'FRAME',
      size: { x: 600, y: 600 },
      parentIndex: { guid: guid(2), position: 'c' },
      variableModeBySetMap: {
        entries: [{ variableSetID: { guid: guid(COLLECTION) }, variableModeID: guid(RAISED) }]
      }
    },
    {
      guid: guid(9),
      type: 'INSTANCE',
      name: 'Outer holder',
      size: { x: 200 * OUTER_SCALE, y: 120 * OUTER_SCALE },
      parentIndex: { guid: guid(8), position: 'a' },
      symbolData: {
        symbolID: guid(6),
        uniformScaleFactor: OUTER_SCALE,
        ...(nestedEffects === 'outer override' && {
          symbolOverrides: [{ guidPath: { guids: [guid(7)] }, effects: nestedOwnEffects }]
        })
      }
    }
  ] as NodeChange[]
}

function nestedCard(graph: SceneGraph) {
  const outer = expectDefined(
    [...graph.getAllNodes()].find((node) => node.name === 'Outer holder'),
    'Outer holder'
  )
  return expectDefined(graph.getChildren(outer.id)[0], 'nested card')
}

beforeAll(async () => {
  await initCodec()
})

describe.each<NestedEffects>(['own', 'inherited', 'outer override'])(
  'a recoloured 2 × variable shadow on a 1.5× card inside a 2× instance, %s effects',
  (nestedEffects) => {
    test('reopens with the same radius and offset', async () => {
      const { graph } = materializeDocument(nestedCards(nestedEffects))
      reconcileVariableBindings(graph)
      const expected = RAISED_VALUE * FACTOR * NESTED_SCALE * OUTER_SCALE
      const card = nestedCard(graph)
      expect(card.effects[0]).toMatchObject({ radius: expected, offset: { x: 0, y: expected } })
      createEditor({ graph }).updateNodeWithUndo(card.id, {
        effects: [{ ...card.effects[0], color: { r: 1, g: 0, b: 0, a: 0.5 } }]
      })

      const saved = parseFigBuffer(Uint8Array.from(await exportFigFile(graph)).buffer)
      const outer = expectDefined(
        saved.nodeChanges.find((record) => record.name === 'Outer holder'),
        'saved Outer holder'
      )
      const override = symbolOverridesOf(outer).find((record) => record.effects)
      expect(override).toMatchObject({
        effects: [{ radiusVar: timesVariable(FACTOR * NESTED_SCALE) }]
      })
      const reopened = materializeDocument(saved.nodeChanges, saved.blobs).graph
      reconcileVariableBindings(reopened)
      const reopenedCard = nestedCard(reopened)

      expect(reopenedCard.variableBindingScales).toMatchObject({ 'effects/0/radius': FACTOR })
      expect(reopenedCard.effects[0]).toMatchObject({
        color: { r: 1, g: 0, b: 0 },
        radius: expected,
        offset: { x: 0, y: expected }
      })
    })
  }
)

const DETACHED_SCALE = 2

function scaledCardInRaisedFrame(): NodeChange[] {
  const [document, canvas, collection, variable, card] = nestedCards('inherited')
  return [
    document,
    canvas,
    collection,
    variable,
    card,
    {
      guid: guid(20),
      type: 'ROUNDED_RECTANGLE',
      name: 'Badge',
      size: { x: 20, y: 20 },
      parentIndex: { guid: guid(5), position: 'a' },
      effects: [shadow(FACTOR)]
    },
    {
      guid: guid(8),
      type: 'FRAME',
      size: { x: 600, y: 600 },
      parentIndex: { guid: guid(2), position: 'c' },
      variableModeBySetMap: {
        entries: [{ variableSetID: { guid: guid(COLLECTION) }, variableModeID: guid(RAISED) }]
      }
    },
    {
      guid: guid(21),
      type: 'INSTANCE',
      name: 'Scaled card',
      size: { x: 100 * DETACHED_SCALE, y: 60 * DETACHED_SCALE },
      parentIndex: { guid: guid(8), position: 'a' },
      symbolData: { symbolID: guid(5), uniformScaleFactor: DETACHED_SCALE }
    }
  ] as NodeChange[]
}

function detachedLayers(graph: SceneGraph) {
  const frame = expectDefined(
    [...graph.getAllNodes()].find((node) => node.name === 'Scaled card'),
    'Scaled card'
  )
  return [frame, expectDefined(graph.getChildren(frame.id)[0], 'badge')]
}

test('a detached 2× card and its child keep their 2 × variable shadows through save', async () => {
  const { graph } = materializeDocument(scaledCardInRaisedFrame())
  reconcileVariableBindings(graph)
  const [card] = detachedLayers(graph)
  graph.detachInstance(card.id)
  const expected = RAISED_VALUE * FACTOR * DETACHED_SCALE
  for (const layer of detachedLayers(graph)) {
    expect(layer.effects[0]).toMatchObject({ radius: expected, offset: { x: 0, y: expected } })
  }

  const saved = parseFigBuffer(Uint8Array.from(await exportFigFile(graph)).buffer)
  const reopened = materializeDocument(saved.nodeChanges, saved.blobs).graph
  reconcileVariableBindings(reopened)

  for (const layer of detachedLayers(reopened)) {
    expect(layer.type).not.toBe('INSTANCE')
    expect(layer.effects[0]).toMatchObject({ radius: expected, offset: { x: 0, y: expected } })
  }
})
