import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

function percentText() {
  const editor = createEditor()
  const node = editor.graph.createNode('TEXT', editor.state.currentPageId, {
    text: 'Acme Sans',
    fontSize: 20,
    lineHeight: 30,
    lineHeightPercent: 150
  })
  return { editor, node }
}

describe('undo of text lengths in percent of the font size', () => {
  test('brings back the percent an automatic line height cleared', () => {
    const { editor, node } = percentText()
    editor.updateNodeWithUndo(node.id, { lineHeight: null }, 'Use automatic line height')

    editor.undo.undo()
    editor.graph.updateNode(node.id, { fontSize: 40 })

    expect(node).toMatchObject({ lineHeight: 60, lineHeightPercent: 150 })
  })
})
