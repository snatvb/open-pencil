import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

const LAYER_NAME = 'Summary card'

test('a layer with modes in several collections keeps its name readable behind one mode badge', async () => {
  const { frameId, singleId, copyId } = await editor.page.evaluate((name) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { graph } = store
    const twoModes = (collectionName: string, first: string, second: string) => {
      const collection = graph.createCollection(collectionName)
      graph.renameMode(collection.id, collection.defaultModeId, first)
      const secondMode = graph.createMode(collection.id, second)
      if (!secondMode) throw new Error('Expected a second mode')
      return { collection, secondMode }
    }
    const theme = twoModes('Theme', 'Light', 'Dark')
    const themeCopy = {
      ...structuredClone(theme.collection),
      id: `${theme.collection.id}-copy`,
      variableIds: [],
      modes: theme.collection.modes.map((mode) => ({ ...mode, name: `${mode.name} alt` }))
    }
    graph.addCollection(themeCopy)
    const density = twoModes('Density', 'Comfortable', 'Compact')
    const size = twoModes('Size', 'Small', 'Large')
    const frame = store.createShape('FRAME', 100, 100, 200, 160)
    graph.updateNode(frame, {
      name,
      variableModes: {
        [theme.collection.id]: theme.secondMode,
        [themeCopy.id]: theme.collection.defaultModeId,
        [density.collection.id]: density.secondMode,
        [size.collection.id]: size.secondMode
      }
    })
    const single = store.createShape('FRAME', 400, 100, 200, 160)
    graph.updateNode(single, {
      name: 'Single',
      variableModes: { [density.collection.id]: density.secondMode }
    })
    return { frameId: frame, singleId: single, copyId: themeCopy.id }
  }, LAYER_NAME)

  const row = editor.page.locator(`[data-node-id="${frameId}"] [data-slot="row"]`)
  const badge = row.locator('[data-slot="variable-mode"]')
  await expect(badge).toHaveCount(1)
  await expect(row.locator('[data-slot="variable-mode-name"]')).toHaveText('Dark')
  await expect(row.locator('[data-slot="variable-mode-more"]')).toHaveText('+3')
  const fullList = 'Theme (1): Dark, Theme (2): Light alt, Density: Compact, Size: Large'
  await expect(badge.locator('.sr-only')).toHaveText(fullList)

  const name = row.getByText(LAYER_NAME, { exact: true })
  const clipped = await name.evaluate((element) => element.scrollWidth > element.clientWidth)
  expect(clipped).toBe(false)

  await badge.hover()
  await expect(editor.page.getByRole('tooltip')).toHaveText(fullList)

  const widthsAt = (width: string) =>
    row.evaluate((element, rowWidth) => {
      element.style.width = rowWidth
      const widthOf = (slot: string) =>
        element.querySelector(`[data-slot="${slot}"]`)?.getBoundingClientRect().width ?? 0
      const badgeElement = element.querySelector('[data-slot="variable-mode"]')
      return {
        name: widthOf('name'),
        badge: widthOf('variable-mode'),
        modeName: widthOf('variable-mode-name'),
        badgeOverflow: badgeElement ? badgeElement.scrollWidth - badgeElement.clientWidth : 0
      }
    }, width)
  await row.hover()

  const narrow = await widthsAt('190px')
  expect(narrow.modeName).toBeGreaterThanOrEqual(16)
  expect(narrow.badgeOverflow).toBe(0)

  const narrowest = await widthsAt('140px')
  expect(narrowest.modeName).toBe(0)
  await expect(row.locator('[data-slot="variable-mode-count"]')).toHaveText('4')
  await expect(row.locator('[data-slot="variable-mode-more"]')).toBeHidden()
  expect(narrowest.name).toBeGreaterThan(narrowest.badge)

  const singleRow = editor.page.locator(`[data-node-id="${singleId}"] [data-slot="row"]`)
  await singleRow.evaluate((element) => {
    element.style.width = '140px'
  })
  await expect(singleRow.locator('[data-slot="variable-mode-name"]')).toHaveText('Compact')
  await expect(singleRow.locator('[data-slot="variable-mode-name"]')).toBeVisible()
  await expect(singleRow.locator('[data-slot="variable-mode-count"]')).toHaveCount(0)

  await editor.page.evaluate((id) => {
    window.openPencil?.getStore?.()?.renameCollection(id, 'Brand')
  }, copyId)
  await expect(badge.locator('.sr-only')).toHaveText(
    'Theme: Dark, Brand: Light alt, Density: Compact, Size: Large'
  )
  editor.canvas.assertNoErrors()
})
