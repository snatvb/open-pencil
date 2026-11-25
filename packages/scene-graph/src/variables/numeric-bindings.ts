import { isEqual } from 'es-toolkit/predicate'

import type { SceneGraph } from '../graph'
import { hasInstanceOverride } from '../instances/overrides'
import { isStyleLengthField, pixelLength } from '../text/lengths'
import type { SceneNode, TextLength } from '../types'
import { NUMERIC_FIELDS } from './fields'
import {
  createStyleBindingLookup,
  effectiveBoundVariables,
  type TextStyleLookup,
  type VariableBindings
} from './style-bindings'

/** Fields a bound number sets as a length in pixels, as Figma's do, whatever unit they held. */
const TEXT_LENGTH_FIELDS: ReadonlySet<string> = new Set(['lineHeight', 'letterSpacing'])

/** Whether the instance a layer sits in, or the instance itself, overrides one of its fields. */
export function overriddenInInstance(graph: SceneGraph, nodeId: string, field: string): boolean {
  const instance = graph.closest(nodeId, (node) => node.type === 'INSTANCE')
  return !!instance && hasInstanceOverride(instance.instanceOverrides, instance.id, nodeId, field)
}

export function inheritedBindingScale(node: SceneNode, field: string): number {
  return isStyleLengthField(field) ? node.componentScale : 1
}

function bindingScale(node: SceneNode, field: string): number {
  if (field in node.boundVariables) {
    return node.variableBindingScales[field] ?? 1
  }
  return inheritedBindingScale(node, field)
}

/** A bound number as the field stores it. */
export function boundNumberValue(field: string, value: number): number | TextLength {
  return TEXT_LENGTH_FIELDS.has(field) ? pixelLength(value) : value
}

/**
 * The values a node's numeric bindings resolve to in its mode, in scene units, for the fields
 * whose stored value differs. A width or height an instance overrides keeps its own value.
 */
export function resolvedNumericBindings(
  graph: SceneGraph,
  node: SceneNode,
  styles: TextStyleLookup = createStyleBindingLookup(graph)
): Partial<SceneNode> {
  return resolvedNumbers(graph, node, effectiveBoundVariables(node, styles))
}

export function resolvedNumbers(
  graph: SceneGraph,
  node: SceneNode,
  bindings: VariableBindings
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = {}
  for (const [field, variableId] of Object.entries(bindings)) {
    if (!NUMERIC_FIELDS.has(field)) continue
    if ((field === 'width' || field === 'height') && overriddenInInstance(graph, node.id, field))
      continue
    const value = graph.resolveNumberVariableForNode(node.id, variableId)
    if (value === undefined || !Number.isFinite(value)) continue
    const effective = value * bindingScale(node, field)
    if (!Number.isFinite(effective)) continue
    const next = boundNumberValue(
      field,
      field === 'opacity' ? Math.max(0, Math.min(1, effective)) : effective
    )
    if (!isEqual(node[field as keyof SceneNode], next)) Object.assign(updates, { [field]: next })
  }
  return updates
}
