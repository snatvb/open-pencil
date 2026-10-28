import { isEqual, omit } from 'es-toolkit'

import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { variableConsumptionEntries } from '../node-change/variable/bindings'
import { sameGuid } from './source-index'

const REPLACED_PAINT_FIELDS = ['fillPaints', 'styleIdForFill'] as const
const VARIABLE_MAP_FIELDS = ['variableConsumptionMap', 'parameterConsumptionMap'] as const

function ownVariableEntries(source: NodeChange, replaced: NodeChange) {
  const inherited = variableConsumptionEntries(replaced)
  return variableConsumptionEntries(source).filter(
    (entry) => !inherited.some((copy) => isEqual(copy, entry))
  )
}

function swappedRootRecord(source: NodeChange, replaced: NodeChange | undefined): NodeChange {
  const placed = omit(source, REPLACED_PAINT_FIELDS)
  if (!replaced) {
    return placed
  }
  const fields = omit(placed, VARIABLE_MAP_FIELDS)
  const entries = ownVariableEntries(source, replaced)
  return entries.length ? { ...fields, parameterConsumptionMap: { entries } } : fields
}

export function placedRootRecord(
  source: NodeChange,
  raw: NodeChange,
  expandedComponent: GUID | undefined,
  sources: ReadonlyMap<string, NodeChange>
): NodeChange {
  const original = raw.symbolData?.symbolID
  if (!expandedComponent || sameGuid(original, expandedComponent) || source.type !== 'INSTANCE') {
    return source
  }
  return swappedRootRecord(source, original && sources.get(guidToString(original)))
}
