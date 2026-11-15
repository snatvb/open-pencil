import { beforeAll, describe, expect, test } from 'bun:test'

import type { Canvas } from '@open-pencil/canvaskit'
import {
  SceneGraph,
  type DerivedTextGlyph,
  type Effect,
  type SceneNode
} from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { SkiaRenderer } from '#core/canvas/renderer'
import { withSavedBaselineOnDevicePixels } from '#core/canvas/text/render'
import { getCanvasKit } from '#core/canvaskit'

let ck: Awaited<ReturnType<typeof getCanvasKit>>

beforeAll(async () => {
  ck = await getCanvasKit()
})

const MOVE_TO = 1
const LINE_TO = 2
const CLOSE = 0
const CANVAS_SIDE = 40
const FONT_SIZE = 16
const BASELINE = 11.92
const SECOND_BASELINE = 31.08
const GLYPH_HEIGHT = FONT_SIZE * 0.5
const GLYPH_LEFT = 2
const GLYPH_RIGHT = GLYPH_LEFT + FONT_SIZE * 0.5
const SHADOW_SHIFT = 20
const OPAQUE = 255
const RED = 0
const ALPHA = 3

function squareBlob(corners: number[][]): Uint8Array {
  const blob = new Uint8Array(corners.length * 9 + 1)
  const view = new DataView(blob.buffer)
  for (const [index, [x, y]] of corners.entries()) {
    blob[index * 9] = index === 0 ? MOVE_TO : LINE_TO
    view.setFloat32(index * 9 + 1, x, true)
    view.setFloat32(index * 9 + 5, y, true)
  }
  blob[corners.length * 9] = CLOSE
  return blob
}

const HALF_EM_SQUARE = squareBlob([
  [0, 0],
  [0.5, 0],
  [0.5, 0.5],
  [0, 0.5]
])

function squareGlyph(y: number, firstCharacter: number): DerivedTextGlyph {
  return { commandsBlob: HALF_EM_SQUARE, x: GLYPH_LEFT, y, fontSize: FONT_SIZE, firstCharacter }
}

function savedText(glyphs: DerivedTextGlyph[], fields: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    text: 'AB'.slice(0, glyphs.length),
    width: 12,
    height: 36,
    fontFamily: 'Device Pixel Test Missing',
    fontSize: FONT_SIZE,
    fontWeight: 500,
    derivedTextGlyphs: glyphs,
    ...fields
  })
  return { graph, node }
}

type Place = (canvas: Canvas, layerY: number, draw: (target: Canvas) => void) => void

function placeDirectly(canvas: Canvas, layerY: number, draw: (target: Canvas) => void): void {
  canvas.translate(0, layerY)
  draw(canvas)
}

/** Records the layer in world space, as render chunks are, and replays it on the scaled canvas. */
function placeThroughWorldPicture(
  canvas: Canvas,
  layerY: number,
  draw: (target: Canvas) => void
): void {
  const recorder = new ck.PictureRecorder()
  try {
    const world = recorder.beginRecording(ck.LTRBRect(0, 0, CANVAS_SIDE, CANVAS_SIDE))
    placeDirectly(world, layerY, draw)
    const picture = recorder.finishRecordingAsPicture()
    canvas.drawPicture(picture)
    picture.delete()
  } finally {
    recorder.delete()
  }
}

interface Drawn {
  pixels: ArrayLike<number>
  side: number
}

function drawLayer(
  { graph, node }: ReturnType<typeof savedText>,
  scale: number,
  layerY: number,
  place: Place = placeDirectly
): Drawn {
  const side = CANVAS_SIDE * scale
  const surface = expectDefined(ck.MakeSurface(side, side), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.scale(scale, scale)
    place(canvas, layerY, (target) => renderer.renderShape(target, node, graph))
    const pixels = expectDefined(
      canvas.readPixels(0, 0, {
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
        width: side,
        height: side
      }),
      'pixels'
    )
    return { pixels, side }
  } finally {
    renderer.destroy()
  }
}

/** The peak of one channel across each row, between two layer x positions. */
function rowPeaks(
  { pixels, side }: Drawn,
  scale: number,
  from: number,
  to: number,
  channel = ALPHA
) {
  return Array.from({ length: side }, (_, row) => {
    let peak = 0
    for (let column = Math.floor(from * scale); column < Math.ceil(to * scale); column++) {
      peak = Math.max(peak, pixels[(row * side + column) * 4 + channel])
    }
    return peak
  })
}

function glyphRows(drawn: Drawn, scale: number): number[] {
  return rowPeaks(drawn, scale, 0, GLYPH_RIGHT + 1)
}

function partialRows(rows: number[]): number[] {
  return rows.filter((alpha) => alpha > 0 && alpha < OPAQUE)
}

function opaqueRows(rows: number[]): number[] {
  return rows.flatMap((alpha, row) => (alpha === OPAQUE ? [row] : []))
}

/** The device rows a glyph fully covers when it stands on device row boundary `bottom`. */
function rowsStandingOn(bottom: number, scale: number): number[] {
  const height = GLYPH_HEIGHT * scale
  return Array.from({ length: height }, (_, index) => bottom - height + index)
}

const solid = { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }

