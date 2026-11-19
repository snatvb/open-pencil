import type { Image } from '@open-pencil/canvaskit'

import { ResourceCache } from '#core/cache/resource'

export const IMAGE_CACHE_BYTES = 128 * 1024 * 1024

type Sized = Pick<Image, 'width' | 'height'>

export function decodedImageBytes(image: Sized): number {
  return Math.ceil(image.width() * image.height() * 4 * (4 / 3))
}

/** Own decoded images, including an estimate for their mipmaps. Pictures may retain references. */
export function createImageCache<T extends Pick<Image, 'width' | 'height' | 'delete'> = Image>(
  maxBytes = IMAGE_CACHE_BYTES
) {
  return new ResourceCache<string, T>({
    maxEntries: 256,
    maxWeight: maxBytes,
    weight: decodedImageBytes,
    dispose: (image) => image.delete()
  })
}

export interface KeptImage {
  readonly image: Image
  readonly temporary: boolean
}

export function keptImage(
  cache: ResourceCache<string, Image>,
  key: string,
  make: () => Image | null
): KeptImage | null {
  const kept = cache.get(key)
  if (kept) {
    return { image: kept, temporary: false }
  }
  const image = make()
  if (!image) {
    return null
  }
  return { image, temporary: !cache.set(key, image) }
}

export function releaseKeptImage({ image, temporary }: KeptImage): void {
  if (temporary) {
    image.delete()
  }
}
