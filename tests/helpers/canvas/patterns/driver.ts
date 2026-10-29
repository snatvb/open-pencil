import type { Page } from '@playwright/test'

import type * as PatternScenes from '#tests/helpers/canvas/patterns/scene'

export function patternFillDriver(page: () => Page) {
  return {
    show() {
      return page().evaluate(async () => {
        const store = window.openPencil?.getStore?.()
        if (!store) {
          throw new Error('OpenPencil store not initialized')
        }
        const sceneURL = '/tests/helpers/canvas/patterns/scene.ts'
        const scenes: typeof PatternScenes = await import(sceneURL)
        scenes.createPatternFillScene(store.graph, store.state.currentPageId)
        store.clearSelection()
        store.requestRender()
      })
    }
  }
}
