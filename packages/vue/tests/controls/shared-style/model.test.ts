import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { sharedStylePatch } from '#vue/controls/shared-style/model'

const COMPRESSED_MEDIUM = {
  family: 'Acme Sans',
  style: 'Compressed Medium',
  postScriptName: 'AcmeSans-CompressedMedium'
}

function applyTextStyle(text: Partial<SceneNode>, style: Partial<SceneNode>) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const styleNode = graph.createNode('TEXT', page, { fontFamily: 'Acme Sans', ...style })
  const target = graph.createNode('TEXT', page, { text: 'ab', fontFamily: 'Acme Sans', ...text })
  graph.updateNode(target.id, sharedStylePatch('text', target, 'S:heading', styleNode))
  return { applied: graph.getNode(target.id), styleNode }
}

describe('applying a text style', () => {
  test('gives the text the font name the style was authored in, as its own copy', () => {
    const { applied, styleNode } = applyTextStyle(
      { fontWeight: 400 },
      { fontWeight: 500, fontName: COMPRESSED_MEDIUM }
    )
    expect(applied?.fontName).toEqual(COMPRESSED_MEDIUM)
    expect(applied?.fontName).not.toBe(styleNode.fontName)
  })

  test('clears the font name of the text when the style names none', () => {
    const { applied } = applyTextStyle(
      { fontWeight: 500, fontName: COMPRESSED_MEDIUM },
      { fontWeight: 700, fontName: null }
    )
    expect(applied?.fontWeight).toBe(700)
    expect(applied?.fontName).toBeNull()
  })
})
