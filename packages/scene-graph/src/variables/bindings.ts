import { uniq } from 'es-toolkit/array'
import { isEmptyObject } from 'es-toolkit/predicate'

import { copyFills, copyStrokes } from '../copy'
import type { SceneGraph } from '../index'
import { hasInstanceOverride } from '../instances'
import type { Color } from '../primitives'
import type { CharacterStyleOverride, Fill, SceneNode, Stroke, StyleRun } from '../types'
import type { VariableModeFallback } from '../variables'
import { NUMERIC_FIELDS, isNumericVariableBindingField } from './fields'
import {
  createTextStyleLookup,
  effectiveBoundVariables,
  effectiveRunBoundVariables,
  inheritedRunStyleBindings,
  inheritedTextStyleBindings,
  textStyleConsumers,
  type TextStyleLookup,
  type VariableBindings
} from './style-bindings'
import { variableText, variableTruthy } from './text'
import { variableValueReferences } from './value'
import { hasVariantBindings } from './variant-bindings'
import {
  boundInstancesFirst,
  createVariantWalk,
  subtreeNodes,
  walkBoundVariants,
  type ReconcileOptions
} from './variant-reconcile'
export type { ReconcileOptions } from './variant-reconcile'
export {
  savedVariantIds,
  savedVariantUnderBinding,
  unbindSwapPropertyTargets,
  unbindVariantProperty,
  unbindVariantsForSwap
} from './variant-bindings'
export { showBoundVariants } from './variant-reconcile'
export {
  isNumericVariableBindingField,
  TEXT_CONTENT_VARIABLE_TYPES,
  VISIBILITY_VARIABLE_TYPES
} from './fields'

/** New declarations belong to the outermost occurrence, bounded by a component definition. */
export function variableBindingOwner(graph: SceneGraph, node: SceneNode): SceneNode {
  let owner = node
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') break
    if (current.type === 'INSTANCE') owner = current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return owner
}

export function assignVariableBindingUnits(
  graph: SceneGraph,
  node: SceneNode,
  field: string
): void {
  if (!isNumericVariableBindingField(field)) return
  const owner = variableBindingOwner(graph, node)
  node.variableBindingScales = {
    ...node.variableBindingScales,
    [field]: owner.variableAssignmentScales[field] ?? 1
  }
}

/**
 * The values a node's numeric bindings resolve to in its mode, in scene units, for the fields
 * whose stored value differs. A width or height an instance overrides keeps its own value.
 */
export function resolvedNumericBindings(
  graph: SceneGraph,
  node: SceneNode,
  fallback: VariableModeFallback = 'active',
  styles: TextStyleLookup = createTextStyleLookup(graph)
): Partial<SceneNode> {
  return resolvedNumbers(graph, node, effectiveBoundVariables(node, styles), fallback)
}

function resolvedNumbers(
  graph: SceneGraph,
  node: SceneNode,
  bindings: VariableBindings,
  fallback: VariableModeFallback
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = {}
  for (const [field, variableId] of Object.entries(bindings)) {
    if (!NUMERIC_FIELDS.has(field)) continue
    if ((field === 'width' || field === 'height') && hasInstanceOverride(graph, node.id, field))
      continue
    const value = graph.resolveNumberVariableForNode(node.id, variableId, fallback)
    if (value === undefined || !Number.isFinite(value)) continue
    const scale = node.variableBindingScales[field] ?? 1
    const effective = value * scale
    if (!Number.isFinite(effective)) continue
    const next = field === 'opacity' ? Math.max(0, Math.min(1, effective)) : effective
    if (node[field as keyof SceneNode] !== next) Object.assign(updates, { [field]: next })
  }
  return updates
}

/**
 * The text and visibility a node's string and boolean bindings resolve to in its mode, for the
 * fields whose stored value differs. Text or visibility an instance overrides, which typing in a
 * layer or toggling its eye records, keeps its own value, as an overridden width or height does.
 * A bound font family is left as stored: changing it needs the font loaded, which resolving a
 * binding cannot do.
 */
