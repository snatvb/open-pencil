import { expect } from 'bun:test'

import type { CanvasKit } from '@open-pencil/canvaskit'
import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { SceneGraph, type Effect } from '@open-pencil/scene-graph'

import { exportedFramePixels } from './pixels'

export interface BlurScene {
  ck: CanvasKit
  renderer: SkiaRenderer
}

/**
 * A row of pixels across the left edge of a 200px square at x = 100, from x = 60 to 140, in a
 * 400px frame, read from Figma 126 exports: alpha for layer blur and drop shadow, red for inner
 * shadow on white and for background blur over a black-to-white edge.
 */
export const FIGMA: Record<string, number[]> = {
  'LAYER_BLUR 4': [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 3, 19, 51, 99, 157, 204, 237, 252, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255
  ],
  'LAYER_BLUR 16': [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 6, 10, 15, 21,
    28, 36, 46, 55, 66, 77, 91, 105, 120, 135, 150, 164, 177, 188, 200, 210, 219, 227, 234, 240,
    245, 249, 252, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
  ],
  'DROP_SHADOW 16': [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 4, 6, 10, 15, 21,
    28, 36, 46, 55, 66, 77, 91, 105, 120, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
  ],
  'INNER_SHADOW 16': [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 135, 151, 164, 178, 190, 201, 211, 220, 227, 235, 239, 245, 249, 252,
    254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255
  ],
  'BACKGROUND_BLUR 16': [
    3, 4, 4, 4, 3, 4, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 3, 4, 3, 4, 7, 9, 12, 18, 23,
    31, 39, 48, 58, 69, 80, 94, 107, 122, 137, 152, 166, 179, 190, 202, 210, 219, 227, 234, 241,
    245, 249, 252, 254, 254, 255, 255, 254, 255, 255, 255, 254, 255, 254, 254, 254, 255, 255, 255,
    254, 255, 255, 255, 255, 255, 255, 255, 254, 254, 255
  ],
  'BACKGROUND_BLUR 16 union': [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 198, 190, 202, 210, 219, 227, 234, 241, 245, 249, 252,
    254, 254, 255, 255, 254, 255, 255, 255, 254, 255, 254, 254, 254, 255, 255, 255, 254, 255, 255,
    255, 255, 255, 255, 255, 254, 254, 255
  ]
}

export const solid = (r: number, g: number, b: number, opacity = 1) => ({
  type: 'SOLID' as const,
  color: { r, g, b, a: 1 },
  opacity,
  visible: true
})

export function effect(type: Effect['type'], radius: number): Effect {
  return {
    type,
    radius,
    spread: 0,
    offset: { x: 0, y: 0 },
    color: { r: 0, g: 0, b: 0, a: 1 },
    visible: true,
    blendMode: 'NORMAL',
    showShadowBehindNode: false
  }
}

export function edgeRow(
  { ck, renderer }: BlurScene,
  build: (graph: SceneGraph, frameId: string) => void,
  channel: 0 | 3
): number[] {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', page, {
    width: 400,
    height: 400,
    fills: [],
    clipsContent: false
  })
  build(graph, frame.id)
  const { pixels, width, offset } = exportedFramePixels(ck, renderer, graph, page, frame.id)
  const row: number[] = []
  for (let x = 60; x <= 140; x++) {
    row.push(pixels[((200 + offset) * width + x + offset) * 4 + channel])
  }
  return row
}

export function expectFigmaEdge(row: number[], figma: number[], from = 60) {
  const differences = row.flatMap((value, index) =>
    60 + index < from ? [] : [Math.abs(value - figma[index])]
  )
  const rms = Math.sqrt(differences.reduce((sum, d) => sum + d * d, 0) / differences.length)
  expect(Math.max(...differences)).toBeLessThanOrEqual(6)
  expect(rms).toBeLessThanOrEqual(2)
}
