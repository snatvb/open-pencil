import {
  findStaticSegment,
  idOf,
  parentIdOf,
  recordMatches,
  type SourceIndex
} from '#fig/instance-overrides/source-index'
import { symbolDataOf, symbolOverridesOf } from '#fig/instance-overrides/types'
import { variantBindingsOf } from '#fig/node-change/variable/variants'
import { uniqBy } from 'es-toolkit/array'
import { isEmptyObject } from 'es-toolkit/predicate'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { NodeChange, VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { parseVariantName } from '@open-pencil/scene-graph/variant-name'

type ResolveReference = (reference: NodeChange['variableSetID']) => string | undefined

type VariantValues = Readonly<Record<string, string>>

const ANY_VALUE = 'any'

type PropertyValues = ReadonlySet<string> | typeof ANY_VALUE

interface BoundProperty {
  readonly name: string
  readonly values: PropertyValues
}

export interface VariantDependencyContext {
  readonly index: SourceIndex
  readonly whole: (record: NodeChange) => NodeChange
  readonly resolveReference: ResolveReference
}

const NO_VARIANTS: readonly string[] = []

function pathKey(guids: readonly GUID[]): string {
  return guids.map(guidToString).join('/')
}

function swapsByPath(record: NodeChange): Map<string, GUID> {
  const swaps = new Map<string, GUID>()
  for (const override of symbolOverridesOf(record)) {
    const guids = override.guidPath?.guids
    if (guids?.length && override.overriddenSymbolID) {
      swaps.set(pathKey(guids), override.overriddenSymbolID)
    }
  }
  return swaps
}

function variantMatches(
  values: VariantValues,
  shown: VariantValues,
  bound: readonly BoundProperty[]
): boolean {
  for (const { name, values: allowed } of bound) {
    if (!Object.hasOwn(values, name) || (allowed !== ANY_VALUE && !allowed.has(values[name]))) {
      return false
    }
  }
  const boundNames = new Set(bound.map(({ name }) => name))
  return Object.entries(shown).every(
    ([name, value]) => boundNames.has(name) || values[name] === value
  )
}

export function createVariantDependencies({
  index,
  whole,
  resolveReference
}: VariantDependencyContext) {
  const valuesByVariable = new Map<string, PropertyValues>()
  const variantsByBinding = new Map<string, readonly string[]>()

  const collectStrings = (id: string, visited: Set<string>, found: Set<string>): boolean => {
    if (visited.has(id)) {
      return true
    }
    visited.add(id)
    const header = index.sources.get(id)
    if (!header) {
      return false
    }
    return (whole(header).variableDataValues?.entries ?? []).every(({ variableData }) =>
      collectEntry(variableData, visited, found)
    )
  }

  const collectEntry = (
    entry: VariableDataEntry,
    visited: Set<string>,
    found: Set<string>
  ): boolean => {
    const type = entry.dataType ?? entry.resolvedDataType
    const text = entry.value?.textValue
    if (type === 'STRING' && text !== undefined) {
      found.add(text)
      return true
    }
    const alias = type === 'ALIAS' ? resolveReference(entry.value?.alias) : undefined
    return alias !== undefined && collectStrings(alias, visited, found)
  }

  const stringValues = (variableId: string): PropertyValues => {
    let values = valuesByVariable.get(variableId)
    if (!values) {
      const found = new Set<string>()
      values = collectStrings(variableId, new Set(), found) ? found : ANY_VALUE
      valuesByVariable.set(variableId, values)
    }
    return values
  }

  const propertyNames = (set: NodeChange): Map<string, string> => {
    const definitions = set.componentPropDefs as Array<{ id?: GUID; name?: string }> | undefined
    const names = new Map<string, string>()
    for (const { id, name } of definitions ?? []) {
      if (id && name) {
        names.set(guidToString(id), name)
      }
    }
    return names
  }

  const variantValues = (
    variant: NodeChange,
    names: ReadonlyMap<string, string>
  ): VariantValues => {
    if (variant.name?.includes('=')) {
      return parseVariantName(variant.name)
    }
    const specs = whole(variant).variantPropSpecs as
      | Array<{ propDefId?: GUID; value?: string }>
      | undefined
    const values: Record<string, string> = {}
    for (const { propDefId, value } of specs ?? []) {
      if (propDefId) {
        const id = guidToString(propDefId)
        values[names.get(id) ?? id] = value ?? ''
      }
    }
    return values
  }

  const selectVariants = (
    symbolId: string,
    bindings: Record<string, string>
  ): readonly string[] => {
    const shown = index.sources.get(symbolId)
    const setId = shown ? parentIdOf(shown) : undefined
    const setHeader = setId ? index.sources.get(setId) : undefined
    if (!shown || !setId || !setHeader) {
      return NO_VARIANTS
    }
    const names = propertyNames(whole(setHeader))
    const shownValues = variantValues(shown, names)
    const bound = Object.entries(bindings).map(([key, variableId]) => ({
      name: names.get(key) ?? key,
      values: stringValues(variableId)
    }))
    if (!bound.some(({ name }) => name in shownValues)) {
      return NO_VARIANTS
    }
    return (index.children.get(setId) ?? []).flatMap((variant) => {
      const id = idOf(variant)
      const selectable =
        id !== undefined &&
        id !== symbolId &&
        variant.type === 'SYMBOL' &&
        variantMatches(variantValues(variant, names), shownValues, bound)
      return selectable ? [id] : []
    })
  }

  const variantsFor = (symbol: GUID, bindings: Record<string, string>): readonly string[] => {
    const symbolId = guidToString(symbol)
    const key = `${symbolId}|${JSON.stringify(Object.entries(bindings).toSorted(([left], [right]) => left.localeCompare(right)))}`
    let variants = variantsByBinding.get(key)
    if (!variants) {
      variants = selectVariants(symbolId, bindings)
      variantsByBinding.set(key, variants)
    }
    return variants
  }

  const isVariantSet = (setId: string): boolean => {
    const header = index.sources.get(setId)
    if (!header || header.type === 'CANVAS') {
      return false
    }
    const set = whole(header)
    return (
      set.isStateGroup === true ||
      (Array.isArray(set.componentPropDefs) && set.componentPropDefs.length > 0)
    )
  }

  const siblingRecords = new Map<string, readonly NodeChange[]>()

  const recordsInSiblings = (
    symbolId: string,
    component: NodeChange,
    segment: GUID
  ): readonly NodeChange[] => {
    const key = `${symbolId}|${guidToString(segment)}`
    let found = siblingRecords.get(key)
    if (!found) {
      const setId = parentIdOf(component)
      const siblings = setId && isVariantSet(setId) ? (index.children.get(setId) ?? []) : []
      found = siblings.flatMap((sibling) => {
        const siblingId = sibling.type === 'SYMBOL' ? idOf(sibling) : undefined
        const record =
          siblingId && siblingId !== symbolId
            ? findStaticSegment(index, siblingId, segment).record
            : undefined
        return record ? [record] : []
      })
      siblingRecords.set(key, found)
    }
    return found
  }

  const segmentRecords = (
    symbolId: string,
    component: NodeChange,
    segment: GUID
  ): readonly NodeChange[] => {
    const { record, count } = findStaticSegment(index, symbolId, segment)
    if (record) {
      return [record]
    }
    return count === 0 ? recordsInSiblings(symbolId, component, segment) : []
  }

  const symbolsAtPath = (
    root: GUID,
    path: readonly GUID[],
    swaps: ReadonlyMap<string, GUID>
  ): GUID[] => {
    let symbols = [root]
    for (const [position, segment] of path.entries()) {
      const swapped = swaps.get(pathKey(path.slice(0, position + 1)))
      symbols = symbols.flatMap((symbol) => {
        const symbolId = guidToString(symbol)
        const component = index.sources.get(symbolId)
        if (!component) {
          return []
        }
        if (position === 0 && recordMatches(component, segment)) {
          return [symbol]
        }
        if (swapped) {
          return [swapped]
        }
        return segmentRecords(symbolId, component, segment).flatMap(
          (record) => symbolDataOf(whole(record))?.symbolID ?? []
        )
      })
    }
    return uniqBy(symbols, guidToString)
  }

  return (record: NodeChange): readonly string[] => {
    const root = symbolDataOf(record)?.symbolID
    if (record.type !== 'INSTANCE' || !root) {
      return NO_VARIANTS
    }
    const own = variantBindingsOf(record)
    const variants = isEmptyObject(own) ? [] : [...variantsFor(root, own)]
    let swaps: Map<string, GUID> | undefined
    for (const override of symbolOverridesOf(record)) {
      const bindings = variantBindingsOf(override)
      const path = override.guidPath?.guids
      if (isEmptyObject(bindings) || !path?.length) {
        continue
      }
      swaps ??= swapsByPath(record)
      const symbols = override.overriddenSymbolID
        ? [override.overriddenSymbolID]
        : symbolsAtPath(root, path, swaps)
      for (const symbol of symbols) {
        variants.push(...variantsFor(symbol, bindings))
      }
    }
    return variants
  }
}
