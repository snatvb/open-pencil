import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { parseFigBuffer } from '@open-pencil/fig'
import { symbolDataOf, symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import type { GUID } from '@open-pencil/kiwi/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { releaseFigArchive } from '#core/kiwi/fig/session/archive/access'

beforeAll(initCodec)

interface BadgeOptions {
  placed: 'nested' | 'top'
  savedSwap?: boolean
  bound?: readonly ('Size' | 'State')[]
  roomy?: boolean
}

const PROPERTY_IDS = { Size: '8:1', State: '8:2' }

function badgeDocument({
  placed,
  savedSwap = false,
  bound = ['Size'],
  roomy = true
}: BadgeOptions): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Density')
  const roomyMode = graph.createMode(collection.id, 'Roomy') ?? ''
  const size = graph.createVariable('Size', 'STRING', collection.id, 'small')
  size.valuesByMode[roomyMode] = 'large'
  const state = graph.createVariable('State', 'STRING', collection.id, 'on')
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Badge',
    componentPropertyDefinitions: [
      { id: PROPERTY_IDS.Size, name: 'Size', type: 'VARIANT', defaultValue: 'small' },
      { id: PROPERTY_IDS.State, name: 'State', type: 'VARIANT', defaultValue: 'on' }
    ]
  })
  const variants = new Map<string, SceneNode>()
  for (const sizeValue of ['small', 'medium', 'large']) {
    for (const stateValue of ['on', 'off']) {
      const name = `Size=${sizeValue}, State=${stateValue}`
      variants.set(
        name,
        graph.createNode('COMPONENT', set.id, {
          name,
          width: 10,
          height: 10,
          componentPropertyValues: { Size: sizeValue, State: stateValue }
        })
      )
    }
  }
  const variant = (name: string) => expectDefined(variants.get(name))
  const variables = { Size: size.id, State: state.id }
  const variantBindings = Object.fromEntries(
    bound.map((property) => [PROPERTY_IDS[property], variables[property]])
  )
  const host = graph.createNode('FRAME', page, {
    name: 'Host',
    x: 400,
    variableModes: roomy ? { [collection.id]: roomyMode } : {}
  })
  if (placed === 'top') {
    graph.createInstance(variant('Size=small, State=on').id, host.id, {
      name: 'Top badge',
      variantBindings
    })
    return graph
  }
  const panel = graph.createNode('COMPONENT', page, { name: 'Panel', x: 200 })
  graph.createInstance(variant('Size=medium, State=on').id, panel.id, {
    name: 'Badge',
    variantBindings
  })
  const occurrence = expectDefined(
    graph.createInstance(panel.id, host.id, { name: 'Panel occurrence' })
  )
  if (savedSwap) {
    graph.swapInstanceComponent(
      expectDefined(occurrence.childIds[0]),
      variant('Size=small, State=on').id
    )
  }
  return graph
}

function named(graph: SceneGraph, name: string): SceneNode {
  return expectDefined([...graph.getAllNodes()].find((node) => node.name === name))
}

function nestedBadge(graph: SceneGraph): SceneNode {
  return expectDefined(graph.getChildren(named(graph, 'Panel occurrence').id)[0])
}

function shownName(graph: SceneGraph, node: SceneNode): string | undefined {
  return node.componentId ? graph.getNode(node.componentId)?.name : undefined
}

function recordName(changes: readonly NodeChange[], id: GUID | undefined): string | undefined {
  return changes.find(
    (record) => id && record.guid && guidToString(record.guid) === guidToString(id)
  )?.name
}

function savedSwap(file: Uint8Array): string | undefined {
  const changes = parseFigBuffer(file.slice().buffer).nodeChanges
  const occurrence = expectDefined(changes.find((record) => record.name === 'Panel occurrence'))
  const swap = symbolOverridesOf(occurrence).find((override) => override.overriddenSymbolID)
  return recordName(changes, swap?.overriddenSymbolID)
}

function topSymbol(file: Uint8Array): string | undefined {
  const changes = parseFigBuffer(file.slice().buffer).nodeChanges
  const top = expectDefined(changes.find((record) => record.name === 'Top badge'))
  return recordName(changes, symbolDataOf(top)?.symbolID)
}

async function open(options: BadgeOptions): Promise<SceneGraph> {
  return parseFigFile((await exportFigFile(badgeDocument(options))).slice().buffer)
}

async function saves(graph: SceneGraph): Promise<Uint8Array[]> {
  const host = named(graph, 'Host')
  graph.updateNode(host.id, { x: host.x + 1 })
  const patched = await exportFigFile(graph)
  releaseFigArchive(graph)
  return [patched, await exportFigFile(graph)]
}

async function reopened(graph: SceneGraph): Promise<SceneGraph[]> {
  const files = await saves(graph)
  return Promise.all(files.map((file) => parseFigFile(file.slice().buffer)))
}

