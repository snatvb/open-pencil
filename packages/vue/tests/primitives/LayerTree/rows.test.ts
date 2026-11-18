import { afterEach, describe, expect, test } from 'bun:test'

import { effectScope } from 'vue'

import { createEditor, type Editor } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'
import { captureTouchedCheckpoint } from '@open-pencil/scene-graph/checkpoint'

import { useLayerTreeRows } from '#vue/primitives/LayerTree/rows'

let editor: Editor
let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  editor.dispose()
})

function mountRows() {
  editor = createEditor()
  const scope = effectScope()
  const rows = scope.run(() => useLayerTreeRows(editor))
  if (!rows) throw new Error('Expected the layer rows')
  stop = () => scope.stop()
  return { rows, pageId: editor.state.currentPageId }
}

function nextTask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function visibleIds(rows: ReturnType<typeof useLayerTreeRows>) {
  return rows.visibleRows.value.map((row) => row.node.id)
}

function moveReportingOnlyTheLayer(id: string, parentId: string) {
  const node = editor.graph.getNode(id)
  const from = node?.parentId ? editor.graph.getNode(node.parentId) : undefined
  const to = editor.graph.getNode(parentId)
  if (!node || !from || !to) {
    throw new Error('Expected the layer and both parents')
  }
  from.childIds = from.childIds.filter((childId) => childId !== id)
  to.childIds = [...to.childIds, id]
  node.parentId = parentId
  editor.graph.emitter.emit('node:updated', id, node)
}

function createFrameWithRects(parentId: string, rects: number): SceneNode {
  const frame = editor.graph.createNode('FRAME', parentId, { name: 'Frame' })
  for (let index = 0; index < rects; index++) {
    editor.graph.createNode('RECTANGLE', frame.id, { name: `Rect ${index}` })
  }
  return frame
}

