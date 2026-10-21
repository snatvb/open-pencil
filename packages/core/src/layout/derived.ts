import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import {
  LAYOUT_AFFECTING_KEYS,
  TEXT_LAYOUT_FIELDS,
  TEXT_SHAPING_FIELDS
} from '@open-pencil/scene-graph/fields'

/**
 * Edits that make saved geometry stale: layout fields, visibility, text shaped or laid out again,
 * and an instance switched to another component.
 */
const LAYOUT_EDIT_FIELDS: ReadonlySet<string> = new Set([
  ...LAYOUT_AFFECTING_KEYS,
  ...TEXT_SHAPING_FIELDS,
  ...TEXT_LAYOUT_FIELDS,
  'visible',
  'derivedLayout',
  'componentId'
])

function hasEditedLayout(node: SceneNode): boolean {
  return node.source.editedFields.some((field) => LAYOUT_EDIT_FIELDS.has(field))
}

/** The layers in each .fig frame's flow when layout first saw them, as its page opened. */
const savedFlows = new WeakMap<SceneGraph, Map<string, readonly string[]>>()
/**
 * Frames whose saved geometry no longer fits them: their flow, or a flow inside it, lost or gained
 * a layer, or the layout around them resized them; kept until reload.
 */
const restructured = new WeakMap<SceneGraph, Set<string>>()
/** Frames that last laid out without their saved geometry, for the frames around them. */
const reflowed = new WeakMap<SceneGraph, Set<string>>()

function graphState<T>(states: WeakMap<SceneGraph, T>, graph: SceneGraph, create: () => T): T {
  let state = states.get(graph)
  if (!state) {
    state = create()
    states.set(graph, state)
  }
  return state
}

function inFlow(node: SceneNode | undefined): node is SceneNode {
  return node !== undefined && node.layoutPositioning !== 'ABSOLUTE'
}

function flowIds(graph: SceneGraph, frame: SceneNode): string[] {
  return frame.childIds.filter((id) => inFlow(graph.getNode(id)))
}

function matchesFlow(graph: SceneGraph, frame: SceneNode, saved: readonly string[]): boolean {
  let index = 0
  for (const id of frame.childIds) {
    if (!inFlow(graph.getNode(id))) {
      continue
    }
    if (saved[index] !== id) {
      return false
    }
    index++
  }
  return index === saved.length
}

/**
 * Loading a file adds, moves, and removes layers too, so structure edits are told from it by
 * comparing the layers in a frame's flow, in order, with those layout first saw. A layer that
 * ignores auto layout, or stops ignoring it, leaves or joins the flow.
 */
function flowChanged(graph: SceneGraph, node: SceneNode): boolean {
  const seen = graphState(savedFlows, graph, () => new Map<string, readonly string[]>())
  const saved = seen.get(node.id)
  if (saved === undefined) {
    seen.set(node.id, flowIds(graph, node))
    return false
  }
  return !matchesFlow(graph, node, saved)
}

function holdsSavedLayout(graph: SceneGraph, frame: SceneNode): boolean {
  if (frame.source.format === 'fig' || frame.derivedLayout) {
    return true
  }
  for (const id of frame.childIds) {
    const child = graph.getNode(id)
    if (inFlow(child) && child.derivedLayout) {
      return true
    }
  }
  return false
}

function flowRestructured(graph: SceneGraph, frame: SceneNode, stale: Set<string>): boolean {
  if (flowChanged(graph, frame)) {
    return true
  }
  for (const id of frame.childIds) {
    const child = graph.getNode(id)
    if (inFlow(child) && (stale.has(id) || flowChanged(graph, child))) {
      return true
    }
  }
  return false
}

function flowEdited(graph: SceneGraph, frame: SceneNode, reflowedFrames: Set<string>): boolean {
  if (hasEditedLayout(frame)) {
    return true
  }
  for (const id of frame.childIds) {
    const child = graph.getNode(id)
    if (inFlow(child) && (hasEditedLayout(child) || reflowedFrames.has(id))) {
      return true
    }
  }
  return false
}

/**
 * Records that a layer joined, left, or moved in `parentId`'s children, as an editor sees an edit
 * happen, so the frame stops keeping saved geometry even if layout never ran on it before.
 */
export function markFlowChanged(graph: SceneGraph, parentId: string): void {
  graphState(restructured, graph, () => new Set<string>()).add(parentId)
}

export function markResizedByLayout(graph: SceneGraph, frameId: string): void {
  graphState(restructured, graph, () => new Set<string>()).add(frameId)
}

/**
 * Whether layout still keeps the geometry saved for `frame` and its flow. A frame stops once a
 * layer joins, leaves, or moves in its flow or a flow inside it, or once it or a layer in its flow
 * has its layout edited, such as by adding auto layout or a gap or restyling text. That holds for
 * layers read without a source format too, as a .fig file's components and instances are.
 */
export function keepsSavedLayout(graph: SceneGraph, frame: SceneNode): boolean {
  // Nothing saved to keep: the usual case outside documents read from files.
  if (!holdsSavedLayout(graph, frame)) {
    return true
  }
  const stale = graphState(restructured, graph, () => new Set<string>())
  if (stale.has(frame.id)) return false
  // Layout runs inner frames first, so a changed flow deep inside is already marked.
  if (flowRestructured(graph, frame, stale)) {
    stale.add(frame.id)
    return false
  }
  // A flow inside edited by now resizes this one, but a cancelled preview gives it back.
  const last = graphState(reflowed, graph, () => new Set<string>())
  const keeps = !flowEdited(graph, frame, last)
  if (keeps) last.delete(frame.id)
  else last.add(frame.id)
  return keeps
}

export function usesDetachedDerivedLayout(graph: SceneGraph, child: SceneNode): boolean {
  const derived = child.derivedLayout
  if (!derived || child.layoutMode === 'NONE' || child.layoutGrow > 0) return false
  const isRow = child.layoutMode === 'HORIZONTAL'
  const widthSizing = isRow ? child.primaryAxisSizing : child.counterAxisSizing
  const heightSizing = isRow ? child.counterAxisSizing : child.primaryAxisSizing
  return (
    ((widthSizing === 'HUG' && derived.width !== undefined) ||
      (heightSizing === 'HUG' && derived.height !== undefined)) &&
    keepsSavedLayout(graph, child)
  )
}
