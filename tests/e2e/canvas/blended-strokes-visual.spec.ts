import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('blended strokes', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) {
      throw new Error('OpenPencil store not initialized')
    }
    const pageId = store.state.currentPageId
    const modes = ['NORMAL', 'MULTIPLY', 'LIGHTEN', 'SCREEN', 'LUMINOSITY'] as const
    const fills = [
      {
        type: 'SOLID' as const,
        color: { r: 0.85, g: 0.4, b: 0.05, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
    for (const [index, blendMode] of modes.entries()) {
      const x = 60 + index * 160
      const stroke = {
        type: 'SOLID' as const,
        color: { r: 0.55, g: 0.8, b: 1, a: 1 },
        weight: 24,
        visible: true,
        opacity: 1,
        align: 'INSIDE' as const,
        blendMode
      }
      store.graph.createNode('RECTANGLE', pageId, {
        name: `${blendMode} stroke visual`,
        x,
        y: 80,
        width: 120,
        height: 120,
        fills,
        strokes: [stroke]
      })
      store.graph.createNode('VECTOR', pageId, {
        name: `${blendMode} vector stroke visual`,
        x,
        y: 240,
        width: 120,
        height: 120,
        vectorNetwork: {
          vertices: [
            { x: 60, y: 0 },
            { x: 120, y: 120 },
            { x: 0, y: 120 }
          ],
          segments: [0, 1, 2].map((start) => ({
            start,
            end: (start + 1) % 3,
            tangentStart: { x: 0, y: 0 },
            tangentEnd: { x: 0, y: 0 }
          })),
          regions: [{ windingRule: 'NONZERO' as const, loops: [[0, 1, 2]] }]
        },
        fills,
        strokes: [{ ...stroke, align: 'CENTER' as const }]
      })
    }

    store.clearSelection()
    store.requestRender()
  })
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  const buffer = await editor.canvas.screenshotCanvasRegion()
  expect(buffer).toMatchSnapshot('blended-strokes.png')
})
