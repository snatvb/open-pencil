import type { Canvas } from '@open-pencil/canvaskit'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import { isLayerContainer } from '@open-pencil/scene-graph/node-defaults'

import { hasImageAdjustments } from '#core/canvas/images/adjustments'
import { noteSamplingDetail, recordSamplingDetail } from '#core/canvas/images/sampling'
import { recordPicture } from '#core/canvas/renderer/picture'
import { samplingSlotsFor } from '#core/canvas/renderer/sampling-slots'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { localPaintBounds } from '#core/geometry/render-bounds'

function imagePaints(node: SceneNode): Fill[] {
  const regionFills = node.vectorNetwork?.regions.flatMap((region) => region.fills ?? []) ?? []
  return [...node.fills, ...node.strokes, ...regionFills].filter(
    (paint) => paint.visible && paint.imageHash !== undefined
  )
}

function drawsImage(node: SceneNode): boolean {
  return imagePaints(node).length > 0
}

function drawsAdjustedImage(node: SceneNode): boolean {
  return imagePaints(node).some((paint) => hasImageAdjustments(paint.filters))
}

/** Noise samples once per output pixel in an export, so it follows that export's pixel grid. */
function drawsNoise(node: SceneNode): boolean {
  return node.effects.some((effect) => effect.visible && effect.type === 'NOISE')
}

/**
 * Its sampling depends on where the layer lands on the export's pixels, which no key follows:
 * an image's, and a noise's, which is taken once per output pixel.
 */
function samplesImagesForExport(r: SkiaRenderer, node: SceneNode): boolean {
  return r.images.supersampledOutput !== null && (drawsImage(node) || drawsNoise(node))
}

function drawsBakedImagesForExport(r: SkiaRenderer, node: SceneNode): boolean {
  return r.images.exporting !== null && drawsAdjustedImage(node)
}

/**
 * Draws a shape with effects from its node picture, recording one when there is none: the
 * picture holds the shape with its shadows and blurs, so a tile that holds it again replays it
 * rather than building the effects again.
 */
export function drawShapeThroughNodePicture(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  draw: (target: Canvas) => void
): void {
  if (
    r.builtInBlendModesOnly ||
    samplesImagesForExport(r, node) ||
    drawsBakedImagesForExport(r, node)
  ) {
    draw(canvas)
    return
  }
  const slots = r.nodePictures.get(node.id)
  const cached = slots?.at(r.images.detailScale)
  if (cached && cached.fontGeneration === r.fontGeneration) {
    noteSamplingDetail(r, cached.samplingDetail)
    canvas.drawPicture(cached.picture)
    return
  }
  if (cached) {
    slots?.drop(cached)
  }

  const castsShadowsInPicture = !isLayerContainer(node)
  const drawn = localPaintBounds(node, castsShadowsInPicture) ?? {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0
  }
  const bounds = r.ck.LTRBRect(drawn.minX, drawn.minY, drawn.maxX, drawn.maxY)
  const { value: picture, detail } = recordSamplingDetail(r, () => recordPicture(r, bounds, draw))
  samplingSlotsFor(r.nodePictures, node.id).put({
    picture,
    fontGeneration: r.fontGeneration,
    samplingDetail: detail
  })
  canvas.drawPicture(picture)
}
