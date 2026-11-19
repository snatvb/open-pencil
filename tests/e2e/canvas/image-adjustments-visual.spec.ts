import { readFile } from 'node:fs/promises'

import type { ImageFilters } from '@open-pencil/scene-graph'
import { repoPath } from '@open-pencil/test-support/paths'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

const ADJUSTMENTS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows'
] as const satisfies readonly (keyof ImageFilters)[]

const ROWS: { label: string; filters: ImageFilters[] }[] = [
  { label: 'at -1', filters: [{}, ...ADJUSTMENTS.map((name) => ({ [name]: -1 }))] },
  {
    label: 'at +1',
    filters: [{ exposure: -1, contrast: -1 }, ...ADJUSTMENTS.map((name) => ({ [name]: 1 }))]
  }
]

test('image adjustments draw at both ends of each slider', async () => {
  const bytes = await readFile(repoPath('tests/fixtures/vectorize/pilot_avatar.png'))
  await editor.page.evaluate(
    ({ data, rows }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) {
        throw new Error('OpenPencil store not initialized')
      }
      const imageHash = store.storeImage(new Uint8Array(data))
      const pageId = store.state.currentPageId
      for (const [row, { label, filters }] of rows.entries()) {
        for (const [column, adjustments] of filters.entries()) {
          store.graph.createNode('RECTANGLE', pageId, {
            name: `image ${label} ${column}`,
            x: 40 + column * 100,
            y: 60 + row * 110,
            width: 88,
            height: 88,
            fills: [
              {
                type: 'IMAGE',
                color: { r: 0, g: 0, b: 0, a: 1 },
                visible: true,
                opacity: 1,
                imageHash,
                imageScaleMode: 'FILL',
                filters: adjustments
              }
            ]
          })
        }
      }
      store.clearSelection()
      store.requestRender()
    },
    { data: [...bytes], rows: ROWS }
  )
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion()).toMatchSnapshot('image-adjustments.png')
})
