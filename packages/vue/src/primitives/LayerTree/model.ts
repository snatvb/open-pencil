import { isEmptyObject, isEqual, pick } from 'es-toolkit'
import { toRaw } from 'vue'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { isGeneratedFrame } from '@open-pencil/scene-graph/generated'
import { readIcon } from '@open-pencil/scene-graph/icons'
import type { ShapeWithTextType } from '@open-pencil/scene-graph/shape-with-text'
import { slotPropertyId } from '@open-pencil/scene-graph/slots'

import { LAYER_OUTLINE_FIELDS } from '#vue/primitives/LayerTree/context'
import type {
  LayerNode,
  LayerOutline,
  LayerRow,
  LayerSelectionMode
} from '#vue/primitives/LayerTree/context'

function explicitVariableModes(node: SceneNode): Record<string, string> | undefined {
  return isEmptyObject(node.variableModes) ? undefined : { ...node.variableModes }
}

function layerVariableModes(node: SceneNode): Pick<LayerNode, 'modeIds' | 'variableModes'> {
  const variableModes = explicitVariableModes(node)
  return { variableModes, modeIds: variableModes && Object.values(variableModes) }
}

function shapeWithTextTypeOf(node: SceneNode): ShapeWithTextType | undefined {
  return node.type === 'SHAPE_WITH_TEXT' ? node.shapeWithTextType : undefined
}

/** The layers whose rows draw their own outline, as Figma's do; others keep their kind's glyph. */
const OUTLINE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'VECTOR'])

function outlineOf(node: SceneNode): LayerOutline | undefined {
  if (!OUTLINE_TYPES.has(node.type) || (node.type === 'VECTOR' && !node.vectorNetwork)) {
    return undefined
  }
  return pick(node, LAYER_OUTLINE_FIELDS)
}

/** A visible image paint, in fills or strokes, which Figma marks a layer's row with. */
function showsImage(node: SceneNode): boolean {
  return [...node.fills, ...node.strokes].some(
    (paint) => paint.type === 'IMAGE' && paint.visible && paint.opacity > 0
  )
}

function sameOutline(target: LayerOutline | undefined, source: LayerOutline | undefined) {
  if (!target || !source) return target === source
  // The target may be a reactive row, which hands back proxies of the objects it holds.
  return LAYER_OUTLINE_FIELDS.every((field) => toRaw(target[field]) === source[field])
}

function nodeToLayerNode(node: SceneNode): LayerNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    layoutMode: node.layoutMode,
    slot: !!slotPropertyId(node),
    icon: !!readIcon(node),
    shapeWithTextType: shapeWithTextTypeOf(node),
    outline: outlineOf(node),
    image: showsImage(node),
    mask: node.isMask,
    visible: node.visible,
    locked: node.locked,
    ...layerVariableModes(node)
  }
}

export interface LayerTreeModel {
  items: LayerNode[]
  byId: Map<string, LayerNode>
}

/**
 * Whether a layer's rows follow its flow, as Figma lists a horizontal or vertical auto layout's
 * children: first in the flow first. Other layers, grids included, list theirs front-most first.
 */
export function listsChildrenInFlow(node: Pick<SceneNode, 'layoutMode'>): boolean {
  return node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'
}

export function listsChildren(graph: SceneGraph, node: SceneNode): boolean {
  // A generated frame, such as a sticky note, is one layer; its template owns what is inside.
  if (isGeneratedFrame(node)) {
    return false
  }
  return node.childIds.some((childId) => {
    const child = graph.getNode(childId)
    return !!child && !child.internalOnly
  })
}

export interface LazyLayerTreeModel extends LayerTreeModel {
  hasChildren(node: Pick<LayerNode, 'id'>): boolean
  buildExpanded(isExpanded: (id: string) => boolean): void
}