export function resolvedValueBindings(
  graph: SceneGraph,
  node: SceneNode,
  fallback: VariableModeFallback = 'active'
): Partial<SceneNode> {
  const updates: Partial<SceneNode> = {}
  const resolve = (field: 'text' | 'visible') => {
    const variableId = node.boundVariables[field]
    if (!variableId || hasInstanceOverride(graph, node.id, field)) return undefined
    return graph.resolveVariableForNode(node.id, variableId, fallback)
  }
  const text = node.type === 'TEXT' ? variableText(resolve('text')) : undefined
  if (text !== undefined && text !== node.text) updates.text = text
  // Figma binds visibility to text too, and shows the layer when the text reads as true.
  const visible = variableTruthy(resolve('visible'))
  if (visible !== undefined && visible !== node.visible) updates.visible = visible
  return updates
}

/** Fields of a range of characters a bound number gives its value; the rest need fonts loaded. */
const NUMERIC_RUN_FIELDS = ['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'] as const

/**
 * The runs a text's character bindings resolve to in its mode, when a bound number differs from
 * what its characters hold. Bound font families and styles are left as stored, as the text's own.
 */
export function resolvedRunBindings(
  graph: SceneGraph,
  node: SceneNode,
  fallback: VariableModeFallback = 'active',
  styles: TextStyleLookup = createTextStyleLookup(graph)
): Pick<Partial<SceneNode>, 'styleRuns'> {
  return resolvedRuns(graph, node, (run) => effectiveRunBoundVariables(run, styles), fallback)
}

function resolvedRuns(
  graph: SceneGraph,
  node: SceneNode,
  runBindings: (run: StyleRun) => VariableBindings,
  fallback: VariableModeFallback
): Pick<Partial<SceneNode>, 'styleRuns'> {
  const styleRuns = node.styleRuns.map((run): StyleRun => {
    const bound = runBindings(run)
    let style = run.style
    for (const field of NUMERIC_RUN_FIELDS) {
      const variableId = bound[field]
      if (!variableId) continue
      const value = graph.resolveNumberVariableForNode(node.id, variableId, fallback)
      if (value === undefined || !Number.isFinite(value) || style[field] === value) continue
      style = { ...style, [field]: value }
    }
    return style === run.style ? run : { ...run, style }
  })
  const changed = styleRuns.some((run, index) => run !== node.styleRuns[index])
  return changed ? { styleRuns } : {}
}

export function resolvedTextStyleBindings(
  graph: SceneGraph,
  node: SceneNode,
  fallback: VariableModeFallback,
  styles: TextStyleLookup
): Partial<SceneNode> {
  if (node.type !== 'TEXT') {
    return {}
  }
  return {
    ...resolvedNumbers(graph, node, inheritedTextStyleBindings(node, styles), fallback),
    ...resolvedRuns(graph, node, (run) => inheritedRunStyleBindings(run, styles), fallback)
  }
}

/** The variables a node binds, its own, its characters', and those its text styles bind. */
function boundVariableIds(node: SceneNode, styles: TextStyleLookup): string[] {
  const ids = [
    ...Object.values(effectiveBoundVariables(node, styles)),
    ...node.styleRuns.flatMap((run) => Object.values(effectiveRunBoundVariables(run, styles)))
  ]
  if (hasVariantBindings(node)) {
    ids.push(...Object.values(node.variantBindings))
  }
  return ids.filter((id): id is string => typeof id === 'string')
}

/**
 * A bound paint takes its whole color from the variable, alpha included, the way Figma stores
 * it: the variable's RGB at full alpha, and its alpha as the paint's opacity.
 */
function applyBoundColor(paint: Fill | Stroke, color: Color): void {
  paint.color = { ...color, a: 1 }
  paint.opacity = color.a
}

/** The fills and strokes a node's color bindings resolve to in its mode, when it has any. */
export function resolvedPaintBindings(
  graph: SceneGraph,
  node: SceneNode,
  fallback: VariableModeFallback = 'active'
): Pick<Partial<SceneNode>, 'fills' | 'strokes'> {
  // Most nodes bind nothing, so no copy is made until a paint binding is actually found.
  const changes: Pick<Partial<SceneNode>, 'fills' | 'strokes'> = {}
  for (const field in node.boundVariables) {
    if (!field.endsWith('/color')) continue
    const match = /^(fills|strokes)\/(\d+)\/color$/.exec(field)
    if (!match) continue
    const color = graph.resolveColorVariableForNode(node.id, node.boundVariables[field], fallback)
    const index = Number(match[2])
    if (!color) continue
    if (match[1] === 'fills') {
      if (!node.fills[index]) continue
      changes.fills ??= copyFills(node.fills)
      applyBoundColor(changes.fills[index], color)
    } else {
      if (!node.strokes[index]) continue
      changes.strokes ??= copyStrokes(node.strokes)
      applyBoundColor(changes.strokes[index], color)
    }
  }
  return changes
}

