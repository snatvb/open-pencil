import { describe, expect, test } from 'bun:test'

import { materializeDocument } from '#fig/document/materialize'

import type { NodeChange, VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'
import { expectDefined } from '@open-pencil/test-support/assert'
import { guid } from '@open-pencil/test-support/fig/guid'

const COLLECTION = 3
const VARIABLE = 4
const FLAT = 10
const RAISED = 11
const INSTANCE_SCALE = 1.5

const VARIABLE_ALIAS: VariableDataEntry = {
  dataType: 'ALIAS',
  resolvedDataType: 'FLOAT',
  value: { alias: { guid: guid(VARIABLE) } }
}

function timesVariable(factor: number): VariableDataEntry {
  if (factor === 1) {
    return VARIABLE_ALIAS
  }
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

function shadow(factor: number, length: number) {
  return {
    type: 'DROP_SHADOW' as const,
    color: { r: 0, g: 0, b: 0, a: 0.5 },
    offset: { x: 0, y: length },
    radius: length,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL' as const,
    radiusVar: timesVariable(factor),
    yVar: timesVariable(factor)
  }
}

interface Cards {
  factor: number
  instanceWritesEffects: boolean
}

/** A component with a `factor` × variable shadow and a frame in Raised mode. */
function cardAndRaisedFrame(factor: number): NodeChange[] {
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
      variableResolvedType: 'FLOAT',
      variableSetID: { guid: guid(COLLECTION) },
      variableDataValues: {
        entries: [
          { modeID: guid(FLAT), variableData: { dataType: 'FLOAT', value: { floatValue: 4 } } },
          { modeID: guid(RAISED), variableData: { dataType: 'FLOAT', value: { floatValue: 10 } } }
        ]
      }
    },
    {
      guid: guid(5),
      type: 'SYMBOL',
      name: 'Card',
      size: { x: 100, y: 60 },
      parentIndex: { guid: guid(2), position: 'a' },
      effects: [shadow(factor, 4 * factor)]
    },
    {
      guid: guid(6),
      type: 'FRAME',
      size: { x: 300, y: 300 },
      parentIndex: { guid: guid(2), position: 'b' },
      variableModeBySetMap: {
        entries: [{ variableSetID: { guid: guid(COLLECTION) }, variableModeID: guid(RAISED) }]
      }
    }
  ] as NodeChange[]
}

function scaledCards({ factor, instanceWritesEffects }: Cards): NodeChange[] {
  return [
    ...cardAndRaisedFrame(factor),
    {
      guid: guid(7),
      type: 'INSTANCE',
      name: 'Scaled card',
      size: { x: 100 * INSTANCE_SCALE, y: 60 * INSTANCE_SCALE },
      parentIndex: { guid: guid(6), position: 'a' },
      symbolData: { symbolID: guid(5), uniformScaleFactor: INSTANCE_SCALE },
      ...(instanceWritesEffects && {
        effects: [shadow(factor * INSTANCE_SCALE, 4 * factor * INSTANCE_SCALE)]
      })
    }
  ] as NodeChange[]
}

describe.each([
  { factor: 2, instanceWritesEffects: true },
  { factor: 2, instanceWritesEffects: false },
  { factor: 1, instanceWritesEffects: true },
  { factor: 1, instanceWritesEffects: false }
])(
  'a scaled instance of a $factor × variable shadow, own effects $instanceWritesEffects',
  (cards) => {
    test('takes its scale once, in its mode', () => {
      const { graph, sources } = materializeDocument(scaledCards(cards))
      reconcileVariableBindings(graph)
      const node = (sourceId: string) =>
        expectDefined(graph.getNode(expectDefined(sources.get(sourceId), sourceId)), sourceId)
      const raised = 10 * cards.factor

      expect(node('1:5').effects[0]).toMatchObject({ radius: 4 * cards.factor })
      expect(node('1:7').variableBindingScales).toEqual(
        cards.factor === 1
          ? {}
          : { 'effects/0/radius': cards.factor, 'effects/0/offsetY': cards.factor }
      )
      expect(node('1:7').effects[0]).toMatchObject({
        radius: raised * INSTANCE_SCALE,
        offset: { x: 0, y: raised * INSTANCE_SCALE }
      })
    })
  }
)

const OUTER_SCALE = 2
const NESTED_CARD = 21

/**
 * A 1.5× card without effects of its own inside a holder, the holder placed 2× in Raised mode,
 * and the holder instance overriding the card's shadow with the card's own scale saved into it.
 */
function overriddenNestedCard(): NodeChange[] {
  return [
    ...cardAndRaisedFrame(1),
    {
      guid: guid(20),
      type: 'SYMBOL',
      name: 'Holder',
      size: { x: 200, y: 120 },
      parentIndex: { guid: guid(2), position: 'c' }
    },
    {
      guid: guid(NESTED_CARD),
      type: 'INSTANCE',
      size: { x: 100 * INSTANCE_SCALE, y: 60 * INSTANCE_SCALE },
      parentIndex: { guid: guid(20), position: 'a' },
      symbolData: { symbolID: guid(5), uniformScaleFactor: INSTANCE_SCALE }
    },
    {
      guid: guid(22),
      type: 'INSTANCE',
      size: { x: 200 * OUTER_SCALE, y: 120 * OUTER_SCALE },
      parentIndex: { guid: guid(6), position: 'a' },
      symbolData: {
        symbolID: guid(20),
        uniformScaleFactor: OUTER_SCALE,
        symbolOverrides: [
          {
            guidPath: { guids: [guid(NESTED_CARD)] },
            effects: [shadow(INSTANCE_SCALE, 4 * INSTANCE_SCALE)]
          }
        ]
      }
    }
  ] as NodeChange[]
}

test('an outer override of a nested scaled card takes the nested scale once', () => {
  const { graph, sources } = materializeDocument(overriddenNestedCard())
  reconcileVariableBindings(graph)
  const outer = expectDefined(sources.get('1:22'), 'outer holder')
  const card = expectDefined(graph.getChildren(outer)[0], 'nested card')
  const raised = 10 * INSTANCE_SCALE * OUTER_SCALE

  expect(card.variableBindingScales).toEqual({})
  expect(card.effects[0]).toMatchObject({ radius: raised, offset: { x: 0, y: raised } })
})
