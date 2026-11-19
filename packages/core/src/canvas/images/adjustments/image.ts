import type { Image } from '@open-pencil/canvaskit'
import type { ImageFilters } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer/skia'

import { saturationBoost, type Sliders, slidersMoved, tableSaturation } from './color'
import { adjustmentTable, adjustPixels } from './table'

export interface AdjustmentTable {
  readonly colors: Float32Array
  texture: Image | null
}

const RGBA_BYTES = 4

function adjustmentKey(values: Sliders): string {
  return Object.values(values).join(',')
}

export function adjustedImageKey(key: string, filters: ImageFilters | undefined): string | null {
  const values = slidersMoved(filters)
  return values && `${key}:adjusted:${adjustmentKey(values)}`
}

function tableKey(values: Sliders): string {
  return adjustmentKey({ ...values, saturation: tableSaturation(values.saturation) })
}

export function adjustmentTableOf(r: SkiaRenderer, values: Sliders): AdjustmentTable {
  const key = tableKey(values)
  const kept = r.images.adjustmentTables.get(key)
  if (kept) {
    return kept
  }
  const table: AdjustmentTable = { colors: adjustmentTable(values), texture: null }
  r.images.adjustmentTables.set(key, table)
  return table
}

export function adjustedImage(
  r: SkiaRenderer,
  image: Image,
  filters: ImageFilters | undefined
): Image | null {
  const values = slidersMoved(filters)
  if (!values) {
    return null
  }
  const info = {
    width: image.width(),
    height: image.height(),
    alphaType: r.ck.AlphaType.Unpremul,
    colorType: r.ck.ColorType.RGBA_8888,
    colorSpace: r.ck.ColorSpace.SRGB
  }
  const pixels = image.readPixels(0, 0, info)
  if (!(pixels instanceof Uint8Array)) {
    return null
  }
  adjustPixels(pixels, adjustmentTableOf(r, values).colors, saturationBoost(values.saturation))
  const flat = r.ck.MakeImage(info, pixels, info.width * RGBA_BYTES)
  if (!flat) {
    return null
  }
  try {
    return flat.makeCopyWithDefaultMipmaps()
  } finally {
    flat.delete()
  }
}