test('a nested variant a variable picked saves the saved swap', async () => {
  const opened = await open({ placed: 'nested', savedSwap: true })
  expect(shownName(opened, nestedBadge(opened))).toBe('Size=large, State=on')

  for (const file of await saves(opened)) {
    expect(savedSwap(file)).toBe('Size=small, State=on')
  }
})

test('a top-level variant a variable picked saves the saved component', async () => {
  const opened = await open({ placed: 'top' })
  expect(shownName(opened, named(opened, 'Top badge'))).toBe('Size=large, State=on')

  for (const file of await saves(opened)) {
    expect(topSymbol(file)).toBe('Size=small, State=on')
  }
})

for (const roomy of [true, false]) {
  test(`a variant chosen on a bound placed instance saves as shown, roomy ${roomy}`, async () => {
    const opened = await open({ placed: 'top', roomy })
    const top = named(opened, 'Top badge')
    createEditor({ graph: opened }).switchInstanceVariant(top.id, 'State', 'off')
    const shown = shownName(opened, top)

    for (const file of await saves(opened)) {
      expect(topSymbol(file)).toBe(shown)
    }
  })
}

test('pinning one bound property of a placed instance saves the variant shown', async () => {
  const opened = await open({ placed: 'top', bound: ['Size', 'State'] })
  const top = named(opened, 'Top badge')
  createEditor({ graph: opened }).switchInstanceVariant(top.id, 'Size', 'large')

  for (const file of await saves(opened)) {
    expect(topSymbol(file)).toBe('Size=large, State=on')
  }
})

for (const savedSwapInFile of [false, true]) {
  test(`a nested swap made after opening saves, swap in the file: ${savedSwapInFile}`, async () => {
    const opened = await open({ placed: 'nested', bound: [], savedSwap: savedSwapInFile })
    opened.swapInstanceComponent(nestedBadge(opened).id, named(opened, 'Size=large, State=on').id)

    for (const file of await saves(opened)) {
      expect(savedSwap(file)).toBe('Size=large, State=on')
    }
  })
}

test('a bound nested instance swapped without unbinding saves the swap shown', async () => {
  const opened = await open({ placed: 'nested', savedSwap: true })
  opened.swapInstanceComponent(nestedBadge(opened).id, named(opened, 'Size=medium, State=on').id)

  for (const file of await saves(opened)) {
    expect(savedSwap(file)).toBe('Size=medium, State=on')
  }
})

for (const savedSwapInFile of [false, true]) {
  test(`pinning a nested variant a variable picked keeps it, swap in the file: ${savedSwapInFile}`, async () => {
    const opened = await open({ placed: 'nested', savedSwap: savedSwapInFile })
    createEditor({ graph: opened }).switchInstanceVariant(nestedBadge(opened).id, 'Size', 'large')

    for (const graph of await reopened(opened)) {
      expect(shownName(graph, nestedBadge(graph))).toBe('Size=large, State=on')
      expect(nestedBadge(graph).variantBindings).toEqual({})
    }
  })
}

test('undoing a nested pin saves the saved swap again', async () => {
  const opened = await open({ placed: 'nested', savedSwap: true })
  const editor = createEditor({ graph: opened })
  editor.switchInstanceVariant(nestedBadge(opened).id, 'Size', 'large')
  editor.undo.undo()

  for (const file of await saves(opened)) {
    expect(savedSwap(file)).toBe('Size=small, State=on')
  }
})

test('a removed nested binding stays removed across saves and reopens', async () => {
  const opened = await open({ placed: 'nested', savedSwap: true })
  createEditor({ graph: opened }).switchInstanceVariant(nestedBadge(opened).id, 'Size', 'large')

  for (const graph of await reopened(opened)) {
    for (const again of await reopened(graph)) {
      expect(shownName(again, nestedBadge(again))).toBe('Size=large, State=on')
      expect(nestedBadge(again).variantBindings).toEqual({})
    }
  }
})

function removeSizeVariable(graph: SceneGraph): void {
  const size = [...graph.variables.values()].find((variable) => variable.name === 'Size')
  graph.removeVariable(expectDefined(size).id)
}

test('deleting the bound variable keeps the placed variant shown and saves it', async () => {
  const opened = await open({ placed: 'top' })
  removeSizeVariable(opened)

  for (const graph of await reopened(opened)) {
    expect(shownName(graph, named(graph, 'Top badge'))).toBe('Size=large, State=on')
    expect(named(graph, 'Top badge').variantBindings).toEqual({})
  }
})

test('deleting the bound variable keeps the nested variant shown and saves it', async () => {
  const opened = await open({ placed: 'nested', savedSwap: true })
  removeSizeVariable(opened)

  for (const graph of await reopened(opened)) {
    expect(shownName(graph, nestedBadge(graph))).toBe('Size=large, State=on')
    expect(nestedBadge(graph).variantBindings).toEqual({})
  }
})
