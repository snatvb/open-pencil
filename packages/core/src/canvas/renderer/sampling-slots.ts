import { partition } from 'es-toolkit'

import { samplesAlikeAt, type SamplingDetailRange } from '#core/canvas/images/sampling'

export interface SampledPicture {
  readonly picture: { delete(): void }
  readonly samplingDetail: SamplingDetailRange
}

const MAX_SAMPLING_REGIMES = 4

function overlaps(a: SamplingDetailRange, b: SamplingDetailRange): boolean {
  return a.min < b.max && b.min < a.max
}

export class SamplingSlots<T extends SampledPicture> {
  private entries: T[] = []

  at(detail: number): T | undefined {
    const entry = this.entries.find((candidate) => samplesAlikeAt(candidate.samplingDetail, detail))
    if (entry) {
      this.entries = [entry, ...this.entries.filter((other) => other !== entry)]
    }
    return entry
  }

  put(entry: T): void {
    const [replaced, kept] = partition(this.entries, (other) =>
      overlaps(other.samplingDetail, entry.samplingDetail)
    )
    const evicted = kept.splice(MAX_SAMPLING_REGIMES - 1)
    for (const old of [...replaced, ...evicted]) {
      old.picture.delete()
    }
    this.entries = [entry, ...kept]
  }

  drop(entry: T): void {
    entry.picture.delete()
    this.entries = this.entries.filter((other) => other !== entry)
  }

  release(): void {
    for (const entry of this.entries) {
      entry.picture.delete()
    }
    this.entries = []
  }

  get size(): number {
    return this.entries.length
  }
}

export function samplingSlotsFor<T extends SampledPicture>(
  slots: Map<string, SamplingSlots<T>>,
  key: string
): SamplingSlots<T> {
  const existing = slots.get(key)
  if (existing) {
    return existing
  }
  const created = new SamplingSlots<T>()
  slots.set(key, created)
  return created
}
