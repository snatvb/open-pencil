import { describe, expect, test } from 'bun:test'

import type { Fill, SceneNode } from '@open-pencil/scene-graph'

import { patternTileLayout } from '#core/canvas/patterns/layout'

describe('pattern tile layout', () => {
  test('uses scale, spacing, and alignment for rectangular pattern tiles', () => {
    const layout = patternTileLayout(
      { width: 20, height: 10 } as SceneNode,
      {
        type: 'PATTERN',
        scale: 2,
        patternSpacing: { x: 0.25, y: 0.5 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'END',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      } as Fill
    )

    expect(layout).toEqual({
      rect: { x: 0, y: 0, width: 50, height: 30 },
      scale: 2,
      positions: [{ x: -5, y: -10 }]
    })
  })

  test('adds an offset source copy for hexagonal pattern tiles', () => {
    const layout = patternTileLayout(
      { width: 20, height: 10 } as SceneNode,
      {
        type: 'PATTERN',
        patternTileType: 'HORIZONTAL_HEXAGONAL',
        patternSpacing: { x: 0, y: 0 },
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      } as Fill
    )

    expect(layout.positions).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 }
    ])
  })
})
