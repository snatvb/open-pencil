import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('truncates text that sizes its own width at its max width', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) {
      throw new Error('Missing editor')
    }
    const boxFill = [
      {
        type: 'SOLID' as const,
        color: { r: 0.86, g: 0.91, b: 0.98, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
    const text = 'Acme quarterly overview'
    const truncated = [
      { y: 40, textAlignHorizontal: 'LEFT' as const },
      { y: 100, textAlignHorizontal: 'CENTER' as const },
      { y: 160, textAlignHorizontal: 'RIGHT' as const }
    ]
    for (const { y, textAlignHorizontal } of truncated) {
      store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        name: `Max width box ${textAlignHorizontal}`,
        x: 40,
        y,
        width: 120,
        height: 24,
        fills: boxFill
      })
      store.graph.createNode('TEXT', store.state.currentPageId, {
        name: `Truncated ${textAlignHorizontal}`,
        x: 40,
        y,
        width: 120,
        height: 24,
        text,
        fontFamily: 'Inter',
        fontSize: 20,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        textAlignHorizontal,
        textTruncation: 'ENDING',
        maxLines: 1,
        maxWidth: 120
      })
    }
    store.graph.createNode('TEXT', store.state.currentPageId, {
      name: 'Without a max width',
      x: 40,
      y: 220,
      width: 120,
      height: 24,
      text,
      fontFamily: 'Inter',
      fontSize: 20,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textTruncation: 'ENDING',
      maxLines: 1
    })
    store.requestRender()
  })
  await editor.page.waitForFunction(() => {
    const store = window.openPencil?.getStore?.()
    return (
      store?.graph.getChildren(store.state.currentPageId).filter((node) => node.type === 'TEXT')
        .length === 4
    )
  })
  await editor.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  expect(await editor.canvas.screenshotCanvasRegion(320, 260)).toMatchSnapshot(
    'text-auto-width.png'
  )
})
