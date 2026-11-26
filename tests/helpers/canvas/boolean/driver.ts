import type { Page } from '@playwright/test'

import type * as BooleanScenes from '#tests/helpers/canvas/boolean/scene'
import { pageScene } from '#tests/helpers/canvas/page-scene'

export function booleanScenesDriver(page: () => Page) {
  const scenes = pageScene<typeof BooleanScenes>(page, '/tests/helpers/canvas/boolean/scene.ts')
  return {
    showStrokeAlignment: () => scenes.build('createBooleanStrokeAlignmentScene'),
    showFillBlends: () => scenes.build('createBooleanFillBlendScene')
  }
}
