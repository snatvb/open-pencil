import { mapValues, omit, pickBy } from 'es-toolkit/object'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { Effect as KiwiEffect, VariableAliasValue } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import {
  EFFECT_BINDING_PROPERTIES,
  effectBindableProperties,
  effectBindingField,
  effectBindingTarget,
  effectBindingVariableType,
  type EffectBindingProperty
} from '@open-pencil/scene-graph/variables'

import { modeledEffectIndexes, modeledEffectType } from '../paint'
import {
  multipliedVariableData,
  representableLinearExpression,
  visitVariableReferences
} from './expression'

/** The field of a `.fig` effect that holds each property's variable alias. */
export const EFFECT_VARIABLE_FIELDS = {
  color: 'colorVar',
  radius: 'radiusVar',
  spread: 'spreadVar',
  offsetX: 'xVar',
  offsetY: 'yVar'
} as const satisfies Record<EffectBindingProperty, keyof KiwiEffect>

export interface EffectVariableBinding {
  reference: VariableAliasValue
  multiplier: number
}

export function effectVariableBinding(
  effect: KiwiEffect,
  property: EffectBindingProperty
): EffectVariableBinding | undefined {
  const expression = representableLinearExpression(effect[EFFECT_VARIABLE_FIELDS[property]])
  return expression?.reference
    ? { reference: expression.reference, multiplier: expression.multiplier }
    : undefined
}

/** The aliases a `.fig` effect binds its properties to, library references included. */
export function effectVariableAliases(effect: KiwiEffect): VariableAliasValue[] {
  const aliases: VariableAliasValue[] = []
  for (const property of EFFECT_BINDING_PROPERTIES) {
    visitVariableReferences(effect[EFFECT_VARIABLE_FIELDS[property]], (alias) =>
      aliases.push(alias)
    )
  }
  return aliases
}

interface ModeledEffectBinding {
  field: string
  guid: GUID
  multiplier: number
}

/**
 * The bindings of a record's effects by node binding field, such as `effects/0/radius`, skipping
 * one on a property the effect does not have, such as a blur's colour, and on an effect the scene
 * graph does not model. Indexes count only the modeled effects, as the node's do.
 */
function modeledEffectBindings(effects: readonly KiwiEffect[]): ModeledEffectBinding[] {
  const indexes = modeledEffectIndexes(effects)
  return effects.flatMap((effect, rawIndex) => {
    const index = indexes[rawIndex]
    const type = modeledEffectType(effect.type)
    if (index === null || !type) {
      return []
    }
    return effectBindableProperties(type).flatMap((property) => {
      const binding = effectVariableBinding(effect, property)
      const guid = binding?.reference.guid
      if (!binding || !guid) {
        return []
      }
      return [{ field: effectBindingField(index, property), guid, multiplier: binding.multiplier }]
    })
  })
}

export function effectBindingsFromKiwi(effects: readonly KiwiEffect[]): Record<string, string> {
  return Object.fromEntries(
    modeledEffectBindings(effects).map(({ field, guid }) => [field, guidToString(guid)])
  )
}

const FLOAT32_TOLERANCE = 1e-6

function isUnitMultiplier(multiplier: number): boolean {
  return Math.abs(multiplier - 1) <= FLOAT32_TOLERANCE
}

export function effectBindingScalesFromKiwi(
  effects: readonly KiwiEffect[] = []
): Record<string, number> {
  return Object.fromEntries(
    modeledEffectBindings(effects)
      .filter(({ multiplier }) => !isUnitMultiplier(multiplier))
      .map(({ field, multiplier }) => [field, multiplier])
  )
}

/**
 * Effect binding constants are not units, so a layout scale leaves them. Figma saves a scaled
 * instance's scale into its own effects' constants, which the component scale applies again.
 */
export function effectBindingScales(
  scales: Readonly<Partial<Record<string, number>>> = {},
  savedInstanceScale = 1
): Partial<Record<string, number>> {
  return pickBy(
    mapValues(
      pickBy(scales, (_, field) => !!effectBindingTarget(field)),
      (scale) => (scale ?? 1) / savedInstanceScale
    ),
    (scale) => !isUnitMultiplier(scale)
  )
}

/**
 * `effect` with the aliases the node's bindings give the effect at `index`, and none for a
 * property the node does not bind, so an imported alias the document dropped is not written back.
 */
export function kiwiEffectWithBindings(
  effect: KiwiEffect,
  index: number,
  boundVariables: Readonly<Record<string, string>>,
  bindingScales: Readonly<Partial<Record<string, number>>>,
  ownScale: number,
  alias: (variableId: string) => VariableAliasValue
): KiwiEffect {
  const next: KiwiEffect = omit(effect, Object.values(EFFECT_VARIABLE_FIELDS))
  for (const property of EFFECT_BINDING_PROPERTIES) {
    const field = effectBindingField(index, property)
    const variableId = boundVariables[field]
    if (!variableId) {
      continue
    }
    const aliasData = {
      dataType: 'ALIAS',
      resolvedDataType: effectBindingVariableType(property),
      value: { alias: alias(variableId) }
    }
    const multiplier = (bindingScales[field] ?? 1) * ownScale
    next[EFFECT_VARIABLE_FIELDS[property]] = isUnitMultiplier(multiplier)
      ? aliasData
      : multipliedVariableData(aliasData, multiplier)
  }
  return next
}