export function createLayerTreeModel(graph: SceneGraph, parentId: string): LazyLayerTreeModel {
  const byId = new Map<string, LayerNode>()
  const parents = new Set<string>()

  const buildRows = (id: string): LayerNode[] => {
    const parent = graph.getNode(id)
    if (!parent) return []
    const rows: LayerNode[] = []
    // `childIds` runs from back to front, which is also an auto layout's flow.
    const rowOrder = listsChildrenInFlow(parent) ? parent.childIds : parent.childIds.toReversed()
    for (const childId of rowOrder) {
      const sceneNode = graph.getNode(childId)
      if (!sceneNode || sceneNode.internalOnly) continue
      const node = nodeToLayerNode(sceneNode)
      byId.set(node.id, node)
      if (listsChildren(graph, sceneNode)) {
        parents.add(node.id)
      }
      rows.push(node)
    }
    return rows
  }

  const items = buildRows(parentId)

  const buildExpanded = (isExpanded: (id: string) => boolean) => {
    const visit = (rows: readonly LayerNode[]) => {
      for (const row of rows) {
        if (!parents.has(row.id) || !isExpanded(row.id)) {
          continue
        }
        row.children ??= buildRows(row.id)
        visit(row.children)
      }
    }
    visit(items)
  }

  return { items, byId, hasChildren: (node) => parents.has(node.id), buildExpanded }
}

export function buildLayerTreeModel(graph: SceneGraph, parentId: string): LayerTreeModel {
  const model = createLayerTreeModel(graph, parentId)
  model.buildExpanded(() => true)
  return { items: model.items, byId: model.byId }
}

export function indexLayerNodes(items: readonly LayerNode[]): Map<string, LayerNode> {
  const byId = new Map<string, LayerNode>()
  const visit = (nodes: readonly LayerNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node)
      if (node.children) visit(node.children)
    }
  }
  visit(items)
  return byId
}

export function patchLayerNode(target: LayerNode, source: SceneNode): boolean {
  const outline = outlineOf(source)
  const changed =
    target.name !== source.name ||
    target.type !== source.type ||
    target.layoutMode !== source.layoutMode ||
    target.slot !== !!slotPropertyId(source) ||
    target.icon !== !!readIcon(source) ||
    target.shapeWithTextType !== shapeWithTextTypeOf(source) ||
    !sameOutline(target.outline, outline) ||
    target.image !== showsImage(source) ||
    target.mask !== source.isMask ||
    target.visible !== source.visible ||
    target.locked !== source.locked ||
    !isEqual(target.variableModes, explicitVariableModes(source))
  if (!changed) return false
  target.name = source.name
  target.type = source.type
  target.layoutMode = source.layoutMode
  target.slot = !!slotPropertyId(source)
  target.icon = !!readIcon(source)
  target.shapeWithTextType = shapeWithTextTypeOf(source)
  target.outline = outline
  target.image = showsImage(source)
  target.mask = source.isMask
  target.visible = source.visible
  target.locked = source.locked
  Object.assign(target, layerVariableModes(source))
  return true
}

function hasBuiltChildren(node: LayerNode): boolean {
  return (node.children?.length ?? 0) > 0
}

export function visibleLayerRows(
  items: readonly LayerNode[],
  expandedIds: ReadonlySet<string>,
  hasChildren: (node: LayerNode) => boolean = hasBuiltChildren
): LayerRow[] {
  const rows: LayerRow[] = []
  const append = (nodes: readonly LayerNode[], level: number) => {
    for (const node of nodes) {
      rows.push({ node, level, hasChildren: hasChildren(node) })
      if (node.children && expandedIds.has(node.id)) {
        append(node.children, level + 1)
      }
    }
  }
  append(items, 1)
  return rows
}

export function layerSelectionForTarget(
  visibleIds: readonly string[],
  currentIds: ReadonlySet<string>,
  anchorId: string | null,
  targetId: string,
  mode: LayerSelectionMode
): Set<string> {
  if (!mode.range || !anchorId) {
    if (!mode.additive) return new Set([targetId])
    const next = new Set(currentIds)
    if (next.has(targetId)) next.delete(targetId)
    else next.add(targetId)
    return next
  }

  const anchorIndex = visibleIds.indexOf(anchorId)
  const targetIndex = visibleIds.indexOf(targetId)
  if (anchorIndex === -1 || targetIndex === -1) return new Set([targetId])
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  const next = mode.additive ? new Set(currentIds) : new Set<string>()
  for (let index = start; index <= end; index++) {
    const id = visibleIds[index]
    if (id) next.add(id)
  }
  return next
}

/**
 * Where a dropped layer goes among its new siblings: `index` in `childIds` counted without the
 * layer, so one dragged from earlier in the same parent lands one slot sooner.
 */
export function dropIndex(childIds: readonly string[], sourceId: string, index: number): number {
  const sourceIndex = childIds.indexOf(sourceId)
  return sourceIndex !== -1 && sourceIndex < index ? index - 1 : index
}
