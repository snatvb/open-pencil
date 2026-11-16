import { afterAll, describe, expect, test } from 'bun:test'

import type { Canvas } from '@open-pencil/canvaskit'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph, type BlendMode, type Fill } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { saveBlendedLayer } from '#core/canvas/blend/modes'
import { recordPicture, recordWorldPicture } from '#core/canvas/renderer/picture'

import { expectRgbaPixels } from '../helpers'

const SIZE = 40

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(SIZE, SIZE), 'surface'))
afterAll(() => renderer.destroy())

function solid(color: { r: number; g: number; b: number }): Fill {
  return {
    type: 'SOLID',
    color: { ...color, a: 1 },
    opacity: 1,
    visible: true,
    blendMode: 'NORMAL'
  }
}

describe('a layer composited with a blend mode', () => {
  function clipTheLayerRestoresInto(mode: BlendMode): number[] {
    const canvas = renderer.surface.getCanvas()
    canvas.save()
    canvas.scale(2, 2)
    saveBlendedLayer(renderer, canvas, renderer.opacityPaint, mode, ck.LTRBRect(4, 5, 10, 12))
    try {
      canvas.restore()
      return Array.from(canvas.getDeviceClipBounds())
    } finally {
      canvas.restore()
      canvas.restore()
      renderer.opacityPaint.setBlendMode(ck.BlendMode.SrcOver)
    }
  }

  test.each(['SOFT_LIGHT', 'LINEAR_BURN', 'LINEAR_DODGE'] as const)(
    'drawn directly, restores into a clip two device pixels around its bounds when %s draws through a runtime blender',
    (mode) => {
      expect(clipTheLayerRestoresInto(mode)).toEqual([6, 8, 22, 26])
    }
  )

  function clipWhileRecording(bounds: Float32Array): number[] {
    let clip: number[] = []
    const picture = recordPicture(renderer, ck.LTRBRect(0, 0, 1000, 1000), (canvas) => {
      canvas.save()
      saveBlendedLayer(renderer, canvas, renderer.opacityPaint, 'LINEAR_BURN', bounds)
      canvas.restore()
      clip = Array.from(canvas.getDeviceClipBounds())
      canvas.restore()
      canvas.restore()
    })
    picture.delete()
    renderer.opacityPaint.setBlendMode(ck.BlendMode.SrcOver)
    return clip
  }

  test('while recording a picture, restores into a clip no wider than the layer around it', () => {
    expect(clipWhileRecording(ck.LTRBRect(500, 500, 504, 504))).toEqual([496, 496, 508, 508])
  })

  test('while recording a picture, keeps at least a device pixel around a layer smaller than one', () => {
    expect(clipWhileRecording(ck.LTRBRect(500, 500, 500.25, 500.25))).toEqual([499, 499, 502, 502])
  })

  test('restores into the clip it was opened in for a blend mode Skia has', () => {
    expect(clipTheLayerRestoresInto('MULTIPLY')).toEqual([0, 0, SIZE, SIZE])
  })
})

describe('a blended layer recorded in a picture and drawn zoomed out', () => {
  function blendedFrame(mode: BlendMode, rotation: number) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, {
      width: SIZE * 4,
      height: SIZE * 4,
      fills: [solid({ r: 0.5, g: 0.5, b: 0.5 })]
    })
    const frame = graph.createNode('FRAME', page.id, {
      x: 10.5,
      y: 6.3,
      width: 50.6,
      height: 30.4,
      rotation,
      fills: [],
      blendMode: mode
    })
    graph.createNode('RECTANGLE', frame.id, {
      width: 50.6,
      height: 30.4,
      fills: [solid({ r: 0, g: 0, b: 0 })]
    })
    return { graph, pageId: page.id }
  }

  function readSurface(): Uint8Array {
    renderer.surface.flush()
    const image = renderer.surface.makeImageSnapshot()
    try {
      return expectRgbaPixels(
        image.readPixels(0, 0, {
          width: SIZE,
          height: SIZE,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        })
      )
    } finally {
      image.delete()
    }
  }

  function drawZoomed(scale: number, draw: (canvas: Canvas) => void): Uint8Array {
    const canvas = renderer.surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.save()
    canvas.scale(scale, scale)
    draw(canvas)
    canvas.restore()
    return readSurface()
  }

  function drawnDirectAndFromPicture(mode: BlendMode, rotation: number, scale: number) {
    const { graph, pageId } = blendedFrame(mode, rotation)
    renderer.pageId = pageId
    const direct = drawZoomed(scale, (canvas) =>
      renderer.renderSceneToCanvas(canvas, graph, pageId)
    )
    const world = { minX: 0, minY: 0, maxX: SIZE * 4, maxY: SIZE * 4 }
    const picture = recordWorldPicture(renderer, world, (recording) =>
      renderer.renderSceneToCanvas(recording, graph, pageId)
    )
    try {
      return { direct, replayed: drawZoomed(scale, (canvas) => canvas.drawPicture(picture)) }
    } finally {
      picture.delete()
    }
  }

  const cases = (['SOFT_LIGHT', 'LINEAR_BURN', 'LINEAR_DODGE'] as const).flatMap((mode) =>
    [0.25, 0.5].flatMap((scale) => [0, 17].map((rotation) => [mode, scale, rotation] as const))
  )

  test.each(cases)(
    '%s at zoom %d, turned %d degrees, keeps its edge pixels',
    (mode, scale, rotation) => {
      const { direct, replayed } = drawnDirectAndFromPicture(mode, rotation, scale)
      const worst = direct.reduce(
        (largest, channel, index) => Math.max(largest, Math.abs(channel - replayed[index])),
        0
      )
      expect(worst).toBeLessThanOrEqual(1)
    }
  )
})
