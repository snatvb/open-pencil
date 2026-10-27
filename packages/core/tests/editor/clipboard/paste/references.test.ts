import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { parseFigBuffer } from '@open-pencil/fig'
import { symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import {
  createDefaultNode,
  SceneGraph,
  setInstanceOverride,
  variableModeOverrideField
} from '@open-pencil/scene-graph'

import { pastedReferences } from '#core/editor/clipboard/paste/references'

test('a stale override key that matches an id the paste made gives way to the copied layer', () => {
  const instance = createDefaultNode(() => 'copied-instance', 'INSTANCE')
  instance.instanceOverrides.descendants.set('copied-layer', new Map([['visible', false]]))
  instance.instanceOverrides.descendants.set('pasted-layer', new Map([['opacity', 0.5]]))
  const copiedIds = new Map([
    ['copied-instance', 'pasted-instance'],
    ['copied-layer', 'pasted-layer']
  ])

  const { instanceOverrides } = pastedReferences(instance, copiedIds)

  expect([...(instanceOverrides?.descendants ?? [])]).toEqual([
    ['pasted-layer', new Map([['visible', false]])]
  ])
})

function pinnedNestedMode() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const sizes = graph.createCollection('Sizes')
  const wide = expectDefined(graph.createMode(sizes.id, 'Wide'))
  const width = graph.createVariable('Width', 'FLOAT', sizes.id, 64)
  const leaf = graph.createNode('COMPONENT', page, {
    name: 'Leaf',
    variableModes: { [sizes.id]: wide }
  })
  graph.bindVariable(leaf.id, 'width', width.id)
  const card = graph.createNode('COMPONENT', page, { name: 'Card' })
  graph.createInstance(leaf.id, card.id, { name: 'Nested' })
  const outer = expectDefined(graph.createInstance(card.id, page, { name: 'Outer' }))
  const nested = expectDefined(graph.getChildren(outer.id)[0])
  for (const field of ['variableModes', variableModeOverrideField(sizes.id)]) {
    setInstanceOverride(outer.instanceOverrides, outer.id, nested.id, field)
  }
  return { graph, outer }
}

test('a mode a pasted instance pins on a nested layer follows its collection into another file', async () => {
  await initCodec()
  const { graph, outer } = pinnedNestedMode()
  const editor = createEditor({ graph })
  editor.select([outer.id])
  const copy = await editor.prepareCopy()
  const target = new SceneGraph()

  await createEditor({ graph: target }).pasteSnapshot(expectDefined(copy.snapshot))

  const records = parseFigBuffer((await exportFigFile(target)).slice().buffer).nodeChanges
  const outerRecord = expectDefined(records.find((node) => node.name === 'Outer'))
  const sizes = expectDefined(records.find((node) => node.type === 'VARIABLE_SET'))
  const wide = sizes.variableSetModes?.find((mode) => mode.name === 'Wide')
  const modeMaps = symbolOverridesOf(outerRecord).flatMap(
    (override) => override.variableModeBySetMap ?? []
  )
  expect(modeMaps).toEqual([
    { entries: [{ variableSetID: { guid: sizes.guid }, variableModeID: wide?.id }] }
  ])
})
