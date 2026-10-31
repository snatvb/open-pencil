import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { parseFigBuffer } from '@open-pencil/fig'
import { symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'
import {
  createInstanceOverrideState,
  setInstanceOverride,
  variableModeOverrideField
} from '@open-pencil/scene-graph/instances/overrides'

import { pastedOverrides } from '#core/editor/clipboard/paste/overrides'

test('a pasted override follows the layer the paste made and the collection it copied', () => {
  const state = createInstanceOverrideState()
  setInstanceOverride(state, 'outer', 'nested', variableModeOverrideField('sizes'))
  setInstanceOverride(state, 'outer', 'nested', variableModeOverrideField('themes'))
  setInstanceOverride(state, 'outer', 'outer', 'name', 'Card')

  const pasted = pastedOverrides(
    state,
    new Map([['nested', 'pasted-nested']]),
    new Map([['sizes', 'pasted-sizes']])
  )

  expect(pasted.self).toEqual(new Map([['name', 'Card']]))
  expect(pasted.descendants).toEqual(
    new Map([
      [
        'pasted-nested',
        new Map([
          [variableModeOverrideField('pasted-sizes'), true],
          [variableModeOverrideField('themes'), true]
        ])
      ]
    ])
  )
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