/**
 * The layers a reconcile looks at: those bound to these variables, directly or through a variable
 * aliasing them, or the layers in these subtrees. Without a scope, every layer.
 */
export type BindingScope = { variables: Iterable<string> } | { subtrees: Iterable<string> }

/** These variables and every variable that aliases one of them, at any depth and in any mode. */
export function variablesResolvingThrough(graph: SceneGraph, ids: Iterable<string>): Set<string> {
  const found = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const variable of graph.variables.values()) {
      if (found.has(variable.id)) continue
      const aliases = Object.values(variable.valuesByMode).some((value) =>
        variableValueReferences(value).some((id) => found.has(id))
      )
      if (aliases) {
        found.add(variable.id)
        grew = true
      }
    }
  }
  return found
}

/**
 * The collections whose variables the layers in these subtrees resolve: those they bind, and
 * those the bound variables alias, so a mode set on the subtrees can change what they show.
 */
export function collectionsBoundIn(graph: SceneGraph, roots: Iterable<string>): Set<string> {
  const styles = createTextStyleLookup(graph)
  const pending = subtreeNodes(graph, roots).flatMap((node) => boundVariableIds(node, styles))
  const seen = new Set<string>()
  const collections = new Set<string>()
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    const variable = graph.variables.get(id)
    if (!variable) continue
    collections.add(variable.collectionId)
    for (const value of Object.values(variable.valuesByMode))
      pending.push(...variableValueReferences(value))
  }
  return collections
}

/**
 * The layers a change to these variables reaches: those binding one of them, or a variable that
 * aliases one, on the layer itself or on its characters.
 */
export function layersUsingVariables(
  graph: SceneGraph,
  ids: Iterable<string>,
  styles: TextStyleLookup = createTextStyleLookup(graph)
): SceneNode[] {
  const variables = variablesResolvingThrough(graph, ids)
  return [...graph.getAllNodes()].filter((node) =>
    boundVariableIds(node, styles).some((id) => variables.has(id))
  )
}

interface ScopedLayers {
  nodes: Iterable<SceneNode>
  restyled: ReadonlySet<string>
}

const NO_RESTYLED: ReadonlySet<string> = new Set()

function allNodes(graph: SceneGraph): Iterable<SceneNode> {
  return { [Symbol.iterator]: () => graph.getAllNodes()[Symbol.iterator]() }
}

function scopedLayers(
  graph: SceneGraph,
  scope: BindingScope | undefined,
  styles: TextStyleLookup
): ScopedLayers {
  if (!scope) {
    return { nodes: allNodes(graph), restyled: NO_RESTYLED }
  }
  if ('subtrees' in scope) {
    return withTextStyleConsumers(graph, subtreeNodes(graph, scope.subtrees))
  }
  return { nodes: layersUsingVariables(graph, scope.variables, styles), restyled: NO_RESTYLED }
}

function withTextStyleConsumers(graph: SceneGraph, nodes: SceneNode[]): ScopedLayers {
  const styleIds = new Set<string>()
  for (const node of nodes) {
    if (node.sharedStyleType === 'TEXT' && node.source.id) {
      styleIds.add(node.source.id)
    }
  }
  if (styleIds.size === 0) {
    return { nodes, restyled: NO_RESTYLED }
  }
  return { nodes: uniq([...nodes, ...textStyleConsumers(graph, styleIds)]), restyled: styleIds }
}

type NumericTextValues = Pick<CharacterStyleOverride, (typeof NUMERIC_RUN_FIELDS)[number]>

function unboundStyleValues(
  style: SceneNode,
  current: NumericTextValues,
  bound: VariableBindings
): NumericTextValues | undefined {
  let values: NumericTextValues | undefined
  for (const field of NUMERIC_RUN_FIELDS) {
    if (!(field in bound) && current[field] !== style[field]) {
      values = { ...values, [field]: style[field] }
    }
  }
  return values
}

