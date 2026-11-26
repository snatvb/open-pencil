import { describe, expect, test } from 'bun:test'

import { SHADOW_CARRIER_ATTRIBUTE } from '@open-pencil/dom-css/export'
import { designDocumentToSceneGraph } from '@open-pencil/dom-css/scene-graph'
import { firstLayer } from '@open-pencil/test-support/dom-css'

describe('shadow carriers in imported HTML', () => {
  test('fold back into their parent’s effects, blended by their mix-blend-mode', () => {
    const graph = designDocumentToSceneGraph({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'div',
          attrs: {},
          computedStyle: {
            width: '40px',
            height: '20px',
            position: 'relative',
            'box-shadow': '0px 0px 4.3px 0px rgba(0, 0, 0, 0.5)'
          },
          children: [
            {
              type: 'element',
              tagName: 'div',
              attrs: { 'aria-hidden': 'true', [SHADOW_CARRIER_ATTRIBUTE]: 'drop' },
              computedStyle: {
                position: 'absolute',
                'box-shadow': '0px 4px 8.6px 0px rgba(0, 0, 0, 0.5)',
                'mix-blend-mode': 'soft-light'
              },
              children: []
            }
          ]
        }
      ]
    })
    const layer = firstLayer(graph)
    expect(graph.getChildren(layer?.id ?? '')).toEqual([])
    expect(layer?.effects.map((effect) => [effect.radius, effect.blendMode])).toEqual([
      [5, undefined],
      [10, 'SOFT_LIGHT']
    ])
  })
})
