import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { collectGraphFontKeys } from '#core/text/requirements'

describe('collectGraphFontKeys', () => {
  test('asks for a face its weight cannot name by its authored style and PostScript name', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'Acme',
      fontFamily: 'Acme Sans',
      fontWeight: 500,
      fontName: {
        family: 'Acme Sans',
        style: 'Compressed Medium',
        postScriptName: 'AcmeSans-CompressedMedium'
      },
      styleRuns: [{ start: 0, length: 2, style: { fontWeight: 700 } }]
    })

    expect(collectGraphFontKeys(graph, [text.id])).toEqual([
      ['Acme Sans', 'Compressed Medium', 'AcmeSans-CompressedMedium'],
      ['Acme Sans', 'Bold']
    ])
  })

  test('asks for plain weights by their usual style names', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      fontFamily: 'Acme Sans',
      fontWeight: 600,
      fontName: { family: 'Acme Sans', style: 'Semi Bold', postScriptName: 'AcmeSans-SemiBold' }
    })

    expect(collectGraphFontKeys(graph, [text.id])).toEqual([['Acme Sans', 'SemiBold']])
  })
})
