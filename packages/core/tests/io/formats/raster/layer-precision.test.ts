import { afterAll, expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { SceneGraph, type Fill } from '@open-pencil/scene-graph'
import { maxOf } from '@open-pencil/scene-graph/arrays'
import { expectDefined } from '@open-pencil/test-support/assert'

const ck = await getCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))

afterAll(() => renderer.destroy())

const SIZE = 128
const BACKDROP = 64
const SHADE = 13

interface StripOpacities {
  outer: number
  inner: number
  shade: number
}

function grey(level: number): Fill {
  const value = level / 255
  return {
    type: 'SOLID',
    color: { r: value, g: value, b: value, a: 1 },
    opacity: 1,
    visible: true,
    blendMode: 'NORMAL'
  }
}

const transparentToOpaqueDownwards: Fill = {
  type: 'GRADIENT_LINEAR',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  blendMode: 'NORMAL',
  gradientTransform: { m00: 0, m01: 1, m02: 0, m10: 1, m11: 0, m12: 0 },
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
    { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
  ]
}

function vignetteStrip(opacities: StripOpacities) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const box = { x: 0, y: 0, width: SIZE, height: SIZE }
  const root = graph.createNode('FRAME', page.id, { ...box, fills: [grey(BACKDROP)] })
  const outer = graph.createNode('FRAME', root.id, { ...box, fills: [], opacity: opacities.outer })
  const inner = graph.createNode('FRAME', outer.id, { ...box, fills: [], opacity: opacities.inner })
  graph.createNode('RECTANGLE', inner.id, {
    ...box,
    fills: [transparentToOpaqueDownwards],
    isMask: true,
    maskType: 'ALPHA'
  })
  graph.createNode('RECTANGLE', inner.id, {
    ...box,
    fills: [grey(SHADE)],
    opacity: opacities.shade
  })
  return { graph, pageId: page.id, rootId: root.id }
}

function middleColumn(png: Uint8Array, size: number): number[] {
  const image = expectDefined(ck.MakeImageFromEncoded(png), 'image')
  const pixels = expectDefined(
    image.readPixels(0, 0, {
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
      width: size,
      height: size
    }),
    'pixels'
  )
  image.delete()
  return Array.from({ length: size }, (_, row) => pixels[(row * size + size / 2) * 4])
}

function figmaLevel(opacities: StripOpacities, row: number, size: number): number {
  const maskAlpha = (row + 0.5) / size
  const shadeAlpha = opacities.outer * opacities.inner * opacities.shade * maskAlpha
  return BACKDROP - shadeAlpha * (BACKDROP - SHADE)
}

function exportErrors(opacities: StripOpacities, scale = 1): number[] {
  const { graph, pageId, rootId } = vignetteStrip(opacities)
  const png = expectDefined(
    renderNodesToImage(ck, renderer, graph, pageId, [rootId], { scale, format: 'PNG' }),
    'png'
  )
  const size = SIZE * scale
  return middleColumn(png, size).map((level, row) => level - figmaLevel(opacities, row, size))
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

test('a shade masked by a ramp inside nested faded groups exports as dark as Figma draws it', () => {
  const errors = exportErrors({ outer: 0.7, inner: 0.85, shade: 0.7 })

  expect(Math.abs(mean(errors))).toBeLessThan(0.15)
  expect(maxOf(errors.map(Math.abs))).toBeLessThanOrEqual(0.6)
})

test('an opaque shade masked by a ramp exports at 2x as dark as Figma draws it', () => {
  const errors = exportErrors({ outer: 1, inner: 1, shade: 1 }, 2)

  expect(Math.abs(mean(errors))).toBeLessThan(0.15)
  expect(maxOf(errors.map(Math.abs))).toBeLessThanOrEqual(0.6)
})
