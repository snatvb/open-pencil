import { isEqual } from 'es-toolkit/predicate'

import type { SceneGraph } from '../graph'
import { hasInstanceOverride } from '../instances/overrides'
import { isTextStyleLength } from '../scaling/node'
import { pixelLength } from '../text/lengths'
import type { SceneNode, StyleRun, TextLength } from '../types'
import { NUMERIC_FIELDS } from './fields'
import {
  createStyleBindingLookup,
  effectiveBoundVariables,
  effectiveRunBoundVariables,
  inheritedTextStyleBindings,
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

function lengthScale(field: string, componentScale: number): number {
  return isTextStyleLength(field) ? componentScale : 1
}

/** A style's lengths take the occurrence's scale; the layer's own keep the scale they recorded. */
function bindingScale(node: SceneNode, field: string, styleBound: VariableBindings): number {
  if (field in styleBound) {
    return lengthScale(field, node.componentScale)
  }
  return node.variableBindingScales[field] ?? 1
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
  const styleBound = inheritedTextStyleBindings(node, styles)
  return resolvedNumbers(graph, node, effectiveBoundVariables(node, styles), styleBound)
}

export function resolvedNumbers(
  graph: SceneGraph,
  node: SceneNode,
  bindings: VariableBindings,
  styleBound: VariableBindings
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = {}
  for (const [field, variableId] of Object.entries(bindings)) {
    if (!resolvesToNumber(field)) continue
    if ((field === 'width' || field === 'height') && overriddenInInstance(graph, node.id, field))
      continue
    const value = graph.resolveNumberVariableForNode(node.id, variableId)
    if (value === undefined || !Number.isFinite(value)) continue
    const effective = value * bindingScale(node, field, styleBound)
    if (!Number.isFinite(effective)) continue
    const next = boundNumberValue(
      field,
      field === 'opacity' ? Math.max(0, Math.min(1, effective)) : effective
    )
    if (!isEqual(node[field as keyof SceneNode], next)) Object.assign(updates, { [field]: next })
  }
  return updates
}

/** Fields of a range of characters a bound number gives its value; the rest need fonts loaded. */
export const NUMERIC_RUN_FIELDS = ['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'] as const
const NUMERIC_TEXT_FIELDS: ReadonlySet<string> = new Set(NUMERIC_RUN_FIELDS)

export function resolvesToNumber(field: string): boolean {
  return NUMERIC_FIELDS.has(field) || NUMERIC_TEXT_FIELDS.has(field)
}

type RunHolder = Pick<SceneNode, 'id' | 'styleRuns' | 'componentScale'>

/**
 * The runs a text's character bindings resolve to in its mode, when a bound number differs from
 * what its characters hold. Bound font families and styles are left as stored, as the text's own.
 */
export function resolvedRunBindings(
  graph: SceneGraph,
  node: RunHolder,
  styles: TextStyleLookup = createStyleBindingLookup(graph)
): Pick<Partial<SceneNode>, 'styleRuns'> {
  return resolvedRuns(graph, node, (run) => effectiveRunBoundVariables(run, styles))
}

export function resolvedRuns(
  graph: SceneGraph,
  node: RunHolder,
  runBindings: (run: StyleRun) => VariableBindings
): Pick<Partial<SceneNode>, 'styleRuns'> {
  const styleRuns = node.styleRuns.map((run): StyleRun => {
    const bound = runBindings(run)
    let style = run.style
    for (const field of NUMERIC_RUN_FIELDS) {
      const variableId = bound[field]
      if (!variableId) continue
      const value = graph.resolveNumberVariableForNode(node.id, variableId)
      if (value === undefined || !Number.isFinite(value)) continue
      const next = boundNumberValue(field, value * lengthScale(field, node.componentScale))
      if (isEqual(style[field], next)) continue
      style = { ...style, [field]: next }
    }
    return style === run.style ? run : { ...run, style }
  })
  const changed = styleRuns.some((run, index) => run !== node.styleRuns[index])
  return changed ? { styleRuns } : {}
}
