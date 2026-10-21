import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { deflateSync } from 'fflate'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { compressFigDataSync, materializeDocument, parseFigBuffer } from '@open-pencil/fig'
import {
  getCompiledSchema,
  getSchemaBytes,
  type NodeChange,
  type VariableConsumptionEntry
} from '@open-pencil/kiwi/fig/codec'
import {
  reconcileVariableBindings,
  SceneGraph,
  unbindVariantProperty,
  type SceneNode
} from '@open-pencil/scene-graph'

import { releaseFigArchive } from '#core/kiwi/fig/session/archive/access'

beforeAll(initCodec)

function chipFile() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Density')
  const roomy = graph.createMode(collection.id, 'Roomy') ?? ''
  const scale = graph.createVariable('Scale', 'STRING', collection.id, 'tight')
  scale.valuesByMode[roomy] = 'loose'
  graph.createVariable('Other scale', 'STRING', collection.id, 'loose')
  const set = graph.createNode('COMPONENT_SET', page, {
    name: 'Chip',
    componentPropertyDefinitions: [
      { id: '7:1', name: 'Scale', type: 'VARIANT', defaultValue: 'tight' }
    ]
  })
  const tight = graph.createNode('COMPONENT', set.id, {
    name: 'Scale=tight',
    width: 40,
    height: 20,
    componentPropertyValues: { Scale: 'tight' }
  })
  graph.createNode('RECTANGLE', tight.id, { name: 'Background', width: 40, height: 20 })
  const loose = graph.createNode('COMPONENT', set.id, {
    name: 'Scale=loose',
    y: 40,
    width: 80,
    height: 30,
    componentPropertyValues: { Scale: 'loose' }
  })
  graph.createNode('RECTANGLE', loose.id, { name: 'Background', width: 80, height: 30 })
  const bind = (parentId: string, name: string) =>
    expectDefined(
      graph.createInstance(tight.id, parentId, { name, variantBindings: { '7:1': scale.id } })
    )
  bind(page, 'Bound chip')
  return { graph, page, bind }
}

function nestedChipFile() {
  const { graph, page, bind } = chipFile()
  const card = graph.createNode('COMPONENT', page, { name: 'Card', x: 200 })
  bind(card.id, 'Nested chip')
  const host = graph.createNode('FRAME', page, { name: 'Host', x: 400 })
  graph.createInstance(card.id, host.id, { name: 'Card occurrence' })
  return graph
}

function records(file: Uint8Array) {
  return parseFigBuffer(file.slice().buffer)
}

function reopen(file: Uint8Array) {
  const parsed = records(file)
  return materializeDocument(parsed.nodeChanges, parsed.blobs).graph
}

function named(graph: SceneGraph, name: string): SceneNode {
  return expectDefined([...graph.getAllNodes()].find((node) => node.name === name))
}

function variantEntry(changes: readonly NodeChange[]): VariableConsumptionEntry | undefined {
  const instance = expectDefined(changes.find((record) => record.name === 'Bound chip'))
  return instance.parameterConsumptionMap?.entries?.find(
    (entry) => entry.variableField === 'VARIANT_PROPERTIES'
  )
}

function boundProperty(entry: VariableConsumptionEntry | undefined) {
  const expression = entry?.variableData?.value?.expressionValue
  return expectDefined(expression?.expressionArguments?.[0]?.value?.mapValue?.values?.at(0))
}

function switchModeThereAndBack(graph: SceneGraph): void {
  const host = named(graph, 'Host')
  const collection = expectDefined([...graph.variableCollections.values()][0])
  const roomy = expectDefined(collection.modes.find((mode) => mode.name === 'Roomy')).modeId
  graph.updateNode(host.id, { variableModes: { [collection.id]: roomy } })
  reconcileVariableBindings(graph, { subtrees: [host.id] })
  graph.updateNode(host.id, { variableModes: {} })
  reconcileVariableBindings(graph, { subtrees: [host.id] })
}

function occurrenceRecord(file: Uint8Array): NodeChange | undefined {
  return records(file).nodeChanges.find((record) => record.name === 'Card occurrence')
}

