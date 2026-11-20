import type { Canvas, Image, Paint, Shader } from '@open-pencil/canvaskit'
import type { SceneNode, SceneGraph, Fill, Stroke } from '@open-pencil/scene-graph'
import { invertGradientTransform } from '@open-pencil/scene-graph/gradient'
import { drawnImageHash, imageFillMatrix } from '@open-pencil/scene-graph/images'
import Matrix from '@open-pencil/scene-graph/matrix'
import { fillGeometryMatchesRegions, hasRegionFills } from '@open-pencil/scene-graph/vector-network'

import { setPaintBlendMode } from '#core/canvas/blend/modes'
import { hasImageAdjustments, makeAdjustedImageShader } from '#core/canvas/images/adjustments'
import { adjustedImageForExport } from '#core/canvas/images/exporting'
import { previewEdge } from '#core/canvas/images/previews'
import { landsOnOutputPixels, makeImageShader } from '#core/canvas/images/sampling'
import { applyPatternFill } from '#core/canvas/patterns/fill'
import { resolveGradientStopColor } from '#core/canvas/renderer/colors'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { drawOutline, withNodeOutline } from '#core/canvas/shapes'

import { makeDiamondGradient } from './gradients/diamond'

interface PaintFillsOptions {
  readonly bindToNodeFills?: boolean
}

export function paintFills(
  r: SkiaRenderer,
  fills: readonly Fill[],
  node: SceneNode,
  graph: SceneGraph,
  draw: (fill: Fill) => void,
  options: PaintFillsOptions = {}
): void {
  for (let index = 0; index < fills.length; index++) {
    const fill = fills[index]
    if (!fill.visible) continue
    const fillIndex = options.bindToNodeFills === false ? -1 : index
    if (!r.applyFill(fill, node, graph, fillIndex)) {
      continue
    }
    r.fillPaint.setAlphaf(fill.opacity)
    const blends = fill.blendMode !== undefined && fill.blendMode !== 'NORMAL'
    if (blends) setPaintBlendMode(r, r.fillPaint, fill.blendMode)
    draw(fill)
    clearFillShader(r)
    if (blends) setPaintBlendMode(r, r.fillPaint, 'NORMAL')
  }
}

export function drawVectorMultiStyleFills(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): boolean {
  const network = node.type === 'VECTOR' ? node.vectorNetwork : null
  if (!network || !hasRegionFills(network)) return false
  const { regions } = network
  const paths =
    (fillGeometryMatchesRegions(node.fillGeometry, network) ? r.getFillGeometry(node) : null) ??
    r.getVectorPaths(node)
  if (!paths) return false

  for (const [index, region] of regions.entries()) {
    const path = paths[index]
    paintFills(
      r,
      region.fills ?? node.fills,
      node,
      graph,
      () => canvas.drawPath(path, r.fillPaint),
      { bindToNodeFills: !region.fills }
    )
  }
  return true
}

/** Clears the fill paint's shader, when it has one; a layer with plain fills makes no call. */
export function clearFillShader(r: SkiaRenderer): void {
  if (!r.fillPaintShaded) return
  r.fillPaint.setShader(null)
  r.fillPaintShaded = false
}

export function clearStrokeShader(r: SkiaRenderer): void {
  if (!r.strokePaintShaded) return
  r.strokePaint.setShader(null)
  r.strokePaintShaded = false
}

/** Records that `paint`, when it is a shared one, now carries a shader. */
function markShaded(r: SkiaRenderer, paint: Paint): void {
  if (paint === r.fillPaint) r.fillPaintShaded = true
  else if (paint === r.strokePaint) r.strokePaintShaded = true
}

export function drawNodeFill(r: SkiaRenderer, canvas: Canvas, node: SceneNode, fill?: Fill): void {
  if (node.type === 'TEXT') r.renderText(canvas, node, fill)
  else if (node.type !== 'LINE') {
    withNodeOutline(r, node, (outline) => drawOutline(canvas, outline, r.fillPaint))
  }
}

function drawSourceFills(r: SkiaRenderer, canvas: Canvas, source: SceneNode, graph: SceneGraph) {
  if (!drawVectorMultiStyleFills(r, canvas, source, graph)) {
    paintFills(r, source.fills, source, graph, (fill) => drawNodeFill(r, canvas, source, fill))
  }
}

export function applyFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  fillIndex = 0
): boolean {
  clearFillShader(r)

  if (fill.type === 'SOLID') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColorComponents(c.r, c.g, c.b, c.a)
    return true
  }

  if (fill.type.startsWith('GRADIENT') && fill.gradientStops && fill.gradientTransform) {
    return applyGradientFill(r, fill, node, graph)
  }

  if (drawnImageHash(fill)) {
    return applyImageFill(r, fill, node, graph)
  }

  if (fill.type === 'PATTERN' && applyPatternFill(r, fill, node, graph, drawSourceFills)) {
    return true
  }

  if (fill.type === 'PATTERN' || fill.type === 'NOISE' || fill.type === 'CUSTOM') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColorComponents(c.r, c.g, c.b, c.a)
    return true
  }

  return false
}

/**
 * Gradient space to the layer's pixels: Figma's transform maps the other way, so it is inverted.
 * A side with no length counts as one pixel, so a straight line still carries its gradient.
 */
function makeGradientLocalMatrix(
  r: SkiaRenderer,
  width: number,
  height: number,
  transform: NonNullable<Fill['gradientTransform']>
) {
  const t = invertGradientTransform(transform)
  return r.ck.Matrix.multiply(r.ck.Matrix.scaled(width || 1, height || 1), Matrix.fromAffine(t))
}

