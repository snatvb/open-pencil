import type { Canvas, Image, Paint, Shader } from 'canvaskit-wasm'

import type { SceneNode, SceneGraph, Fill } from '@open-pencil/scene-graph'
import { invertGradientTransform } from '@open-pencil/scene-graph/gradient'
import Matrix from '@open-pencil/scene-graph/matrix'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { figmaBlendModeToSkia } from './blend'
import { makeDiamondGradient } from './gradients/diamond'
import { previewEdge } from './images/previews'
import { applyPatternFill } from './patterns/fill'
import type { SkiaRenderer } from './renderer'
import { drawOutline, withNodeOutline } from './shapes'

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
    r.fillPaint.setBlendMode(figmaBlendModeToSkia(r.ck, fill.blendMode))
    draw(fill)
    r.fillPaint.setShader(null)
    r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
  }
}

export function drawVectorMultiStyleFills(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): boolean {
  if (node.type !== 'VECTOR' || !node.fillGeometry.some((geometry) => geometry.fills?.length)) {
    return false
  }
  const paths = r.getFillGeometry(node)
  if (!paths) return false

  for (let index = 0; index < node.fillGeometry.length; index++) {
    const geometry = node.fillGeometry[index]
    const path = paths[index]
    const usesPathFills = Boolean(geometry.fills?.length)
    paintFills(
      r,
      usesPathFills ? (geometry.fills ?? []) : node.fills,
      node,
      graph,
      () => canvas.drawPath(path, r.fillPaint),
      { bindToNodeFills: !usesPathFills }
    )
  }
  return true
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
  r.fillPaint.setShader(null)

  if (fill.type === 'SOLID') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
    return true
  }

  if (fill.type.startsWith('GRADIENT') && fill.gradientStops && fill.gradientTransform) {
    return r.applyGradientFill(fill, node, graph)
  }

  if (fill.type === 'IMAGE' && fill.imageHash) {
    return r.applyImageFill(fill, node, graph)
  }

  if (fill.type === 'PATTERN' && applyPatternFill(r, fill, node, graph, drawSourceFills)) {
    return true
  }

  if (fill.type === 'PATTERN' || fill.type === 'NOISE' || fill.type === 'CUSTOM') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
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
  return r.ck.Matrix.multiply(r.ck.Matrix.scaled(width || 1, height || 1), [
    t.m00,
    t.m01,
    t.m02,
    t.m10,
    t.m11,
    t.m12,
    0,
    0,
    1
  ])
}

/** Resolves one gradient stop's color, so a stroke resolves its own bindings, not a fill's. */
export type ResolveGradientStop = (color: Color, stopIndex: number) => Color

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
  paint: Paint = r.fillPaint,
  resolveStop: ResolveGradientStop = (color, stopIndex) =>
    r.resolveFillColorInfo(
      { ...fill, type: 'SOLID', color, opacity: color.a, visible: true },
      stopIndex,
      node,
      graph
    ).color
): boolean {
  const stops = fill.gradientStops
  const t = fill.gradientTransform
  if (!stops || !t) return false
  const colors = stops.map((s, index) => {
    const c = resolveStop(s.color, index)
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
 * Maps `img`'s pixels onto `node` as `fill` places them. `size` is the image's own size when `img`
 * is a downscaled preview, so a tile keeps its size. A crop places the image by its transform;
 * Fill, Fit and Tile ignore it, as Figma does, and turn the image by `imageRotation` first.
 */
export function makeImageFillLocalMatrix(
  fill: Fill,
  node: SceneNode,
  imgW: number,
  imgH: number,
  size: { width: number; height: number } = { width: imgW, height: imgH }
) {
  const scaleMode = fill.imageScaleMode ?? 'FILL'
  if (scaleMode === 'CROP' && fill.imageTransform) {
    const t = fill.imageTransform
    const inverse = Matrix.invert([t.m00, t.m01, t.m02, t.m10, t.m11, t.m12, 0, 0, 1])
    if (inverse)
      return Matrix.multiply(
        Matrix.scaled(node.width, node.height),
        inverse,
        Matrix.scaled(1 / imgW, 1 / imgH)
      )
  }

  const radians = ((fill.imageRotation ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const turnedW = size.width * cos + size.height * sin
  const turnedH = size.width * sin + size.height * cos
  const turned = Matrix.multiply(
    Matrix.translated(turnedW / 2, turnedH / 2),
    Matrix.rotated(radians),
    Matrix.translated(-size.width / 2, -size.height / 2),
    Matrix.scaled(size.width / imgW, size.height / imgH)
  )
  if (scaleMode === 'TILE') {
    const scale = fill.scale && fill.scale > 0 ? fill.scale : 1
    return Matrix.multiply(Matrix.scaled(scale, scale), turned)
  }
  const fit = scaleMode === 'FIT'
  const scale = (fit ? Math.min : Math.max)(node.width / turnedW, node.height / turnedH)
  return Matrix.multiply(
    Matrix.translated((node.width - turnedW * scale) / 2, (node.height - turnedH * scale) / 2),
    Matrix.scaled(scale, scale),
    turned
  )
}

/**
 * Sets `paint`'s shader to `img` laid out as `fill` places it on `node`; `preview`, when `img`
 * is a downscaled preview, keeps a tiled image at its original size.
 */
function setImageShader(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  img: Image,
  paint: Paint,
  preview?: { originalWidth: number; originalHeight: number }
): boolean {
  const imgW = img.width()
  const imgH = img.height()
  const scaleMode = fill.imageScaleMode ?? 'FILL'
  const localMatrix = makeImageFillLocalMatrix(
    fill,
    node,
    imgW,
    imgH,
    preview && { width: preview.originalWidth, height: preview.originalHeight }
  )
  const tileMode = scaleMode === 'FIT' ? r.ck.TileMode.Decal : r.ck.TileMode.Clamp
  const shader =
    scaleMode === 'TILE'
      ? img.makeShaderCubic(r.ck.TileMode.Repeat, r.ck.TileMode.Repeat, 1 / 3, 1 / 3, localMatrix)
      : img.makeShaderOptions(
          tileMode,
          tileMode,
          r.ck.FilterMode.Linear,
          r.ck.MipmapMode.Linear,
          localMatrix
        )
  try {
    paint.setShader(shader)
  } finally {
    shader.delete()
  }
  return true
}

export function applyImageFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  paint: Paint = r.fillPaint
): boolean {
  const hash = fill.imageHash
  if (!hash) return false
  const live = r.liveImages.get(hash)
  if (live?.surface === r.surface) return setImageShader(r, fill, node, live.image, paint)
  const preview = r.viewportImageRendering
    ? // eslint-disable-next-line open-pencil/no-zoom-in-scene-drawing -- picks the preview resolution, not a size; preview mode draws the scene uncached on every frame.
      r.imagePreviews.get(graph, hash, previewEdge(node, r.zoom, r.dpr))
    : undefined
  if (r.viewportImageRendering && !preview) return false
  const key = preview?.key ?? hash
  let img = r.imageCache.get(key)
  let temporary = false
  if (!img) {
    const data = preview?.preview.bytes ?? graph.images.get(hash)
    if (!data) return false
    const decoded = r.ck.MakeImageFromEncoded(data)
    if (!decoded) return false
    try {
      img = decoded.makeCopyWithDefaultMipmaps()
    } finally {
      decoded.delete()
    }
    temporary = !r.imageCache.set(key, img)
  }

  try {
    return setImageShader(r, fill, node, img, paint, preview?.preview)
  } finally {
    if (temporary) img.delete()
  }
}
