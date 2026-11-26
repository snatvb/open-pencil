import type { Paint } from '@open-pencil/canvaskit'

import type { SkiaRenderer } from '#core/canvas/renderer/skia'

/** Records that `paint`, when it is a shared one, now carries a shader. */
export function markShaded(r: SkiaRenderer, paint: Paint): void {
  if (paint === r.fillPaint) {
    r.fillPaintShaded = true
  } else if (paint === r.strokePaint) {
    r.strokePaintShaded = true
  }
}