test('saving an edit keeps a variant binding as it was read', async () => {
  const parsed = records(await exportFigFile(chipFile().graph))
  delete expectDefined(boundProperty(variantEntry(parsed.nodeChanges)).value).resolvedDataType
  const file = compressFigDataSync(
    deflateSync(getSchemaBytes()),
    getCompiledSchema().encodeMessage(parsed),
    new Uint8Array(),
    '{}',
    []
  )
  const opened = await parseFigFile(file.slice().buffer)
  opened.updateNode(named(opened, 'Bound chip').id, { name: 'Bound chip renamed' })

  const saved = records(await exportFigFile(opened)).nodeChanges
  const chip = expectDefined(saved.find((record) => record.name === 'Bound chip renamed'))
  expect(chip.parameterConsumptionMap?.entries).toEqual(
    expectDefined(parsed.nodeChanges.find((record) => record.name === 'Bound chip'))
      .parameterConsumptionMap?.entries
  )
})

test('a changed or removed variant binding replaces the one read', async () => {
  const reopened = reopen(await exportFigFile(chipFile().graph))
  const other = expectDefined(
    [...reopened.variables.values()].find((v) => v.name === 'Other scale')
  )
  const chip = named(reopened, 'Bound chip')

  reopened.updateNode(chip.id, { variantBindings: { '7:1': other.id } })
  expect(named(reopen(await exportFigFile(reopened)), 'Bound chip').variantBindings).toEqual({
    '7:1': other.id
  })

  reopened.updateNode(chip.id, { variantBindings: {} })
  const cleared = variantEntry(records(await exportFigFile(reopened)).nodeChanges)
  expect(cleared?.variableData).toBeUndefined()
})

test('a nested instance switched there and back saves as before', async () => {
  const graph = nestedChipFile()
  const untouched = occurrenceRecord(await exportFigFile(graph))

  switchModeThereAndBack(graph)

  expect(occurrenceRecord(await exportFigFile(graph))).toEqual(untouched)
})

test('a nested instance read from a file, switched there and back, saves as before', async () => {
  const opened = reopen(await exportFigFile(nestedChipFile()))
  const untouched = occurrenceRecord(await exportFigFile(opened))

  switchModeThereAndBack(opened)

  expect(occurrenceRecord(await exportFigFile(opened))).toEqual(untouched)
})

function occurrenceChip(graph: SceneGraph): SceneNode {
  return expectDefined(graph.getChildren(named(graph, 'Card occurrence').id)[0])
}

test('a nested instance unbound from its variable saves without the binding', async () => {
  const graph = nestedChipFile()
  unbindVariantProperty(graph, occurrenceChip(graph).id, 'Scale')

  const written = reopen(await exportFigFile(graph))

  expect(occurrenceChip(written).variantBindings).toEqual({})
})

test('a nested instance unbound after opening a file saves without the binding', async () => {
  const opened = await parseFigFile((await exportFigFile(nestedChipFile())).slice().buffer)
  unbindVariantProperty(opened, occurrenceChip(opened).id, 'Scale')

  const saved = await exportFigFile(opened)

  expect(occurrenceChip(reopen(saved)).variantBindings).toEqual({})
  expect(named(reopen(saved), 'Nested chip').variantBindings).not.toEqual({})
})

function switchHostToRoomy(graph: SceneGraph): void {
  const host = named(graph, 'Host')
  const collection = expectDefined([...graph.variableCollections.values()][0])
  const roomy = expectDefined(collection.modes.find((mode) => mode.name === 'Roomy')).modeId
  graph.updateNode(host.id, { variableModes: { [collection.id]: roomy } })
  reconcileVariableBindings(graph, { subtrees: [host.id] })
}

function shownChip(graph: SceneGraph): string | undefined {
  const componentId = occurrenceChip(graph).componentId
  return componentId ? graph.getNode(componentId)?.name : undefined
}

test('a nested instance pinned to the variant a mode showed saves that variant', async () => {
  const opened = await parseFigFile((await exportFigFile(nestedChipFile())).slice().buffer)
  switchHostToRoomy(opened)
  expect(shownChip(opened)).toBe('Scale=loose')
  unbindVariantProperty(opened, occurrenceChip(opened).id, 'Scale')

  const patched = reopen(await exportFigFile(opened))
  releaseFigArchive(opened)
  const written = reopen(await exportFigFile(opened))

  for (const graph of [patched, written]) {
    expect(shownChip(graph)).toBe('Scale=loose')
    expect(occurrenceChip(graph).variantBindings).toEqual({})
  }
})

test('a nested binding removed in a saved file stays removed when written again', async () => {
  const graph = nestedChipFile()
  unbindVariantProperty(graph, occurrenceChip(graph).id, 'Scale')
  const read = reopen(await exportFigFile(graph))

  const written = reopen(await exportFigFile(read))

  expect(occurrenceChip(written).variantBindings).toEqual({})
})
