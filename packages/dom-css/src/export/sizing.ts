import type { SceneNode } from '@open-pencil/scene-graph'
import { layoutSizingInParent } from '@open-pencil/scene-graph/layout'

import type { DesignStyleDeclaration } from '../types'
import { addGridPlacement } from './grid'
import type { FieldCSS } from './paint-style'
import { constraintSizes, placement } from './position'

const px = (value: number) => `${value}px`

/** Whether a layer sizes itself to its content along an axis, so CSS should too. */
function hugs(node: SceneNode, axis: 'width' | 'height'): boolean {
  if (node.type === 'TEXT')
    return (
      node.textAutoResize === 'WIDTH_AND_HEIGHT' ||
      (axis === 'height' && node.textAutoResize === 'HEIGHT')
    )
  if (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') return false
  const primary = (node.layoutMode === 'HORIZONTAL') === (axis === 'width')
  return (primary ? node.primaryAxisSizing : node.counterAxisSizing) === 'HUG'
}

/**
 * A layer's size: fixed on the axes the design fixes, and left to the content where the layer
 * hugs it (an auto layout frame set to Hug, or auto-sizing text), so the page grows with it.
 */
export function addSize(
  style: DesignStyleDeclaration,
  node: SceneNode,
  parent: SceneNode | undefined,
  css: FieldCSS
): void {
  const placed = placement(node, parent)
  const sized = (axis: 'width' | 'height') =>
    node[axis] > 0 &&
    !hugs(node, axis) &&
    !stretches(node, parent, axis) &&
    !(placed && constraintSizes(node, placed.parent, axis))
  if (sized('width')) style.width = css('width', px(node.width))
  if (sized('height')) style.height = css('height', px(node.height))
}

/**
 * Whether a layer fills an axis by stretching, which a fixed CSS size would prevent: across a
 * flex parent, or either axis of a grid cell. Along a flex parent, fill is `flex-grow`, and the
 * size stays as its basis.
 */
function stretches(
  node: SceneNode,
  parent: SceneNode | undefined,
  axis: 'width' | 'height'
): boolean {
  const sizing = layoutSizingInParent(parent, node, axis === 'width' ? 'HORIZONTAL' : 'VERTICAL')
  if (sizing !== 'FILL' || !parent) return false
  if (parent.layoutMode === 'GRID') return true
  const mainAxis = parent.layoutMode === 'HORIZONTAL' ? 'width' : 'height'
  return axis !== mainAxis
}

export function addSizeConstraints(
  style: DesignStyleDeclaration,
  node: SceneNode,
  css: FieldCSS
): void {
  if (node.minWidth !== null) style['min-width'] = css('minWidth', px(node.minWidth))
  if (node.maxWidth !== null) style['max-width'] = css('maxWidth', px(node.maxWidth))
  if (node.minHeight !== null) style['min-height'] = css('minHeight', px(node.minHeight))
  if (node.maxHeight !== null) style['max-height'] = css('maxHeight', px(node.maxHeight))
}

/** Whether something other than its children may set the height of a column. */
function heightIsLimited(column: SceneNode): boolean {
  return (
    column.primaryAxisSizing !== 'HUG' ||
    column.maxHeight !== null ||
    column.layoutGrow > 0 ||
    column.layoutAlignSelf === 'STRETCH' ||
    column.verticalConstraint === 'STRETCH' ||
    column.verticalConstraint === 'SCALE'
  )
}

/**
 * Whether flexbox could shrink a layer where auto layout lets it overflow: auto layout shrinks
 * only layers that fill. A column as tall as its children never runs out of height, so they need
 * no say.
 */
function keepsSize(node: SceneNode, parent: SceneNode): boolean {
  if (node.layoutPositioning === 'ABSOLUTE' || node.layoutGrow > 0) return false
  if (parent.layoutMode === 'HORIZONTAL') return true
  return parent.layoutMode === 'VERTICAL' && heightIsLimited(parent)
}

/** Styles a node takes from its parent's layout, and its own rotation. */
export function addLayoutChild(
  style: DesignStyleDeclaration,
  node: SceneNode,
  parent: SceneNode | undefined
): void {
  if (parent?.layoutMode === 'GRID') addGridPlacement(style, node)
  else if (parent && parent.layoutMode !== 'NONE' && node.layoutGrow > 0) style['flex-grow'] = '1'
  if (parent && keepsSize(node, parent)) style['flex-shrink'] = '0'
  if (node.rotation !== 0) style.transform = `rotate(${node.rotation}deg)`
}

const SIZE_PROPERTIES = ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']

/**
 * A layer's size includes its padding and stroke, as auto layout measures it. CSS sizes the
 * content box unless told otherwise, so a sized box with padding or a border says so.
 */
export function addBoxSizing(style: DesignStyleDeclaration): void {
  const sized = SIZE_PROPERTIES.some((property) => Object.hasOwn(style, property))
  const boxed = Object.keys(style).some(
    (property) =>
      property.startsWith('padding') ||
      (property.startsWith('border') && !property.endsWith('radius'))
  )
  if (sized && boxed) style['box-sizing'] = 'border-box'
}
