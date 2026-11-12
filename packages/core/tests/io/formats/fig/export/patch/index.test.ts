import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '#core-tests/helpers/fig/archive'
import {
  exportBothWays,
  fixtureBytes,
  guidKey,
  layerNamed,
  pageNamed,
  recordsOf,
  shapeOf
} from '#core-tests/helpers/fig/patch'
import {
  archiveWithSavedLayout,
  openLaidOut,
  rowComponent,
  ROW_SAVED_WITH_WIDER_LEAD
} from '#core-tests/helpers/fig/saved-instance-layout'
import { isEqual } from 'es-toolkit/predicate'

import {
  exportFigFile,
  populateAllFigPages,
  populateFigPage
} from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'
import { cloneNodeProps } from '@open-pencil/scene-graph/copy'
import { expectDefined } from '@open-pencil/test-support/assert'

import {
  hasPendingReaderPages,
  populateFigInternalPages
} from '#core/kiwi/fig/session/document-state'

setDefaultTimeout(60_000)

test('an opened file saved unedited keeps the layout Figma saved for its instances', async () => {
  const source = new SceneGraph()
  const page = source.getPages()[0]
  const row = rowComponent(source, page.id, 'Row', 20)
  source.createInstance(row.id, page.id, { name: 'Placed', y: 100 })
  const bytes = await archiveWithSavedLayout(source, { Placed: ROW_SAVED_WITH_WIDER_LEAD })
  const graph = await openLaidOut(bytes)
  computeAllLayouts(graph)
  expect(recordsOf(await exportFigFile(graph))).toEqual(recordsOf(bytes))
})

