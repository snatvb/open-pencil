import type { RenderChunk } from './build'

/** Chunks over some bounds, in no particular order, and the farthest backdrop reach among them. */
export interface ChunkSearch {
  chunks: readonly RenderChunk[]
  backdropReach: number
}

export interface ChunkSearchLimits {
  searches: number
  chunkReferences: number
}

/** 8 MB of chunk references on a 64-bit engine, whatever the page. */
const DEFAULT_LIMITS: ChunkSearchLimits = { searches: 4096, chunkReferences: 1 << 20 }

/**
 * Searches remembered until the chunks change, cleared whole once they would pass `limits` in
 * count or in chunk references held, so a page-wide chunk found by every tile cannot pin memory.
 */
export class RememberedChunkSearches {
  private readonly searches = new Map<string, ChunkSearch>()
  private references = 0

  constructor(private readonly limits: ChunkSearchLimits = DEFAULT_LIMITS) {}

  get(id: string): ChunkSearch | undefined {
    return this.searches.get(id)
  }

  remember(id: string, search: ChunkSearch): void {
    const references = this.references + search.chunks.length
    if (this.searches.size >= this.limits.searches || references > this.limits.chunkReferences) {
      this.clear()
    }
    this.searches.set(id, search)
    this.references += search.chunks.length
  }

  clear(): void {
    this.searches.clear()
    this.references = 0
  }

  get size(): number {
    return this.searches.size
  }

  get chunkReferences(): number {
    return this.references
  }
}