function restyledValues(
  graph: SceneGraph,
  styleId: string | null | undefined,
  current: NumericTextValues,
  bound: VariableBindings,
  restyled: ReadonlySet<string>
): NumericTextValues | undefined {
  if (!styleId || !restyled.has(styleId)) {
    return undefined
  }
  const style = graph.getSharedStyleNode(styleId, 'TEXT')
  return style ? unboundStyleValues(style, current, bound) : undefined
}

function restyledRuns(
  graph: SceneGraph,
  node: SceneNode,
  restyled: ReadonlySet<string>,
  styles: TextStyleLookup
): Pick<Partial<SceneNode>, 'styleRuns'> {
  const styleRuns = node.styleRuns.map((run): StyleRun => {
    const bound = effectiveRunBoundVariables(run, styles)
    const values = restyledValues(graph, run.style.textStyleId, run.style, bound, restyled)
    return values ? { ...run, style: { ...run.style, ...values } } : run
  })
  const changed = styleRuns.some((run, index) => run !== node.styleRuns[index])
  return changed ? { styleRuns } : {}
}

function styleOwnValues(
  graph: SceneGraph,
  node: SceneNode,
  restyled: ReadonlySet<string>,
  styles: TextStyleLookup
): Partial<SceneNode> {
  if (restyled.size === 0) {
    return {}
  }
  const bound = effectiveBoundVariables(node, styles)
  return {
    ...restyledValues(graph, node.textStyleId, node, bound, restyled),
    ...restyledRuns(graph, node, restyled, styles)
  }
}

function hasEntries(record: object): boolean {
  for (const key in record) {
    if (Object.hasOwn(record, key)) {
      return true
    }
  }
  return false
}

function runReadsVariables({ style }: StyleRun): boolean {
  return (
    Boolean(style.textStyleId) ||
    (style.boundVariables !== undefined && hasEntries(style.boundVariables))
  )
}

function readsVariables(node: SceneNode): boolean {
  return (
    hasEntries(node.boundVariables) ||
    Boolean(node.textStyleId) ||
    node.styleRuns.some(runReadsVariables)
  )
}

function resolvedOwnBindings(
  graph: SceneGraph,
  node: SceneNode,
  styles: TextStyleLookup
): Partial<SceneNode> {
  return {
    ...resolvedNumbers(graph, node, node.boundVariables, 'active'),
    ...resolvedValueBindings(graph, node),
    ...resolvedRunBindings(graph, node, 'active', styles)
  }
}

function applyResolvedBindings(
  graph: SceneGraph,
  node: SceneNode,
  styles: TextStyleLookup,
  restyled: ReadonlySet<string>
): boolean {
  if (!readsVariables(node)) {
    return false
  }
  const unbound = styleOwnValues(graph, node, restyled, styles)
  const unboundChanged = !isEmptyObject(unbound)
  if (unboundChanged) {
    graph.updateNodeFromStyle(node.id, unbound)
  }
  const fromStyle = resolvedNumbers(graph, node, inheritedTextStyleBindings(node, styles), 'active')
  const own = resolvedOwnBindings(graph, node, styles)
  const styleChanged = !isEmptyObject(fromStyle)
  const ownChanged = !isEmptyObject(own)
  if (styleChanged) {
    graph.updateNodeFromStyle(node.id, fromStyle)
  }
  if (ownChanged) {
    graph.updateNode(node.id, own)
  }
  return unboundChanged || styleChanged || ownChanged
}

/**
 * Resolve live numeric, text, and visibility bindings, numbers in scene units, without authoring
 * instance overrides. A scope limits it to the layers a change can reach, so layers whose saved
 * values differ from their bindings elsewhere in the document are left as saved.
 */
export function reconcileVariableBindings(
  graph: SceneGraph,
  scope?: BindingScope,
  { onVariantSwap }: ReconcileOptions = {}
): string[] {
  const changed: string[] = []
  const styles = createTextStyleLookup(graph)
  const { nodes, restyled } = scopedLayers(graph, scope, styles)
  walkBoundVariants(
    graph,
    boundInstancesFirst(graph, nodes),
    createVariantWalk(graph, { onVariantSwap }),
    (node) => applyResolvedBindings(graph, node, styles, restyled),
    changed
  )
  return changed
}