describe('writing an edited document into its archive', () => {
  test('rewrites only the record an edit changed', async () => {
    const { bytes, patched } = await exportBothWays((graph) =>
      graph.updateNode(layerNamed(graph, 'B').id, { name: 'B renamed' })
    )
    const before = recordsOf(bytes)
    const after = recordsOf(patched)
    expect([...after.keys()].toSorted()).toEqual([...before.keys()].toSorted())
    const changed = [...after].filter(([guid, record]) => !isEqual(before.get(guid), record))
    expect(changed.map(([, record]) => record.name)).toEqual(['B renamed'])
  })

  test('still rewrites only the edited record once every page is loaded', async () => {
    const bytes = await fixtureBytes()
    const graph = await open(bytes)
    // Loading the last page releases the decoded reader; the archive keeps serving saves.
    populateAllFigPages(graph)
    populateFigInternalPages(graph)
    expect(hasPendingReaderPages(graph)).toBe(false)
    graph.updateNode(layerNamed(graph, 'B').id, { name: 'B renamed' })
    const before = recordsOf(bytes)
    const after = recordsOf(await exportFigFile(graph))
    const changed = [...after].filter(([guid, record]) => !isEqual(before.get(guid), record))
    expect(changed.map(([, record]) => record.name)).toEqual(['B renamed'])
  })

  const edits: Array<[string, (graph: SceneGraph) => void]> = [
    ['moving a layer', (graph) => graph.updateNode(layerNamed(graph, 'A').id, { x: 120, y: 90 })],
    [
      'adding a layer between siblings',
      (graph) => {
        const frame = layerNamed(graph, 'Frame')
        const added = graph.createNode('RECTANGLE', frame.id, { name: 'New', width: 5, height: 5 })
        graph.insertChildAt(added.id, frame.id, 1)
      }
    ],
    ['deleting a frame and its layers', (graph) => graph.deleteNode(layerNamed(graph, 'Frame').id)],
    [
      'moving a layer out of a frame it then deletes',
      (graph) => {
        const page = pageNamed(graph, graph.getPages()[0].name)
        graph.reparentNode(layerNamed(graph, 'C').id, page.id)
        graph.deleteNode(layerNamed(graph, 'Frame').id)
      }
    ],
    [
      'reordering siblings',
      (graph) => graph.insertChildAt(layerNamed(graph, 'C').id, layerNamed(graph, 'Frame').id, 0)
    ],
    [
      'copying a layer with its source GUID, as a paste does',
      (graph) => {
        const dot = layerNamed(graph, 'Dot')
        graph.createNode(dot.type, graph.getPages()[0].id, {
          ...cloneNodeProps(dot, null),
          name: 'Dot copy',
          x: 400
        })
      }
    ],
    [
      'editing a component whose instances are on a page not loaded yet',
      (graph) => {
        populateFigPage(graph, pageNamed(graph, 'Library').id)
        graph.updateNode(layerNamed(graph, 'Body').id, { height: 60 })
        graph.updateNode(layerNamed(graph, 'Card').id, { height: 60 })
      }
    ],
    [
      'overriding a layer inside an instance',
      (graph) => {
        const used = pageNamed(graph, 'Used')
        populateFigPage(graph, used.id)
        const [instance] = graph.getChildren(used.id)
        const [body] = graph.getChildren(instance.id)
        graph.updateNode(body.id, { opacity: 0.5, name: 'Body override' })
      }
    ],
    [
      'deleting a layer of a component whose instances are on a page not loaded yet',
      (graph) => {
        const library = pageNamed(graph, 'Library')
        populateFigPage(graph, library.id)
        const [body] = graph.getChildren(layerNamed(graph, 'Card').id)
        graph.deleteNode(body.id)
      }
    ],
    ['adding a page', (graph) => graph.addPage('Added')]
  ]
  for (const [name, edit] of edits) {
    test(`reopens as the full export does after ${name}`, async () => {
      const { patched, full } = await exportBothWays(edit)
      expect(await shapeOf(patched)).toEqual(await shapeOf(full))
    })
  }

  test("keeps the document's plugin data an edit sets on it", async () => {
    const { patched } = await exportBothWays((graph) => {
      const root = expectDefined(graph.getNode(graph.rootId))
      graph.updateNode(root.id, {
        pluginData: [...root.pluginData, { pluginId: 'probe', key: 'note', value: 'kept' }]
      })
    })
    const reopened = await open(patched)
    expect(reopened.getNode(reopened.rootId)?.pluginData).toContainEqual({
      pluginId: 'probe',
      key: 'note',
      value: 'kept'
    })
  })

  test('keeps a change to the libraries the document enables', async () => {
    const binding = { libraryId: 'ds', revisionId: 'two', enabled: true }
    const { patched } = await exportBothWays((graph) => {
      graph.enabledLibraries.set('ds', binding)
    })
    const reopened = await open(patched)
    expect(reopened.enabledLibraries.get('ds')).toEqual(binding)
  })

  test('keeps every archive record its own when a new variable takes an ID it uses', async () => {
    const bytes = await fixtureBytes()
    const graph = await open(bytes)
    // A new ID that happens to equal a layer's record on a page not loaded yet: the record must
    // stay the layer's.
    const variableGuid = [...recordsOf(bytes)].find(([, record]) => record.name === 'Branded')?.[0]
    if (!variableGuid) throw new Error('Expected the Branded layer record')
    const [collection] = graph.variableCollections.values()
    const [existing] = graph.variables.values()
    graph.addVariable({ ...structuredClone(existing), id: variableGuid, name: 'added' })
    collection.variableIds.push(variableGuid)
    const patched = await exportFigFile(graph)
    const before = recordsOf(bytes)
    const after = recordsOf(patched)
    for (const [guid, record] of before) {
      expect(after.get(guid)?.type).toBe(record.type)
      expect(after.get(guid)?.name).toBe(record.name)
    }
    const added = [...after.values()].filter((record) => !before.has(guidKey(record)))
    expect(added.map((record) => record.name)).toEqual(['added'])
  })

  test('writes a layer into its own record when something cleared its source id', async () => {
    const bytes = await fixtureBytes()
    const graph = await open(bytes)
    // A room's copy of a layer carries no source metadata; the layer's ID still names its record.
    const page = graph.getPages()[0]
    for (const node of [page, ...graph.getChildren(page.id)])
      graph.updateNode(node.id, { source: { ...structuredClone(node.source), id: '' } })
    const patched = await exportFigFile(graph)
    const before = recordsOf(bytes)
    const after = recordsOf(patched)
    expect([...after.keys()].toSorted()).toEqual([...before.keys()].toSorted())
    for (const [guid, record] of before) {
      expect(after.get(guid)?.parentIndex).toEqual(record.parentIndex)
    }
  })

  test('rewrites instances on unopened pages when their component loses a layer', async () => {
    const bytes = await fixtureBytes()
    const graph = await open(bytes)
    populateFigPage(graph, pageNamed(graph, 'Library').id)
    const [body] = graph.getChildren(layerNamed(graph, 'Card').id)
    graph.deleteNode(body.id)
    const before = recordsOf(bytes)
    const after = recordsOf(await exportFigFile(graph))
    const [bodyGuid, bodyRecord] = expectDefined(
      [...before].find(([, record]) => record.name === 'Body')
    )
    const instances = (records: Map<string, NodeChange>) =>
      [...records.values()].filter((record) => record.type === 'INSTANCE')
    // Instances address the component's layer by its GUID in their derived geometry.
    const addressesBody = (record: NodeChange) =>
      JSON.stringify(record).includes(JSON.stringify(bodyRecord.guid))
    expect(instances(before).every(addressesBody)).toBe(true)
    expect(after.has(bodyGuid)).toBe(false)
    expect(instances(after)).toHaveLength(2)
    expect(instances(after).some(addressesBody)).toBe(false)
  })
})
