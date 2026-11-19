import { describe, expect, test } from 'bun:test'

import { expectRgbaPixels } from '#core-tests/canvas/helpers'
import {
  ck,
  IMAGE,
  type RGB,
  SWATCH,
  SWATCH_PIXELS,
  SWATCHES,
  swatchBytes,
  withRenderer
} from '#core-tests/canvas/images/adjustments/swatches'

import type { Image, Shader } from '@open-pencil/canvaskit'
import type { ImageFilters } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { adjustedImage } from '#core/canvas/images/adjustments/image'
import { adjustedImageShader } from '#core/canvas/images/adjustments/shader'

const FILTERS: ImageFilters = { exposure: 0.3, saturation: 0.6, temperature: 0.5 }
const NEAR_ZERO: ImageFilters = { exposure: 1e-9 }
const DARKENED_AND_SATURATED: ImageFilters = { exposure: -1, saturation: 1 }
const WARMED_AND_SATURATED: ImageFilters = { temperature: 1, saturation: 1 }
const HALF_FLOAT_RGBA_BYTES = 8
const PRIMARIES: readonly RGB[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255]
]

interface Strip {
  readonly bytes: Uint8Array
  readonly colors: readonly RGB[]
}

function stripBytes(colors: readonly RGB[]): Uint8Array {
  const surface = expectDefined(ck.MakeSurface(SWATCH * colors.length, SWATCH), 'strip surface')
  const paint = new ck.Paint()
  for (const [index, [red, green, blue]] of colors.entries()) {
    paint.setColor(ck.Color(red, green, blue, 1))
    surface.getCanvas().drawRect(ck.XYWHRect(index * SWATCH, 0, SWATCH, SWATCH), paint)
  }
  paint.delete()
  const image = surface.makeImageSnapshot()
  const bytes = expectDefined(image.encodeToBytes(ck.ImageFormat.PNG, 100), 'strip PNG')
  image.delete()
  surface.delete()
  return bytes
}

const SWATCH_STRIP: Strip = { bytes: swatchBytes(1), colors: SWATCHES }
const PRIMARY_STRIP: Strip = { bytes: stripBytes(PRIMARIES), colors: PRIMARIES }

function middleOfEach(pixels: Uint8Array, colors: readonly RGB[]): RGB[] {
  const middle = SWATCH / 2
  const width = SWATCH * colors.length
  return colors.map((_, index) => {
    const offset = (middle * width + index * SWATCH + middle) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  })
}

function sampled(image: Image): Shader {
  return image.makeShaderOptions(
    ck.TileMode.Clamp,
    ck.TileMode.Clamp,
    ck.FilterMode.Nearest,
    ck.MipmapMode.None
  )
}

function drawnOnHalfFloatDisplayP3(
  shaderOf: (swatches: Image) => Shader,
  strip: Strip = SWATCH_STRIP
): RGB[] {
  const width = SWATCH * strip.colors.length
  const info = {
    width,
    height: SWATCH,
    alphaType: ck.AlphaType.Premul,
    colorType: ck.ColorType.RGBA_F16,
    colorSpace: ck.ColorSpace.DISPLAY_P3
  }
  const memory = ck.Malloc(Uint8Array, width * SWATCH * HALF_FLOAT_RGBA_BYTES)
  const surface = expectDefined(
    ck.MakeRasterDirectSurface(info, memory, width * HALF_FLOAT_RGBA_BYTES),
    'display P3 surface'
  )
  const swatches = expectDefined(ck.MakeImageFromEncoded(strip.bytes), IMAGE)
  const paint = new ck.Paint()
  try {
    paint.setShader(shaderOf(swatches))
    surface.getCanvas().drawRect(ck.XYWHRect(0, 0, width, SWATCH), paint)
    surface.flush()
    const pixels = expectRgbaPixels(
      surface.getCanvas().readPixels(0, 0, { ...SWATCH_PIXELS, width })
    )
    return middleOfEach(pixels, strip.colors)
  } finally {
    paint.delete()
    swatches.delete()
    surface.delete()
    ck.Free(memory)
  }
}

function expectWithinOneLevel(actual: readonly RGB[], expected: readonly RGB[]) {
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(Math.abs(actual[index][channel] - value)).toBeLessThanOrEqual(1)
    }
  }
}

describe('adjusting images drawn onto a display P3 canvas', () => {
  test('a near-zero adjustment while drawn leaves every color as it is', () => {
    withRenderer((renderer) => {
      const drawn = drawnOnHalfFloatDisplayP3((swatches) =>
        adjustedImageShader(renderer, NEAR_ZERO, sampled(swatches))
      )
      expectWithinOneLevel(drawn, SWATCHES)
    })
  })

  test.each([
    ['mixed adjustments on swatches', FILTERS, SWATCH_STRIP],
    ['darkened and saturated primaries', DARKENED_AND_SATURATED, PRIMARY_STRIP],
    ['warmed and saturated primaries', WARMED_AND_SATURATED, PRIMARY_STRIP]
  ] as const)('adjusting while drawn matches the adjusted copy: %s', (_, filters, strip) => {
    withRenderer((renderer) => {
      const whileDrawn = drawnOnHalfFloatDisplayP3(
        (swatches) => adjustedImageShader(renderer, filters, sampled(swatches)),
        strip
      )
      const copy = drawnOnHalfFloatDisplayP3((swatches) => {
        const adjusted = expectDefined(adjustedImage(renderer, swatches, filters), 'adjusted copy')
        try {
          return sampled(adjusted)
        } finally {
          adjusted.delete()
        }
      }, strip)
      expectWithinOneLevel(whileDrawn, copy)
    })
  })
})
