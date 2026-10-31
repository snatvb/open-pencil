import {
  variableModeOverrideCollection,
  variableModeOverrideField,
  type InstanceOverrideState
} from '@open-pencil/scene-graph/instances/overrides'

function pastedField(field: string, collectionIds: ReadonlyMap<string, string>): string {
  const collection = variableModeOverrideCollection(field)
  const pasted = collection === undefined ? undefined : collectionIds.get(collection)
  return pasted === undefined ? field : variableModeOverrideField(pasted)
}

export function pastedOverrides(
  state: InstanceOverrideState,
  copiedIds: ReadonlyMap<string, string>,
  collectionIds: ReadonlyMap<string, string>
): InstanceOverrideState {
  const fields = (entries: ReadonlyMap<string, unknown>) =>
    new Map([...entries].map(([field, value]) => [pastedField(field, collectionIds), value]))
  return {
    self: fields(state.self),
    descendants: new Map(
      [...state.descendants].map(([target, entries]) => [
        copiedIds.get(target) ?? target,
        fields(entries)
      ])
    )
  }
}
