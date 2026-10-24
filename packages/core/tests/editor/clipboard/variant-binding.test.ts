import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { parseFigmaClipboard } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { parseFigBuffer } from '@open-pencil/fig'
import { symbolDataOf, symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { SceneGraph, savedVariantIds, type SceneNode } from '@open-pencil/scene-graph'

beforeAll(initCodec)

function badgeHost(placed: 'nested' | 'top'): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Density')
  const roomy = graph.createMode(collection.id, 'Roomy') ?? ''
  const size = graph.createVariable('Size', 'STRING', collection.id, 'small')
  size.valuesByMode[roomy] = 'large'
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Badge',
    componentPropertyDefinitions: [
      { id: '8:1', name: 'Size', type: 'VARIANT', defaultValue: 'small' }
    ]
  })
  const variant = (value: string) =>
    graph.createNode('COMPONENT', set.id, {
      name: `Size=${value}`,
      componentPropertyValues: { Size: value }
    })
  const small = variant('small')
  const medium = variant('medium')
  variant('large')
  const host = graph.createNode('FRAME', page, {
    name: 'Host',
    variableModes: { [collection.id]: roomy }
  })
  const variantBindings = { '8:1': size.id }
  if (placed === 'top') {
    graph.createInstance(small.id, host.id, { name: 'Top badge', variantBindings })
    return graph
  }
  const panel = graph.createNode('COMPONENT', page, { name: 'Panel' })
  graph.createInstance(medium.id, panel.id, { name: 'Badge', variantBindings })
  const occurrence = expectDefined(
    graph.createInstance(panel.id, host.id, { name: 'Panel occurrence' })
  )
  graph.swapInstanceComponent(expectDefined(occurrence.childIds[0]), small.id)
  return graph
}

async function copiedHost(placed: 'nested' | 'top') {
  const graph = await parseFigFile((await exportFigFile(badgeHost(placed))).slice().buffer)
  const editor = createEditor({ graph })
  const host = expectDefined(
    [...graph.getAllNodes()].find((node: SceneNode) => node.name === 'Host')
  )
  editor.select([host.id])
  return { graph, copy: await editor.prepareCopy() }
}

async function copiedRecords(placed: 'nested' | 'top'): Promise<NodeChange[]> {
  const { copy } = await copiedHost(placed)
  return expectDefined(await parseFigmaClipboard(copy.html)).nodes
}

async function pastedRecords(placed: 'nested' | 'top', collide: boolean): Promise<NodeChange[]> {
  const { graph, copy } = await copiedHost(placed)
  const target = new SceneGraph()
  const page = target.getPages()[0].id
  const savedIds = collide ? [...graph.getAllNodes()].flatMap(savedVariantIds) : []
  for (const id of savedIds) {
    target.createNodeWithId(id, 'COMPONENT', page, { name: 'Unrelated' })
  }
  await createEditor({ graph: target }).pasteSnapshot(expectDefined(copy.snapshot))
  return parseFigBuffer((await exportFigFile(target)).slice().buffer).nodeChanges
}

function recordName(records: readonly NodeChange[], id: GUID | undefined): string | undefined {
  return records.find(
    (record) => id && record.guid && guidToString(record.guid) === guidToString(id)
  )?.name
}

test('copying a nested variant a variable picked writes the saved swap', async () => {
  const records = await copiedRecords('nested')
  const occurrence = expectDefined(records.find((record) => record.name === 'Panel occurrence'))
  const swap = symbolOverridesOf(occurrence).find((override) => override.overriddenSymbolID)

  expect(recordName(records, swap?.overriddenSymbolID)).toBe('Size=small')
})

test('copying a placed variant a variable picked writes the saved component', async () => {
  const records = await copiedRecords('top')
  const top = expectDefined(records.find((record) => record.name === 'Top badge'))

  expect(recordName(records, symbolDataOf(top)?.symbolID)).toBe('Size=small')
})

for (const collide of [false, true]) {
  const ids = collide ? ' whose ids the target already uses' : ''
  test(`a nested swap pasted into another file, where its set is gone, saves as shown${ids}`, async () => {
    const records = await pastedRecords('nested', collide)
    const occurrence = expectDefined(records.find((record) => record.name === 'Panel occurrence'))
    const swap = symbolOverridesOf(occurrence).find((override) => override.overriddenSymbolID)

    expect(recordName(records, swap?.overriddenSymbolID)).toBe('Size=large')
  })

  test(`a placed instance pasted into another file, where its set is gone, saves as shown${ids}`, async () => {
    const records = await pastedRecords('top', collide)
    const top = expectDefined(records.find((record) => record.name === 'Top badge'))

    expect(recordName(records, symbolDataOf(top)?.symbolID)).toBe('Size=large')
  })
}