describe('saved glyph baselines on whole device pixels', () => {
  test.each([
    [1, 0.5],
    [1, 3.5],
    [2, 0.25],
    [2, 0.75]
  ])('draws cap top and baseline rows at full coverage at scale %d, layer at y %d', (scale, y) => {
    const rows = glyphRows(drawLayer(savedText([squareGlyph(BASELINE, 0)]), scale, y), scale)
    expect(partialRows(rows)).toEqual([])
    expect(opaqueRows(rows)).toEqual(rowsStandingOn(Math.round(scale * (y + BASELINE)), scale))
  })

  test.each([1, 2])('keeps every line of a block on whole pixels at scale %d', (scale) => {
    const layerY = 0.25
    const text = savedText([squareGlyph(BASELINE, 0), squareGlyph(SECOND_BASELINE, 1)])
    const rows = glyphRows(drawLayer(text, scale, layerY), scale)
    expect(partialRows(rows)).toEqual([])
    const firstBottom = Math.round(scale * (layerY + BASELINE))
    const lineGap = scale * (Math.round(SECOND_BASELINE) - Math.round(BASELINE))
    expect(opaqueRows(rows)).toEqual([
      ...rowsStandingOn(firstBottom, scale),
      ...rowsStandingOn(firstBottom + lineGap, scale)
    ])
  })

  test('keeps text recorded in world space on whole pixels when replayed at scale 2', () => {
    const layerY = 0.5
    const text = savedText([squareGlyph(BASELINE, 0)])
    const rows = glyphRows(drawLayer(text, 2, layerY, placeThroughWorldPicture), 2)
    expect(partialRows(rows)).toEqual([])
    expect(opaqueRows(rows)).toEqual(rowsStandingOn(2 * Math.round(layerY + BASELINE), 2))
  })

  test('moves a text with a shadow, drawn from its cached picture, with its shadow', () => {
    const shadow: Effect = {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 1 },
      offset: { x: SHADOW_SHIFT, y: 0 },
      radius: 0,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    }
    const text = savedText([squareGlyph(BASELINE, 0)], { effects: [shadow] })
    const layerY = 0.5
    const expected = rowsStandingOn(Math.round(layerY + BASELINE), 1)
    for (const drawn of [drawLayer(text, 1, layerY), drawLayer(text, 1, layerY)]) {
      const glyph = glyphRows(drawn, 1)
      const cast = rowPeaks(drawn, 1, GLYPH_LEFT + SHADOW_SHIFT, GLYPH_RIGHT + SHADOW_SHIFT)
      expect(partialRows(glyph)).toEqual([])
      expect(opaqueRows(glyph)).toEqual(expected)
      expect(opaqueRows(cast)).toEqual(expected)
    }
  })

  test('keeps saved stroke geometry on the glyphs it outlines', () => {
    const top = Math.round(BASELINE) - GLYPH_HEIGHT
    const outline = squareBlob([
      [GLYPH_LEFT, top],
      [GLYPH_RIGHT, top],
      [GLYPH_RIGHT, Math.round(BASELINE)],
      [GLYPH_LEFT, Math.round(BASELINE)]
    ])
    const text = savedText([squareGlyph(BASELINE, 0)], {
      strokes: [{ ...solid, color: { r: 1, g: 0, b: 0, a: 1 }, weight: 1, align: 'CENTER' }],
      strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: outline }]
    } as Partial<SceneNode>)
    const layerY = 0.5
    const drawn = drawLayer(text, 1, layerY)
    const strokeRows = rowPeaks(drawn, 1, GLYPH_LEFT, GLYPH_RIGHT, RED)
    const bottom = Math.round(layerY + BASELINE)
    expect(opaqueRows(strokeRows)).toEqual(rowsStandingOn(bottom, 1))
  })

  test('leaves text on a whole pixel where it was', () => {
    const rows = glyphRows(drawLayer(savedText([squareGlyph(BASELINE, 0)]), 1, 0), 1)
    expect(partialRows(rows)).toEqual([])
    expect(opaqueRows(rows)).toEqual(rowsStandingOn(Math.round(BASELINE), 1))
  })

  test.each([
    ['a rotated canvas', [squareGlyph(BASELINE, 0)], 30],
    ['path text with rotated glyphs', [{ ...squareGlyph(BASELINE, 0), rotation: 0.3 }], 0]
  ])('leaves %s where it was', (_name, glyphs, degrees) => {
    const { node } = savedText(glyphs)
    const surface = expectDefined(ck.MakeSurface(CANVAS_SIDE, CANVAS_SIDE), 'surface')
    const renderer = new SkiaRenderer(ck, surface)
    try {
      const canvas = surface.getCanvas()
      canvas.translate(0, 0.5)
      canvas.rotate(degrees, 0, 0)
      const before = canvas.getTotalMatrix()
      withSavedBaselineOnDevicePixels(renderer, canvas, node, () => {
        expect(canvas.getTotalMatrix()).toEqual(before)
      })
    } finally {
      renderer.destroy()
    }
  })

  test('reads no glyph of a text drawn from its loaded fonts', () => {
    let rotationReads = 0
    const glyph = Object.defineProperty({ ...squareGlyph(BASELINE, 0) }, 'rotation', {
      get() {
        rotationReads++
        return 0
      }
    })
    const { node } = savedText([squareGlyph(BASELINE, 0)])
    node.derivedTextGlyphs = [glyph]
    const surface = expectDefined(ck.MakeSurface(CANVAS_SIDE, CANVAS_SIDE), 'surface')
    const renderer = new SkiaRenderer(ck, surface)
    try {
      renderer.nodeFontReadiness = () => 'ready'
      const canvas = surface.getCanvas()
      canvas.translate(0, 0.5)
      const before = canvas.getTotalMatrix()
      withSavedBaselineOnDevicePixels(renderer, canvas, node, () => {
        expect(canvas.getTotalMatrix()).toEqual(before)
      })
      expect(rotationReads).toBe(0)
    } finally {
      renderer.destroy()
    }
  })
})
