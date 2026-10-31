import type { SceneGraph } from '@open-pencil/scene-graph'
import { reconcileVariableBindings, type BindingScope } from '@open-pencil/scene-graph/variables'

import { computeLayout } from '#core/layout'

import { createLayoutRunner } from './mutations'
import { measurePropertyText } from './property-text'

/**
 * Binding evaluation is derived work, not an additional history entry. The scope names what
 * changed, so only the layers that change can reach are resolved and laid out again.
 */
export function reconcileVariableLayouts(graph: SceneGraph, scope: BindingScope): void {
  const { runLayoutForNode } = createLayoutRunner(() => graph)
  const changed = reconcileVariableBindings(graph, scope, {
    onVariantSwap: (instanceId, reapplied) => {
      for (const definition of reapplied) {
        measurePropertyText(graph, instanceId, definition)
      }
    }
  })
  for (const id of changed) {
    // A deliberate binding change also invalidates a placed instance's saved Hug size.
    computeLayout(graph, id)
    runLayoutForNode(id)
  }
}
