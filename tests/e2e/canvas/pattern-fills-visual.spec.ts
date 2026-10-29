import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { patternFillDriver } from '#tests/helpers/canvas/patterns/driver'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')
const patterns = patternFillDriver(() => editor.page)

test('tiles pattern sources built from children, strokes, or hidden fills', async () => {
  await patterns.show()
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion(520, 200)).toMatchSnapshot('pattern-fills.png')
})