/**
 * Sets `paint`'s shader to `fill`'s gradient on `node` and returns whether it did. CanvasKit
 * builds no shader when the local matrix cannot be inverted, as for a transform that holds no
 * numbers; the paint then keeps no shader, and the caller draws nothing rather than its color.
 */
export function applyGradientFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  paint: Paint = r.fillPaint
): boolean {
  const stops = fill.gradientStops
  const t = fill.gradientTransform
  if (!stops || !t) return false
  const colors = stops.map((s) => {
    const c = resolveGradientStopColor(s.color, graph, r.presentationColorSpace)
    return r.ck.Color4f(c.r, c.g, c.b, c.a)
  })
  const positions = stops.map((s) => s.position)

  const w = node.width
  const h = node.height

  /** The paint keeps its own reference, so the caller's handle has to go or WASM memory grows. */
  const setShader = (shader: Shader | null): boolean => {
    if (!shader) return false
    try {
      paint.setShader(shader)
      markShaded(r, paint)
    } finally {
      shader.delete()
    }
    return true
  }

  if (fill.type === 'GRADIENT_LINEAR') {
    // Drawn in gradient space, so its bands follow the transform's second axis as in Figma
    // rather than running square to the line on a stretched layer.
    const shader = r.ck.Shader.MakeLinearGradient(
      [0, 0.5],
      [1, 0.5],
      colors,
      positions,
      r.ck.TileMode.Clamp,
      makeGradientLocalMatrix(r, w, h, t)
    )
    return setShader(shader)
  } else if (fill.type === 'GRADIENT_DIAMOND') {
    return setShader(makeDiamondGradient(r, colors, positions, makeGradientLocalMatrix(r, w, h, t)))
  } else if (fill.type === 'GRADIENT_RADIAL') {
    // Gradient space is centred on (0.5, 0.5) with radius 0.5; the local matrix takes it to the
    // layer's pixels.
    const localMatrix = makeGradientLocalMatrix(r, w, h, t)
    const shader = r.ck.Shader.MakeRadialGradient(
      [0.5, 0.5],
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    return setShader(shader)
  } else if (fill.type === 'GRADIENT_ANGULAR') {
    const localMatrix = makeGradientLocalMatrix(r, w, h, t)
    const shader = r.ck.Shader.MakeSweepGradient(
      0.5,
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    return setShader(shader)
  }
  return false
}

/**
 * `img` laid out as `fill` places it on `node`; `preview`, when `img` is a downscaled preview,
 * keeps a tiled image at its original size.
 */
function placedImageShader(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  img: Image,
  preview?: { originalWidth: number; originalHeight: number }
): Shader {
  const localMatrix = imageFillMatrix(
    fill,
    node,
    img.width(),
    img.height(),
    preview && { width: preview.originalWidth, height: preview.originalHeight }
  )
  return makeImageShader(
    r,
    img,
    fill.imageScaleMode ?? 'FILL',
    localMatrix,
    landsOnOutputPixels(r, node, graph, localMatrix)
  )
}

function setImageShader(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  img: Image,
  paint: Paint,
  preview?: { originalWidth: number; originalHeight: number }
): boolean {
  const image = placedImageShader(r, fill, node, graph, img, preview)
  let shader = image
  try {
    if (hasImageAdjustments(fill.filters)) shader = makeAdjustedImageShader(r, image, fill.filters)
    paint.setShader(shader)
    markShaded(r, paint)
  } finally {
    if (shader !== image) shader.delete()
    image.delete()
  }
  return true
}

function setBakedImageShader(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  baked: Image,
  paint: Paint
): boolean {
  const shader = placedImageShader(r, fill, node, graph, baked)
  try {
    paint.setShader(shader)
    markShaded(r, paint)
  } finally {
    shader.delete()
  }
  return true
}

function decodedOnDemand(r: SkiaRenderer, data: Uint8Array | undefined) {
  let decoded: Image | null | undefined
  return {
    image(): Image | null {
      if (decoded === undefined) {
        decoded = data ? r.ck.MakeImageFromEncoded(data) : null
      }
      return decoded
    },
    release(): void {
      decoded?.delete()
    }
  }
}

export function applyImageFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  paint: Paint = r.fillPaint,
  stroke?: Stroke
): boolean {
  const hash = drawnImageHash(fill)
  if (!hash) return false
  const live = r.images.live.get(hash)
  if (live?.surface === r.surface) {
    return setImageShader(r, fill, node, graph, live.image, paint)
  }
  if (r.viewportImageRendering) {
    r.noteImageFillUser(hash, node.id)
    r.images.previewsDrawn = true
  }
  // The preview's resolution follows the detail the drawing is for: the viewport's scale, or a
  // tile's level, whose chunk pictures record again when a finer tile needs more.
  const preview = r.viewportImageRendering
    ? r.images.previews.get(graph, hash, previewEdge(node, r.images.detailScale))
    : undefined
  if (r.viewportImageRendering && !preview) return false
  const key = preview?.key ?? hash
  const cached = r.images.cache.get(key)
  const encoded = decodedOnDemand(r, preview?.preview.bytes ?? graph.images.get(hash))
  let img = cached
  let temporary = false
  try {
    const filters = fill.filters
    const baked =
      !preview &&
      hasImageAdjustments(filters) &&
      adjustedImageForExport(r, { hash, filters, node, stroke }, () => cached ?? encoded.image())
    if (baked) {
      return setBakedImageShader(r, fill, node, graph, baked, paint)
    }
    if (!img) {
      const decoded = encoded.image()
      if (!decoded) {
        return false
      }
      img = decoded.makeCopyWithDefaultMipmaps()
      temporary = !r.images.cache.set(key, img)
    }
  } finally {
    encoded.release()
  }

  try {
    return setImageShader(r, fill, node, graph, img, paint, preview?.preview)
  } finally {
    if (temporary) img.delete()
  }
}
