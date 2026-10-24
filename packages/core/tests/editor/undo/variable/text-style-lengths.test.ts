import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createDefaultSourceMetadata } from '@open-pencil/scene-graph'

function styledText() {
  const editor = createEditor()
  const { graph } = editor
  const page = editor.state.currentPageId
  const collection = graph.createCollection('Scale')
  const spacing = graph.createVariable('Spacing', 'FLOAT', collection.id, 5)
  const style = graph.createNodeWithId('style:body', 'TEXT', page, {
    name: 'Body',
    sharedStyleType: 'TEXT',
    internalOnly: true,
    fontSize: 20,
    letterSpacing: 2,
    letterSpacingPercent: 10,
    source: { ...createDefaultSourceMetadata(), id: 'style:body' }
  })
  const text = graph.createNode('TEXT', page, {
    text: 'Acme Sans',
    fontSize: 20,
    letterSpacing: 2,
    letterSpacingPercent: 10,
    textStyleId: 'style:body'
  })
  return { editor, spacing, style, text }
}

describe('undo of a variable bound on a text style', () => {
  test('brings back the percent spacing on the style and the texts using it', () => {
    const { editor, spacing, style, text } = styledText()

    editor.bindVariable(style.id, 'letterSpacing', spacing.id)
    expect(text).toMatchObject({ letterSpacing: 5, letterSpacingPercent: null })

    editor.undo.undo()

    expect(style).toMatchObject({ letterSpacing: 2, letterSpacingPercent: 10 })
    expect(text).toMatchObject({
      letterSpacing: 2,
      letterSpacingPercent: 10,
      textStyleId: 'style:body'
    })
  })
})
