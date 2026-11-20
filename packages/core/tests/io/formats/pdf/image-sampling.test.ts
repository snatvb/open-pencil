import { beforeAll, expect, test } from 'bun:test'

import { encodeImage, imageFill, noiseImage } from '#core-tests/helpers/images'

import type { CanvasKit } from '@open-pencil/canvaskit'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { SkiaRenderer } from '#core/canvas'
import { renderPagesToPDF } from '#core/io/formats/pdf/export'

let ck: CanvasKit

beforeAll(async () => {
  ck = await getCanvasKit()
})

function blurredImagePDF(canvasDetail: number): Uint8Array {
  const graph = new SceneGraph()
  graph.images.set('image', encodeImage(ck, noiseImage(16, 16)))
  const pageId = graph.getPages()[0].id
  const node = graph.createNode('RECTANGLE', pageId, {
    width: 64,
    height: 64,
    fills: [imageFill('image')],
    effects: [
      {
        type: 'LAYER_BLUR',
        color: { r: 0, g: 0, b: 0, a: 0 },
        offset: { x: 0, y: 0 },
        radius: 1,
        spread: 0,
        visible: true
      }
    ]
  })
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
  try {
    renderer.images.detailScale = canvasDetail
    const result = renderPagesToPDF(renderer, graph, [{ pageId, nodeIds: [node.id] }])
    expect(renderer.images.detailScale).toBe(canvasDetail)
    return expectDefined(result, 'PDF').data
  } finally {
    renderer.destroy()
  }
}

test('a PDF draws an image the same whatever zoom the canvas was last drawn at', () => {
  expect(blurredImagePDF(0.1)).toEqual(blurredImagePDF(8))
})
