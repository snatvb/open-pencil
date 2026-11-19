import type { SceneNode } from '@open-pencil/scene-graph'
import { getNodeWorldBounds } from '@open-pencil/scene-graph/coordinate'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import type { Box, LayoutNode } from '@open-pencil/taffy'

import { stretchesAcross } from './node'
import {
  autoWidthWrapWidth,
  getTextMeasurer,
  measureAutoWidthText,
  measureTextForLayout
} from './text-measurement'
import { type Turn, turnOf } from './turn'

type Size = Pick<SceneNode, 'width' | 'height'>

const AS_LEAF = {
  rotation: 0,
  flipX: false,
  flipY: false,
  layoutMode: 'NONE',
  textAutoResize: 'NONE'
} as const

function measuresContent(child: SceneNode): boolean {
  return (
    child.type === 'TEXT' &&
    child.textAutoResize !== 'NONE' &&
    !child.textPathData &&
    getTextMeasurer() !== null
  )
}

function measuredText(child: SceneNode, width = child.width): Size {
  if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
    const saved = child.derivedLayout
    if (saved?.width !== undefined && saved.height !== undefined) {
      return child
    }
    return measureAutoWidthText(child, autoWidthWrapWidth(child))
  }
  if (width === child.width && (child.derivedTextGlyphs?.length ?? 0) > 0) {
    return child
  }
  return { width, height: measureTextForLayout(child, width).height }
}

function ownSize(child: SceneNode): Size {
  return measuresContent(child) ? measuredText(child) : child
}

function turnedBounds(child: SceneNode, size: Size): Rect {
  return getNodeWorldBounds({
    type: child.type,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    rotation: child.rotation,
    flipX: child.flipX,
    flipY: child.flipY
  })
}

function alignedWithoutStretch(child: SceneNode, parent: SceneNode): SceneNode['layoutAlignSelf'] {
  if (!stretchesAcross(child, parent)) {
    return child.layoutAlignSelf
  }
  return parent.counterAxisAlign === 'STRETCH' ? 'MIN' : parent.counterAxisAlign
}

function quarterTurnedLeaf(child: SceneNode, parent: SceneNode): SceneNode {
  const text = measuresContent(child)
  const hugsWidth = text
  const hugsHeight = text && child.textAutoResize === 'WIDTH_AND_HEIGHT'
  const row = parent.layoutMode === 'HORIZONTAL'
  const growsAlong = !(row ? hugsWidth : hugsHeight)
  const stretchesAlong = !(row ? hugsHeight : hugsWidth)
  const derived = child.derivedLayout
  return {
    ...child,
    ...AS_LEAF,
    width: child.height,
    height: child.width,
    minWidth: child.minHeight,
    maxWidth: child.maxHeight,
    minHeight: child.minWidth,
    maxHeight: child.maxWidth,
    targetAspectRatio: child.targetAspectRatio && {
      x: child.targetAspectRatio.y,
      y: child.targetAspectRatio.x
    },
    derivedLayout: derived && { width: derived.height, height: derived.width },
    layoutGrow: growsAlong ? child.layoutGrow : 0,
    layoutAlignSelf: stretchesAlong ? child.layoutAlignSelf : alignedWithoutStretch(child, parent)
  }
}

function obliqueTurnedLeaf(child: SceneNode, parent: SceneNode): SceneNode {
  const bounds = turnedBounds(child, ownSize(child))
  return {
    ...child,
    ...AS_LEAF,
    width: bounds.width,
    height: bounds.height,
    layoutGrow: 0,
    layoutAlignSelf: alignedWithoutStretch(child, parent),
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
    targetAspectRatio: null,
    derivedLayout: null
  }
}

export function asTurnedInLayout(child: SceneNode, parent: SceneNode): SceneNode {
  const turn = turnOf(child)
  if (turn === 'quarter') {
    return quarterTurnedLeaf(child, parent)
  }
  if (turn === 'oblique') {
    return obliqueTurnedLeaf(child, parent)
  }
  return child
}

export function measureTurnedText(item: LayoutNode, child: SceneNode): void {
  if (turnOf(child) !== 'quarter' || !measuresContent(child)) {
    return
  }
  item.style.width = 'auto'
  if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
    item.style.height = 'auto'
  }
  item.measure = (known, available) => {
    const along =
      known.height ?? (typeof available.height === 'number' ? available.height : undefined)
    const own = measuredText(child, along)
    return { width: own.height, height: own.width }
  }
}

export function sizeInParent(child: SceneNode): Size {
  const turn = turnOf(child)
  if (turn === 'none' || turn === 'half') {
    return child
  }
  const own = ownSize(child)
  if (turn === 'quarter') {
    return { width: own.height, height: own.width }
  }
  return turnedBounds(child, own)
}

function ownSizeIn(child: SceneNode, box: Box, turn: Turn): Size {
  if (turn === 'quarter') {
    return { width: box.height, height: box.width }
  }
  if (turn === 'oblique') {
    return ownSize(child)
  }
  return box
}

export function placedInTurnedBox(child: SceneNode, box: Box): Box {
  const turn = turnOf(child)
  if (turn === 'none') {
    return box
  }
  const own = ownSizeIn(child, box, turn)
  const bounds = turnedBounds(child, own)
  return {
    left: box.left - bounds.x,
    top: box.top - bounds.y,
    width: own.width,
    height: own.height
  }
}
