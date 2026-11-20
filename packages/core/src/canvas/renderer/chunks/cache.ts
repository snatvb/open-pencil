import type { SkPicture } from '@open-pencil/canvaskit'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { recordSamplingDetail } from '#core/canvas/images/sampling'
import {
  type SampledPicture,
  type SamplingSlots,
  samplingSlotsFor
} from '#core/canvas/renderer/sampling-slots'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'

import type { RenderChunk } from './index'
import { recordRenderChunk } from './record'

interface CachedChunkPicture extends SampledPicture {
  picture: SkPicture
  fontGeneration: number
  /** The detail the picture's image previews were chosen for; none when it drew no preview. */
  previewDetail: number | null
}

/** Read after recording, through a call, so the flag reset before it is not taken as final. */
function drewPreviews(renderer: Pick<SkiaRenderer, 'images'>): boolean {
  return renderer.images.previewsDrawn
}

export class RenderChunkPictureCache {
  private readonly entries = new Map<string, SamplingSlots<CachedChunkPicture>>()

  /**
   * A picture holds for the renderer's fonts, and, when it drew image previews, for a detail no
   * finer than it was recorded at: a tile two levels in asks for sharper previews than one
   * recorded at a page's fit zoom, and gets them recorded again.
   */
  private current(renderer: SkiaRenderer, cached: CachedChunkPicture | undefined): boolean {
    return (
      cached !== undefined &&
      cached.fontGeneration === renderer.fontGeneration &&
      (cached.previewDetail === null || cached.previewDetail >= renderer.images.detailScale)
    )
  }

  private sampledAlike(renderer: SkiaRenderer, chunkId: string): CachedChunkPicture | undefined {
    return this.entries.get(chunkId)?.at(renderer.images.detailScale)
  }

  private dropStale(chunkId: string, stale: CachedChunkPicture): void {
    const slots = this.entries.get(chunkId)
    slots?.drop(stale)
    if (slots?.size === 0) {
      this.entries.delete(chunkId)
    }
  }

  get(renderer: SkiaRenderer, graph: SceneGraph, chunk: RenderChunk): SkPicture {
    const cached = this.sampledAlike(renderer, chunk.id)
    if (cached && this.current(renderer, cached)) {
      return cached.picture
    }
    if (cached) {
      this.dropStale(chunk.id, cached)
    }
    renderer.images.previewsDrawn = false
    const { value: recorded, detail } = recordSamplingDetail(renderer, () =>
      recordRenderChunk(renderer, graph, chunk)
    )
    samplingSlotsFor(this.entries, chunk.id).put({
      picture: recorded.picture,
      fontGeneration: renderer.fontGeneration,
      previewDetail: drewPreviews(renderer) ? renderer.images.detailScale : null,
      samplingDetail: detail
    })
    return recorded.picture
  }

  /** Whether `chunk`'s picture is recorded for the renderer's current fonts and detail. */
  has(renderer: SkiaRenderer, chunk: RenderChunk): boolean {
    return this.current(renderer, this.sampledAlike(renderer, chunk.id))
  }

  invalidate(chunkId: string): void {
    this.entries.get(chunkId)?.release()
    this.entries.delete(chunkId)
  }

  clear(): void {
    for (const slots of this.entries.values()) {
      slots.release()
    }
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }
}
