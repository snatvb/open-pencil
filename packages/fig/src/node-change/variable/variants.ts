import { isEmptyObject } from 'es-toolkit/predicate'

import type { GUID, VariableConsumptionEntry, VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import {
  instanceVariant,
  variantPropertyDefinition,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  variableAlias,
  variableConsumptionEntries,
  type VariableConsumptionSource
} from './bindings'

const VARIANT_PROPERTIES_FIELD = 'VARIANT_PROPERTIES'
const RESOLVE_VARIANT = 'RESOLVE_VARIANT'

function consumesVariantProperties(map: unknown): boolean {
  if (typeof map !== 'object' || map === null || !('entries' in map)) {
    return false
  }
  const { entries } = map
  return (
    Array.isArray(entries) &&
    entries.some(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'variableField' in entry &&
        entry.variableField === VARIANT_PROPERTIES_FIELD
    )
  )
}

export function setsVariantBindings(source: VariableConsumptionSource): boolean {
  return (
    consumesVariantProperties(source.parameterConsumptionMap) ||
    consumesVariantProperties(source.variableConsumptionMap)
  )
}

export function variantBindingsOf(source: VariableConsumptionSource): Record<string, string> {
  return setsVariantBindings(source) ? collectVariantBindings(source) : {}
}

function collectVariantBindings(source: VariableConsumptionSource): Record<string, string> {
  const bindings: Record<string, string> = {}
  for (const entry of variableConsumptionEntries(source)) {
    const expression = entry.variableData?.value?.expressionValue
    if (
      entry.variableField !== VARIANT_PROPERTIES_FIELD ||
      expression?.expressionFunction !== RESOLVE_VARIANT
    ) {
      continue
    }
    const properties = expression.expressionArguments?.[0]?.value?.mapValue?.values ?? []
    for (const { key, guidKey, value } of properties) {
      const guid = value?.value?.alias?.guid
      const property = guidKey ? guidToString(guidKey) : key
      if (property && guid) {
        bindings[property] = guidToString(guid)
      }
    }
  }
  return bindings
}

export function variantBindingEntry(
  node: SceneNode,
  graph: SceneGraph,
  ids: ReadonlyMap<string, GUID> | undefined,
  propertyGuid: (propertyId: string) => GUID
): VariableConsumptionEntry | undefined {
  if (node.type !== 'INSTANCE' || isEmptyObject(node.variantBindings)) {
    return undefined
  }
  const set = instanceVariant(graph, node)?.set
  const values = Object.entries(node.variantBindings).flatMap(([key, variableId]) => {
    const variable = graph.variables.get(variableId)
    if (!variable) {
      return []
    }
    const definition = set ? variantPropertyDefinition(set, key) : undefined
    return [
      {
        key: definition?.name ?? key,
        ...(definition ? { guidKey: propertyGuid(definition.id) } : {}),
        value: {
          dataType: 'ALIAS',
          resolvedDataType: variable.type,
          value: { alias: variableAlias(graph, variableId, ids) }
        }
      }
    ]
  })
  return values.length === 0 ? undefined : resolveVariantEntry(values)
}

export function variantBindingsClaimEntry(
  node: SceneNode,
  graph: SceneGraph,
  ids: ReadonlyMap<string, GUID> | undefined,
  propertyGuid: (propertyId: string) => GUID
): VariableConsumptionEntry | undefined {
  if (node.type !== 'INSTANCE') {
    return undefined
  }
  return variantBindingEntry(node, graph, ids, propertyGuid) ?? resolveVariantEntry([])
}

type ResolvedProperty = NonNullable<
  NonNullable<NonNullable<VariableDataEntry['value']>['mapValue']>['values']
>[number]

function resolveVariantEntry(values: ResolvedProperty[]): VariableConsumptionEntry {
  return {
    variableField: VARIANT_PROPERTIES_FIELD,
    variableData: {
      dataType: 'EXPRESSION',
      resolvedDataType: 'SYMBOL_ID',
      value: {
        expressionValue: {
          expressionFunction: RESOLVE_VARIANT,
          expressionArguments: [
            { dataType: 'MAP', resolvedDataType: 'MAP', value: { mapValue: { values } } }
          ]
        }
      }
    }
  }
}
