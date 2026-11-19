import type { Image } from '@open-pencil/canvaskit'
import type { ImageFilters } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer/skia'

import { adjustedImage, adjustedImageKey } from './adjustments/image'
import { decodedImageBytes, type KeptImage, keptImage, releaseKeptImage } from './cache'

export interface StoredImageToDraw extends KeptImage {
  readonly shaderFilters?: ImageFilters
}

function decodedImage(r: SkiaRenderer, data: Uint8Array | undefined): Image | null {
  if (!data) {
    return null
  }
  const decoded = r.ck.MakeImageFromEncoded(data)
  if (!decoded) {
    return null
  }
  try {
    return decoded.makeCopyWithDefaultMipmaps()
  } finally {
    decoded.delete()
  }
}

function sourceImage(
  r: SkiaRenderer,
  key: string,
  encoded: () => Uint8Array | undefined
): KeptImage | null {
  const kept = r.images.cache.get(key)
  if (kept) {
    return { image: kept, temporary: false }
  }
  const image = decodedImage(r, encoded())
  return image && { image, temporary: true }
}

function keepAdjusted(r: SkiaRenderer, key: string, image: Image): KeptImage {
  const kept = r.images.cache.set(key, image) || r.images.adjustedOverBudget.set(key, image)
  return { image, temporary: !kept }
}

function adjustsOnGpu(r: SkiaRenderer, source: Image): boolean {
  return (
    decodedImageBytes(source) > r.images.cache.capacity &&
    !r.images.drawsExport &&
    r.surface.reportBackendTypeIsGPU()
  )
}

export function storedImageToDraw(
  r: SkiaRenderer,
  key: string,
  filters: ImageFilters | undefined,
  encoded: () => Uint8Array | undefined
): StoredImageToDraw | null {
  const adjustedKey = adjustedImageKey(key, filters)
  if (!adjustedKey) {
    return keptImage(r.images.cache, key, () => decodedImage(r, encoded()))
  }
  const baked = r.images.cache.get(adjustedKey) ?? r.images.adjustedOverBudget.get(adjustedKey)
  if (baked) {
    return { image: baked, temporary: false }
  }
  const source = sourceImage(r, key, encoded)
  if (!source) {
    return null
  }
  if (adjustsOnGpu(r, source.image)) {
    return { ...source, shaderFilters: filters }
  }
  const adjusted = adjustedImage(r, source.image, filters)
  if (!adjusted) {
    return source
  }
  releaseKeptImage(source)
  return keepAdjusted(r, adjustedKey, adjusted)
}