describe('layer tree rows during a page load', () => {
  test('rebuilds only for pieces that add rows the panel lists', async () => {
    const { rows, pageId } = mountRows()
    const before = rows.treeVersion.value
    let frame: SceneNode | undefined
    editor.graph.applyImportedStateDuring(() => {
      frame = editor.graph.createNode('FRAME', pageId, { name: 'Frame' })
      editor.graph.createNode('RECTANGLE', frame.id, { name: 'First' })
    })
    await nextTask()
    expect(rows.treeVersion.value).toBe(before + 1)

    const parentId = frame?.id ?? ''
    for (let piece = 0; piece < 5; piece++) {
      editor.graph.applyImportedStateDuring(() => {
        createFrameWithRects(parentId, 20)
      })
      await nextTask()
    }

    expect(rows.treeVersion.value).toBe(before + 1)
    expect(visibleIds(rows)).toEqual([parentId])
    expect(rows.visibleRows.value[0]?.hasChildren).toBe(true)
  })

  test('builds no rows for layers inside collapsed ones', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 50)
    await nextTask()

    const [row] = rows.items.value
    expect(row?.id).toBe(frame.id)
    expect(row?.children).toBeUndefined()
    expect(rows.childrenOf(row)).toEqual([])
  })

  test('builds the rows of a layer once it is expanded, and lists them', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 3)
    await nextTask()

    rows.expandNode(frame.id)

    const children = editor.graph.getNode(frame.id)?.childIds.toReversed() ?? []
    expect(visibleIds(rows)).toEqual([frame.id, ...children])
    expect(rows.childrenOf(rows.items.value[0])?.map((node) => node.id)).toEqual(children)
  })

  test('lists a layer added inside an expanded one', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 1)
    await nextTask()
    rows.expandNode(frame.id)

    const added = editor.graph.createNode('RECTANGLE', frame.id, { name: 'Added' })
    await nextTask()

    expect(visibleIds(rows)).toContain(added.id)
  })

  test('a collapsed layer gains and loses its expand toggle with its first and last child', async () => {
    const { rows, pageId } = mountRows()
    const frame = editor.graph.createNode('FRAME', pageId, { name: 'Frame' })
    await nextTask()
    expect(rows.visibleRows.value[0]?.hasChildren).toBe(false)

    const child = editor.graph.createNode('RECTANGLE', frame.id, { name: 'Child' })
    await nextTask()
    expect(rows.visibleRows.value[0]?.hasChildren).toBe(true)

    editor.graph.deleteNode(child.id)
    await nextTask()
    expect(rows.visibleRows.value[0]?.hasChildren).toBe(false)
  })

  test('keeps a nested layer expanded while its parent is collapsed and rebuilt', async () => {
    const { rows, pageId } = mountRows()
    const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
    const inner = createFrameWithRects(outer.id, 2)
    await nextTask()
    rows.expandNode(outer.id)
    rows.expandNode(inner.id)
    rows.collapseNode(outer.id)

    editor.graph.createNode('RECTANGLE', pageId, { name: 'Sibling' })
    await nextTask()
    rows.expandNode(outer.id)

    expect(visibleIds(rows)).toContain(inner.childIds[0])
  })

  test('expands the layers holding a selected one, so its row shows', async () => {
    const { rows, pageId } = mountRows()
    const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
    const inner = createFrameWithRects(outer.id, 2)
    await nextTask()

    const target = inner.childIds[1] ?? ''
    rows.expandSelectionAncestors([target])

    expect(visibleIds(rows)).toContain(target)
  })

  test('reorders the rows of an expanded layer when its child order is set', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 3)
    await nextTask()
    rows.expandNode(frame.id)
    const order = editor.graph.getNode(frame.id)?.childIds ?? []

    editor.graph.updateNode(frame.id, { childIds: order.toReversed() })
    await nextTask()

    expect(visibleIds(rows)).toEqual([frame.id, ...order])
  })

  test('patches a built row in place when its layer changes', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 1)
    await nextTask()
    rows.expandNode(frame.id)
    const childId = frame.childIds[0] ?? ''
    const version = rows.treeVersion.value

    editor.graph.updateNode(childId, { name: 'Renamed' })

    expect(rows.treeVersion.value).toBe(version)
    expect(rows.visibleRows.value.find((row) => row.node.id === childId)?.node.name).toBe('Renamed')
  })

  test('a checkpoint restore of many layers inside collapsed ones rebuilds the rows once', async () => {
    const { rows, pageId } = mountRows()
    const deepIds = Array.from({ length: 5 }, () => {
      const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
      return createFrameWithRects(outer.id, 10).childIds
    }).flat()
    await nextTask()
    const version = rows.treeVersion.value

    const checkpoint = captureTouchedCheckpoint(editor.graph)
    for (const id of deepIds) {
      editor.graph.updateNode(id, { name: 'Changed' })
    }
    checkpoint.restore()
    await nextTask()

    expect(rows.treeVersion.value).toBe(version + 1)
  })

  test('a whole-layer update inside a collapsed layer leaves the rows alone', async () => {
    const { rows, pageId } = mountRows()
    const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
    const inner = createFrameWithRects(outer.id, 3)
    await nextTask()
    const version = rows.treeVersion.value

    for (const id of inner.childIds) {
      const node = editor.graph.getNode(id)
      if (node) {
        editor.graph.emitter.emit('node:updated', id, node)
      }
    }
    await nextTask()

    expect(rows.treeVersion.value).toBe(version)
  })

  test('a collapsed layer gains its expand toggle when layers join its child list', async () => {
    const { rows, pageId } = mountRows()
    const frame = editor.graph.createNode('FRAME', pageId, { name: 'Frame' })
    const joining = editor.graph.createNode('RECTANGLE', pageId, { name: 'Joining' })
    await nextTask()

    editor.graph.updateNode(frame.id, { childIds: [joining.id] })
    await nextTask()

    expect(rows.visibleRows.value.find((row) => row.node.id === frame.id)?.hasChildren).toBe(true)
  })

  test('lists a layer whose update alone reports its move into an expanded layer', async () => {
    const { rows, pageId } = mountRows()
    const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
    const hidden = createFrameWithRects(outer.id, 1)
    const expanded = createFrameWithRects(pageId, 1)
    await nextTask()
    rows.expandNode(expanded.id)
    const movedId = hidden.childIds[0] ?? ''

    moveReportingOnlyTheLayer(movedId, expanded.id)
    await nextTask()

    expect(visibleIds(rows)).toContain(movedId)
  })

  test('drops the row of a layer whose update alone reports its move deep inside another', async () => {
    const { rows, pageId } = mountRows()
    const outer = editor.graph.createNode('FRAME', pageId, { name: 'Outer' })
    const hidden = createFrameWithRects(outer.id, 1)
    const expanded = createFrameWithRects(pageId, 1)
    await nextTask()
    rows.expandNode(expanded.id)
    const movedId = expanded.childIds[0] ?? ''

    moveReportingOnlyTheLayer(movedId, hidden.id)
    await nextTask()

    expect(visibleIds(rows)).not.toContain(movedId)
  })

  test('reorders the top-level rows when the page child order is set', async () => {
    const { rows, pageId } = mountRows()
    const first = editor.graph.createNode('RECTANGLE', pageId, { name: 'First' })
    const second = editor.graph.createNode('RECTANGLE', pageId, { name: 'Second' })
    await nextTask()

    editor.graph.updateNode(pageId, { childIds: [second.id, first.id] })
    await nextTask()

    expect(visibleIds(rows)).toEqual([first.id, second.id])
  })

  test('setting the child order of a collapsed layer keeps its rows unbuilt', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 3)
    await nextTask()
    const version = rows.treeVersion.value

    editor.graph.updateNode(frame.id, { childIds: frame.childIds.toReversed() })
    await nextTask()

    expect(rows.treeVersion.value).toBe(version)
    expect(rows.items.value[0]?.children).toBeUndefined()
  })

  test('drops the rows of a deleted expanded layer and forgets it was expanded', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 2)
    const kept = editor.graph.createNode('RECTANGLE', pageId, { name: 'Kept' })
    await nextTask()
    rows.expandNode(frame.id)

    editor.graph.deleteNode(frame.id)
    await nextTask()

    expect(visibleIds(rows)).toEqual([kept.id])
    expect(rows.expanded.value).toEqual([])
  })

  test('lists the layers of the page switched to', async () => {
    const { rows, pageId } = mountRows()
    const frame = createFrameWithRects(pageId, 2)
    await nextTask()
    rows.expandNode(frame.id)
    const page = editor.graph.addPage('Second')
    const other = editor.graph.createNode('RECTANGLE', page.id, { name: 'Other' })

    await editor.switchPage(page.id)

    expect(visibleIds(rows)).toEqual([other.id])
    expect(rows.expanded.value).toEqual([])
  })
})

