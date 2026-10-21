import type { SceneNode } from '@open-pencil/scene-graph'

import { mergeVariableConsumptionMaps } from '../variable/bindings'
import { variantBindingEntry } from '../variable/variants'
import {
  getOrCreatePropertyGuid,
  type KiwiNodeChange,
  type SceneNodeToKiwiContext
} from './context'

export function applyVariantBindings(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange,
  localIdCounter: { value: number }
): void {
  const entry = variantBindingEntry(node, context.graph, context.varIdToGuid, (definitionId) =>
    getOrCreatePropertyGuid(context, definitionId, localIdCounter)
  )
  if (entry) {
    Object.assign(
      nc,
      mergeVariableConsumptionMaps(nc, { parameterConsumptionMap: { entries: [entry] } })
    )
  }
}
