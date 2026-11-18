import { describe, expect, test } from 'bun:test'

import {
  effectBindingScales,
  effectBindingScalesFromKiwi,
  effectBindingsFromKiwi,
  effectVariableAliases,
  kiwiEffectWithBindings
} from '#fig/node-change/variable/effects'

import type { Effect, VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import { guid } from '@open-pencil/test-support/fig/guid'

const SIZE = 4
const LIFT = 5

function alias(localID: number): VariableDataEntry {
  return { dataType: 'ALIAS', resolvedDataType: 'FLOAT', value: { alias: { guid: guid(localID) } } }
}

function expression(name: string, ...args: VariableDataEntry[]): VariableDataEntry {
  return {
    dataType: 'EXPRESSION',
    resolvedDataType: 'FLOAT',
    value: { expressionValue: { expressionFunction: name, expressionArguments: args } }
  }
}

function factor(value: number): VariableDataEntry {
  return { dataType: 'FLOAT', resolvedDataType: 'FLOAT', value: { floatValue: value } }
}

describe('effect bindings read from a .fig effect', () => {
  test('take a variable × number as a binding with its constant, in either order', () => {
    const effects: Effect[] = [
      {
        type: 'DROP_SHADOW',
        radiusVar: expression('MULTIPLY', alias(SIZE), factor(2)),
        yVar: expression('MULTIPLY', factor(0.5), alias(LIFT)),
        spreadVar: alias(SIZE)
      }
    ]

    expect(effectBindingsFromKiwi(effects)).toEqual({
      'effects/0/radius': '1:4',
      'effects/0/offsetY': '1:5',
      'effects/0/spread': '1:4'
    })
    expect(effectBindingScalesFromKiwi(effects)).toEqual({
      'effects/0/radius': 2,
      'effects/0/offsetY': 0.5
    })
  })

  test('skip an expression that is not a constant times one variable, without failing', () => {
    const effects: Effect[] = [
      {
        type: 'DROP_SHADOW',
        radiusVar: expression('ADDITION', alias(SIZE), factor(2)),
        yVar: expression('MULTIPLY', alias(SIZE), alias(LIFT))
      }
    ]

    expect(effectBindingsFromKiwi(effects)).toEqual({})
    expect(effectBindingScalesFromKiwi(effects)).toEqual({})
  })

  test('list the variables an expression names, for library resolution', () => {
    const effect: Effect = {
      type: 'DROP_SHADOW',
      radiusVar: expression('ADDITION', alias(SIZE), factor(2)),
      yVar: expression('MULTIPLY', factor(2), alias(LIFT))
    }

    expect(effectVariableAliases(effect)).toEqual([{ guid: guid(SIZE) }, { guid: guid(LIFT) }])
  })

  test('leave out the scale a scaled instance writes into its own effects', () => {
    const effects: Effect[] = [
      {
        type: 'DROP_SHADOW',
        radiusVar: expression('MULTIPLY', factor(1.5), alias(SIZE)),
        yVar: expression('MULTIPLY', factor(3), alias(LIFT))
      }
    ]

    expect(effectBindingScales(effectBindingScalesFromKiwi(effects), 1.5)).toEqual({
      'effects/0/offsetY': 2
    })
  })

  test('take a constant that is 1 up to float rounding as a plain alias', () => {
    const effects: Effect[] = [
      { type: 'DROP_SHADOW', radiusVar: expression('MULTIPLY', factor(1 - 1e-7), alias(SIZE)) }
    ]

    expect(effectBindingScalesFromKiwi(effects)).toEqual({})
    expect(effectBindingScales({ 'effects/0/radius': 49 }, 49 + 1e-7)).toEqual({})
  })
})

describe('effect bindings written to a .fig effect', () => {
  const bound = { 'effects/0/radius': '1:4', 'effects/0/offsetY': '1:5' }
  const write = (scales: Record<string, number>, ownScale: number) =>
    kiwiEffectWithBindings({ type: 'DROP_SHADOW' }, 0, bound, scales, ownScale, (id) => ({
      guid: guid(Number(id.split(':')[1]))
    }))

  test('write a plain alias, or the variable times its constant', () => {
    expect(write({ 'effects/0/offsetY': 0.5 }, 1)).toEqual({
      type: 'DROP_SHADOW',
      radiusVar: alias(SIZE),
      yVar: expression('MULTIPLY', factor(0.5), alias(LIFT))
    })
  })

  test('write a constant that is 1 up to float rounding as a plain alias', () => {
    const scale = 49
    expect((1 / scale) * scale).not.toBe(1)
    expect(write({ 'effects/0/radius': 1 / scale, 'effects/0/offsetY': 1 / scale }, scale)).toEqual(
      {
        type: 'DROP_SHADOW',
        radiusVar: alias(SIZE),
        yVar: alias(LIFT)
      }
    )
  })

  test('put a scaled instance’s own scale back into its constants', () => {
    expect(write({ 'effects/0/offsetY': 2 }, 1.5)).toEqual({
      type: 'DROP_SHADOW',
      radiusVar: expression('MULTIPLY', factor(1.5), alias(SIZE)),
      yVar: expression('MULTIPLY', factor(3), alias(LIFT))
    })
  })
})
