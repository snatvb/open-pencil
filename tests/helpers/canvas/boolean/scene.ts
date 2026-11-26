import type { SceneGraph } from '@open-pencil/scene-graph'

import { linearGradient, solid } from '../paints'

const STROKE_VARIANTS = [
  { align: 'INSIDE', cornerRadius: 0 },
  { align: 'CENTER', cornerRadius: 0 },
  { align: 'OUTSIDE', cornerRadius: 0 },
  { align: 'OUTSIDE', cornerRadius: 24 }
] as const

export function createBooleanStrokeAlignmentScene(graph: SceneGraph, pageId: string): void {
  for (const [index, { align, cornerRadius }] of STROKE_VARIANTS.entries()) {
    const group = graph.createNode('BOOLEAN_OPERATION', pageId, {
      name: `${align} ${cornerRadius} boolean`,
      x: 72 + index * 152,
      y: 92,
      width: 124,
      height: 104,
      booleanOperation: 'UNION',
      cornerRadius,
      fills: [solid(0.23, 0.51, 0.96)],
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0.96, g: 0.35, b: 0.35, a: 1 },
          weight: 10,
          visible: true,
          opacity: 0.6,
          align
        }
      ]
    })
    graph.createNode('RECTANGLE', group.id, {
      name: `${align} rectangle`,
      x: 0,
      y: 18,
      width: 82,
      height: 70
    })
    graph.createNode('RECTANGLE', group.id, {
      name: `${align} square`,
      x: 42,
      y: 0,
      width: 82,
      height: 104
    })
  }
}

const FILL_BLEND_MODES = ['NORMAL', 'OVERLAY', 'MULTIPLY', 'SCREEN'] as const

const GREY_RAMP = [
  { r: 0.2, g: 0.2, b: 0.2, a: 1 },
  { r: 0.9, g: 0.9, b: 0.9, a: 1 }
]

export function createBooleanFillBlendScene(graph: SceneGraph, pageId: string): void {
  for (const [index, blendMode] of FILL_BLEND_MODES.entries()) {
    const fills = [solid(0.9, 0.1, 0.1), { ...linearGradient(GREY_RAMP), opacity: 0.5, blendMode }]
    const x = 72 + index * 152
    graph.createNode('ELLIPSE', pageId, {
      name: `${blendMode} ellipse`,
      x,
      y: 32,
      width: 112,
      height: 112,
      fills
    })
    const ring = graph.createNode('BOOLEAN_OPERATION', pageId, {
      name: `${blendMode} ring`,
      x,
      y: 168,
      width: 112,
      height: 112,
      booleanOperation: 'SUBTRACT',
      fills
    })
    graph.createNode('ELLIPSE', ring.id, { name: `${blendMode} outer`, width: 112, height: 112 })
    graph.createNode('ELLIPSE', ring.id, {
      name: `${blendMode} hole`,
      x: 32,
      y: 32,
      width: 48,
      height: 48
    })
  }
}
