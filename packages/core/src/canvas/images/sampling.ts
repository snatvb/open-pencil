import type { Image, Shader } from '@open-pencil/canvaskit'
import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { getWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import Matrix from '@open-pencil/scene-graph/matrix'

import type { SkiaRenderer } from '#core/canvas/renderer/skia'

const SCALE_TOLERANCE = 1e-6
const PIXEL_TOLERANCE = 1e-3

function isWholeScale(value: number): boolean {
  return (
    Math.abs(value) >= 1 - SCALE_TOLERANCE && Math.abs(value - Math.round(value)) < SCALE_TOLERANCE
  )
}

function isZero(value: number): boolean {
  return Math.abs(value) < SCALE_TOLERANCE
}

function isWholePixel(value: number): boolean {
  return Math.abs(value - Math.round(value)) < PIXEL_TOLERANCE
}

/** Figma keeps an export's image sharp where its pixels land on whole output pixels, even at 1:1. */
function landsOnOutputPixels(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  localMatrix: number[]
): boolean {
  const output = r.images.supersampledOutput
  if (!output) {
    return false
  }
  const [xx, xy, tx, yx, yy, ty] = Matrix.multiply(
    output.outputFromWorld,
    getWorldMatrix(node, graph),
    localMatrix
  )
  const upright = isWholeScale(xx) && isWholeScale(yy) && isZero(xy) && isZero(yx)
  const quarterTurned = isZero(xx) && isZero(yy) && isWholeScale(xy) && isWholeScale(yx)
  return (upright || quarterTurned) && isWholePixel(tx) && isWholePixel(ty)
}

export function drawLaidOutByShader<T>(r: SkiaRenderer, draw: () => T): T {
  const output = r.images.supersampledOutput
  const laidOut = r.images.laidOutByShader
  r.images.supersampledOutput = null
  r.images.laidOutByShader = true
  try {
    return draw()
  } finally {
    r.images.supersampledOutput = output
    r.images.laidOutByShader = laidOut
  }
}

export function drawAtDetail<T>(r: Pick<SkiaRenderer, 'images'>, detail: number, draw: () => T): T {
  const outer = r.images.detailScale
  r.images.detailScale = detail
  try {
    return draw()
  } finally {
    r.images.detailScale = outer
  }
}

export interface SamplingDetailRange {
  readonly min: number
  readonly max: number
}

export const EVERY_DETAIL: SamplingDetailRange = { min: 0, max: Number.POSITIVE_INFINITY }

export function samplesAlikeAt(range: SamplingDetailRange, detail: number): boolean {
  return range.min <= detail && detail < range.max
}

export function noteSamplingDetail(r: SkiaRenderer, range: SamplingDetailRange): void {
  const current = r.images.samplingDetail
  r.images.samplingDetail = {
    min: Math.max(current.min, range.min),
    max: Math.min(current.max, range.max)
  }
}

export function recordSamplingDetail<T>(
  r: SkiaRenderer,
  record: () => T
): { value: T; detail: SamplingDetailRange } {
  const outer = r.images.samplingDetail
  r.images.samplingDetail = EVERY_DETAIL
  try {
    const value = record()
    return { value, detail: r.images.samplingDetail }
  } finally {
    const recorded = r.images.samplingDetail
    r.images.samplingDetail = outer
    noteSamplingDetail(r, recorded)
  }
}

export function smallestSingularValue(matrix: number[]): number {
  const [a, b, , c, d] = matrix
  const squares = a * a + b * b + c * c + d * d
  const determinant = Math.abs(a * d - b * c)
  const spread = Math.sqrt(Math.max(0, squares * squares - 4 * determinant * determinant))
  const longest = Math.sqrt((squares + spread) / 2)
  return longest > 0 ? determinant / longest : 0
}

/**
 * Figma samples nearest where every image pixel covers more than a device pixel, as a GPU's
 * magnification filter.
 */
function magnifiedOnDevice(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  localMatrix: number[],
  drawsOriginalPixels: boolean
): boolean {
  if (r.images.laidOutByShader || !drawsOriginalPixels) {
    return false
  }
  const step = smallestSingularValue(Matrix.multiply(getWorldMatrix(node, graph), localMatrix))
  if (step <= 0) {
    return false
  }
  const threshold = (1 + SCALE_TOLERANCE) / step
  const magnified = r.images.detailScale >= threshold
  noteSamplingDetail(
    r,
    magnified ? { min: threshold, max: Number.POSITIVE_INFINITY } : { min: 0, max: threshold }
  )
  return magnified
}

export type ImageSampling = 'smooth' | 'nearest' | 'nearest-at-output-pixel-centres'

export function imageSampling(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  localMatrix: number[],
  drawsOriginalPixels: boolean
): ImageSampling {
  if (landsOnOutputPixels(r, node, graph, localMatrix)) {
    return 'nearest'
  }
  if (!magnifiedOnDevice(r, node, graph, localMatrix, drawsOriginalPixels)) {
    return 'smooth'
  }
  return r.images.supersampledOutput ? 'nearest-at-output-pixel-centres' : 'nearest'
}

function imageTileMode(r: SkiaRenderer, scaleMode: NonNullable<Fill['imageScaleMode']>) {
  if (scaleMode === 'TILE') {
    return r.ck.TileMode.Repeat
  }
  return scaleMode === 'FIT' ? r.ck.TileMode.Decal : r.ck.TileMode.Clamp
}

export function makeImageShader(
  r: SkiaRenderer,
  img: Image,
  scaleMode: NonNullable<Fill['imageScaleMode']>,
  localMatrix: number[],
  nearest: boolean
): Shader {
  const { FilterMode, MipmapMode } = r.ck
  const tileMode = imageTileMode(r, scaleMode)
  if (nearest) {
    return img.makeShaderOptions(
      tileMode,
      tileMode,
      FilterMode.Nearest,
      MipmapMode.None,
      localMatrix
    )
  }
  if (scaleMode === 'TILE') {
    return img.makeShaderCubic(tileMode, tileMode, 1 / 3, 1 / 3, localMatrix)
  }
  return img.makeShaderOptions(
    tileMode,
    tileMode,
    FilterMode.Linear,
    MipmapMode.Linear,
    localMatrix
  )
}
