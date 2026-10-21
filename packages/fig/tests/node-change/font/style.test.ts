import { describe, expect, test } from 'bun:test'

import { nodeChangeToProps, sceneNodeToKiwi } from '#fig/node-change/index'
import { omit } from 'es-toolkit/object'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

const COMPRESSED_MEDIUM = {
  family: 'Acme Sans',
  style: 'Compressed Medium',
  postscript: 'AcmeSans-CompressedMedium'
}

const CONDENSED_BOLD_ITALIC = {
  family: 'Acme Sans',
  style: 'Condensed Bold Italic',
  postscript: 'AcmeSans-CondensedBoldItalic'
}

const STYLED_TEXT: NodeChange = {
  type: 'TEXT',
  fontName: COMPRESSED_MEDIUM,
  textData: {
    characters: 'Acme',
    characterStyleIDs: [0, 0, 1, 1],
    styleOverrideTable: [{ styleID: 1, fontName: CONDENSED_BOLD_ITALIC }]
  }
}

function imported(graph: SceneGraph): SceneNode {
  const props = omit(nodeChangeToProps(STYLED_TEXT, []), ['nodeType'])
  return graph.createNode('TEXT', graph.getPages()[0].id, props)
}

function exported(node: SceneNode, graph: SceneGraph): NodeChange {
  return sceneNodeToKiwi(node, { sessionID: 1, localID: 1 }, 0, { value: 2 }, graph, [])[0]
}

describe('.fig font names', () => {
  test('import the weight and slant a width style names, and keep the name', () => {
    const props = nodeChangeToProps(STYLED_TEXT, [])

    expect(props).toMatchObject({
      fontFamily: 'Acme Sans',
      fontWeight: 500,
      italic: false,
      fontName: {
        family: 'Acme Sans',
        style: 'Compressed Medium',
        postScriptName: 'AcmeSans-CompressedMedium'
      }
    })
    expect(props.styleRuns?.[0]?.style).toMatchObject({
      fontWeight: 700,
      italic: true,
      fontName: { style: 'Condensed Bold Italic', postScriptName: 'AcmeSans-CondensedBoldItalic' }
    })
  })

  test('export the names they were imported with', () => {
    const graph = new SceneGraph()
    const change = exported(imported(graph), graph)

    expect(change.fontName).toEqual(COMPRESSED_MEDIUM)
    expect(change.textData?.styleOverrideTable?.[0]?.fontName).toEqual(CONDENSED_BOLD_ITALIC)
    expect(nodeChangeToProps(change, [])).toMatchObject({ fontWeight: 500, italic: false })
  })

  test('export a name for the face once the weight changes', () => {
    const graph = new SceneGraph()
    const node = imported(graph)
    graph.updateNode(node.id, { fontWeight: 700 })

    expect(exported(node, graph).fontName).toEqual({
      family: 'Acme Sans',
      style: 'Bold',
      postscript: ''
    })
  })
})