const moves = {
  reparentNode: (id: string, parentId: string) => editor.graph.reparentNode(id, parentId),
  insertChildAt: (id: string, parentId: string) => editor.graph.insertChildAt(id, parentId, 0)
}

describe.each(Object.entries(moves))('layer tree rows when %s moves a layer', (_name, move) => {
  test('lists a layer moved from a collapsed layer into an expanded one', async () => {
    const { rows, pageId } = mountRows()
    const collapsed = editor.graph.createNode('FRAME', pageId, { name: 'Collapsed' })
    const hidden = createFrameWithRects(collapsed.id, 1)
    const expanded = createFrameWithRects(pageId, 1)
    await nextTask()
    rows.expandNode(expanded.id)
    const movedId = hidden.childIds[0] ?? ''

    move(movedId, expanded.id)
    await nextTask()

    expect(visibleIds(rows)).toContain(movedId)
  })

  test('a collapsed layer loses its expand toggle when its only layer moves deep inside another', async () => {
    const { rows, pageId } = mountRows()
    const target = editor.graph.createNode('FRAME', pageId, { name: 'Target' })
    const deep = createFrameWithRects(target.id, 1)
    const source = createFrameWithRects(pageId, 1)
    await nextTask()

    move(source.childIds[0] ?? '', deep.id)
    await nextTask()

    expect(rows.visibleRows.value.find((row) => row.node.id === source.id)?.hasChildren).toBe(false)
  })
})
