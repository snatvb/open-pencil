import { omit } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
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

export function laidOutAround(record: NodeChange, expandedComponent: GUID | undefined): boolean {
  return !expandedComponent || sameGuid(record.symbolData?.symbolID, expandedComponent)
}

export function placedRootRecord(
  source: NodeChange,
  raw: NodeChange,
  expandedComponent: GUID | undefined,
  sources: ReadonlyMap<string, NodeChange>
): NodeChange {
  if (source.type !== 'INSTANCE' || laidOutAround(raw, expandedComponent)) {
    return source
  }
  const original = raw.symbolData?.symbolID
  return swappedRootRecord(source, original && sources.get(guidToString(original)))
}
