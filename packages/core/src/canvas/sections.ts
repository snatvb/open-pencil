import type { Canvas } from '@open-pencil/canvaskit'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { drawIndividualSideStrokes } from '#core/canvas/strokes/sides'

import { paintFills } from './fills'
import type { SkiaRenderer } from './renderer'
import {
  configureStrokePaint,
  drawDashedRRectWithSolidCorners,
  drawRRectStrokeWithAlign,
  drawStyledRRectStroke,
  forVisibleStrokes
} from './strokes'
import { drawFigmaDashes } from './strokes/dispatch'

function makeNodeRRect(r: SkiaRenderer, node: SceneNode, radius: number): Float32Array {
  const rect = r.ck.LTRBRect(0, 0, node.width, node.height)
  return r.ck.RRectXY(rect, radius, radius)
}

/** Fill a section's or set's rounded bounds and return them, for its strokes to follow. */
function fillRoundedBounds(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): Float32Array {
  const rrect = makeNodeRRect(r, node, node.cornerRadius)
  paintFills(r, node.fills, node, graph, () => canvas.drawRRect(rrect, r.fillPaint))
  return rrect
}

export function renderSection(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const rrect = fillRoundedBounds(r, canvas, node, graph)
  forVisibleStrokes(r, node, graph, (stroke, color) => {
    configureStrokePaint(r, node, stroke, color)

    if (node.independentStrokeWeights) {
      drawIndividualSideStrokes(r, canvas, node, stroke)
    } else if (!drawFigmaDashes(r, canvas, node, stroke)) {
      drawRRectStrokeWithAlign(r, canvas, rrect, node, stroke)
    }
  })
}

export function renderComponentSet(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const rrect = fillRoundedBounds(r, canvas, node, graph)
  // A set without a stroke gets its dashed editing border from the overlay pass.
  forVisibleStrokes(r, node, graph, (stroke, color) => {
    configureStrokePaint(r, node, stroke, color)
    if (drawFigmaDashes(r, canvas, node, stroke)) {
      return
    }
    const dashPhase = stroke.dashPattern?.[1] ?? 0
    if (stroke.dashPattern && stroke.dashPattern.length > 0) {
      drawDashedRRectWithSolidCorners(
        r,
        canvas,
        node,
        stroke,
        color,
        // Skia fits a rounded rect's radii to its bounds; the dashed outline must match the fill.
        Math.min(node.cornerRadius, node.width / 2, node.height / 2),
        dashPhase
      )
    } else {
      drawStyledRRectStroke(r, canvas, rrect, node, stroke, color, dashPhase)
    }
  })
}
