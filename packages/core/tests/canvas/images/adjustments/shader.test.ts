import { describe, expect, test } from 'bun:test'

import { expectRgbaPixels } from '#core-tests/canvas/helpers'
import {
  ck,
  expectNear,
  FIGMA_TOLERANCE,
  filled,
  imagePaint,
  middlePixelOfEachSwatchOverBlack,
  type RGB,
  SWATCH,
  SWATCHES,
  withRenderer
} from '#core-tests/canvas/images/adjustments/swatches'

import type { ImageFilters } from '@open-pencil/scene-graph'

import { adjustedImageShader } from '#core/canvas/images/adjustments/shader'

const GRAYS = 5
const DARKER_EXPOSURE_TOLERANCE = 5

interface FigmaRender {
  filters: ImageFilters
  swatches: readonly RGB[]
}

const DARKEST_EXPOSURE: FigmaRender = {
  filters: { exposure: -1 },
  swatches: [
    [0, 0, 0],
    [8, 8, 8],
    [17, 17, 17],
    [31, 31, 31],
    [101, 101, 101],
    [30, 16, 1],
    [6, 16, 29],
    [13, 33, 0]
  ]
}

const DARKER_EXPOSURE: FigmaRender = {
  filters: { exposure: -0.5 },
  swatches: [
    [0, 0, 0],
    [23, 23, 23],
    [49, 49, 49],
    [88, 88, 88],
    [225, 225, 225],
    [85, 45, 6],
    [17, 45, 82],
    [38, 92, 0]
  ]
}

// Figma's renders of the swatches above, read pixel for pixel from a 1x export.
const FIGMA_RENDERS: readonly FigmaRender[] = [
  DARKEST_EXPOSURE,
  {
    filters: { exposure: 0.5 },
    swatches: [
      [0, 0, 0],
      [155, 155, 155],
      [222, 222, 222],
      [246, 246, 246],
      [255, 255, 255],
      [255, 219, 195],
      [180, 217, 255],
      [228, 248, 217]
    ]
  },
  {
    filters: { contrast: -0.5 },
    swatches: [
      [7, 7, 7],
      [70, 70, 70],
      [127, 127, 127],
      [183, 183, 183],
      [237, 237, 237],
      [197, 117, 58],
      [60, 120, 200],
      [112, 192, 52]
    ]
  },
  {
    filters: { contrast: 0.5 },
    swatches: [
      [1, 1, 1],
      [56, 56, 56],
      [131, 131, 131],
      [201, 201, 201],
      [255, 255, 255],
      [208, 126, 66],
      [60, 120, 200],
      [131, 211, 70]
    ]
  },
  {
    filters: { shadows: -0.5 },
    swatches: [
      [0, 0, 0],
      [57, 57, 57],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [200, 120, 60],
      [58, 118, 197],
      [120, 200, 60]
    ]
  },
  {
    filters: { shadows: 0.5 },
    swatches: [
      [0, 0, 0],
      [72, 72, 72],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [200, 120, 60],
      [62, 122, 203],
      [120, 200, 60]
    ]
  },
  {
    filters: { exposure: 1 },
    swatches: [
      [0, 0, 0],
      [235, 235, 235],
      [251, 251, 251],
      [254, 254, 254],
      [255, 255, 255],
      [255, 251, 247],
      [244, 250, 255],
      [252, 254, 251]
    ]
  },
  {
    filters: { contrast: -1 },
    swatches: [
      [17, 17, 17],
      [76, 76, 76],
      [126, 126, 126],
      [173, 173, 173],
      [220, 220, 220],
      [194, 115, 55],
      [60, 120, 200],
      [104, 184, 44]
    ]
  },
  {
    filters: { contrast: 1 },
    swatches: [
      [3, 3, 3],
      [49, 49, 49],
      [134, 134, 134],
      [210, 210, 210],
      [255, 255, 255],
      [215, 132, 71],
      [61, 121, 201],
      [141, 222, 80]
    ]
  },
  {
    filters: { saturation: -0.5 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [173, 130, 109],
      [95, 120, 166],
      [153, 190, 136]
    ]
  },
  {
    filters: { saturation: 1 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [209, 116, 1],
      [1, 120, 217],
      [112, 202, 0]
    ]
  },
  {
    filters: { temperature: -1 },
    swatches: [
      [0, 5, 20],
      [8, 66, 107],
      [92, 130, 179],
      [157, 195, 248],
      [219, 255, 255],
      [191, 121, 112],
      [0, 124, 254],
      [96, 201, 122]
    ]
  },
  {
    filters: { temperature: 1 },
    swatches: [
      [15, 0, 0],
      [75, 63, 20],
      [145, 126, 78],
      [212, 190, 137],
      [255, 253, 195],
      [204, 119, 0],
      [115, 117, 149],
      [130, 200, 0]
    ]
  },
  {
    filters: { tint: -1 },
    swatches: [
      [0, 5, 0],
      [0, 74, 63],
      [57, 142, 127],
      [122, 208, 191],
      [182, 255, 254],
      [156, 139, 57],
      [0, 134, 200],
      [0, 210, 57]
    ]
  },
  {
    filters: { tint: 1 },
    swatches: [
      [9, 0, 1],
      [102, 45, 65],
      [176, 109, 129],
      [247, 172, 193],
      [255, 234, 255],
      [240, 91, 63],
      [136, 100, 201],
      [181, 187, 63]
    ]
  },
  {
    filters: { shadows: -1 },
    swatches: [
      [0, 0, 0],
      [50, 50, 50],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [200, 120, 60],
      [57, 115, 194],
      [120, 200, 60]
    ]
  },
  {
    filters: { shadows: 1 },
    swatches: [
      [0, 0, 0],
      [81, 81, 81],
      [128, 128, 128],
      [192, 192, 192],
      [255, 255, 255],
      [200, 120, 60],
      [64, 125, 206],
      [120, 200, 60]
    ]
  },
  {
    filters: { exposure: -1, contrast: -1 },
    swatches: [
      [2, 2, 2],
      [9, 9, 9],
      [17, 17, 17],
      [26, 26, 26],
      [43, 43, 43],
      [28, 15, 0],
      [6, 16, 29],
      [11, 28, 0]
    ]
  }
]

// Figma's highlights also shift the hue of bright saturated colors, so only gray levels match it.
const FIGMA_HIGHLIGHT_GRAYS: readonly FigmaRender[] = [
  {
    filters: { highlights: -0.5 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [171, 171, 171],
      [253, 253, 253]
    ]
  },
  {
    filters: { highlights: 0.5 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [209, 209, 209],
      [255, 255, 255]
    ]
  },
  {
    filters: { highlights: -1 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [149, 149, 149],
      [246, 246, 246]
    ]
  },
  {
    filters: { highlights: 1 },
    swatches: [
      [0, 0, 0],
      [64, 64, 64],
      [128, 128, 128],
      [223, 223, 223],
      [255, 255, 255]
    ]
  }
]

function halved(colors: readonly RGB[]): RGB[] {
  return colors.map(([red, green, blue]) => [red / 2, green / 2, blue / 2])
}

function grayLevels(colors: readonly RGB[]): number[] {
  return colors.slice(0, GRAYS).map(([red]) => red)
}

describe('image adjustments', () => {
  test('an image without adjustments, or with each one at 0, draws as it is', () => {
    const plain = filled()
    expect(plain).toEqual(SWATCHES.map((rgb) => [...rgb]))
    expect(
      filled({
        exposure: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0
      })
    ).toEqual(plain)
  })

  test('adjustments at 0 keep the image shader itself, adding no program to run', () => {
    const image = ck.Shader.MakeColor(ck.WHITE, ck.ColorSpace.SRGB)
    try {
      withRenderer((renderer) => {
        expect(adjustedImageShader(renderer, undefined, image)).toBe(image)
        expect(adjustedImageShader(renderer, { exposure: 0, shadows: 0 }, image)).toBe(image)
        expect(adjustedImageShader(renderer, { exposure: Number.NaN }, image)).toBe(image)
      })
    } finally {
      image.delete()
    }
  })

  test('a value that is not a number adjusts nothing, and one past an end draws as that end', () => {
    expect(filled({ exposure: Number.NaN })).toEqual(filled())
    expect(filled({ exposure: 4 })).toEqual(filled({ exposure: 1 }))
    expect(filled({ tint: -7 })).toEqual(filled({ tint: -1 }))
  })

  for (const { filters, swatches } of FIGMA_RENDERS) {
    test(`${JSON.stringify(filters)} draws the swatches as Figma does`, () => {
      expectNear(filled(filters), swatches)
    })
  }

  for (const { filters, swatches } of FIGMA_HIGHLIGHT_GRAYS) {
    test(`${JSON.stringify(filters)} draws the gray levels as Figma does`, () => {
      expectNear(filled(filters).slice(0, GRAYS), swatches)
    })
  }

  test(`${JSON.stringify(DARKER_EXPOSURE.filters)} draws the swatches near Figma`, () => {
    expectNear(filled(DARKER_EXPOSURE.filters), DARKER_EXPOSURE.swatches, DARKER_EXPOSURE_TOLERANCE)
  })

  test('a value between measured ones draws gray levels between their renders', () => {
    const plain = grayLevels(filled())
    const half = grayLevels(filled({ contrast: -0.5 }))
    for (const [index, level] of grayLevels(filled({ contrast: -0.25 })).entries()) {
      expect(level).toBeGreaterThanOrEqual(Math.min(plain[index], half[index]))
      expect(level).toBeLessThanOrEqual(Math.max(plain[index], half[index]))
    }
  })

  test('a translucent image is adjusted on its straight colors, then blended at its alpha', () => {
    const translucent = middlePixelOfEachSwatchOverBlack(
      { fills: [imagePaint(DARKEST_EXPOSURE.filters)] },
      0.5
    )
    expectNear(translucent, halved(DARKEST_EXPOSURE.swatches))
  })

  test('fill opacity blends the adjusted image', () => {
    expectNear(filled(DARKEST_EXPOSURE.filters, 0.5), halved(DARKEST_EXPOSURE.swatches))
  })

  test('a live image is adjusted on the canvas as a stored one is', () => {
    const paint = new ck.Paint()
    try {
      withRenderer((renderer) => {
        const canvas = renderer.surface.getCanvas()
        for (const [index, [red, green, blue]] of SWATCHES.entries()) {
          const color = ck.Shader.MakeColor(ck.Color(red, green, blue, 1), ck.ColorSpace.SRGB)
          paint.setShader(adjustedImageShader(renderer, DARKEST_EXPOSURE.filters, color))
          canvas.drawPaint(paint)
          const pixel = expectRgbaPixels(
            canvas.readPixels(0, 0, {
              alphaType: ck.AlphaType.Unpremul,
              colorType: ck.ColorType.RGBA_8888,
              colorSpace: ck.ColorSpace.SRGB,
              width: 1,
              height: 1
            })
          )
          expectNear([[pixel[0], pixel[1], pixel[2]]], [DARKEST_EXPOSURE.swatches[index]])
        }
      })
    } finally {
      paint.delete()
    }
  })

  test('an image stroke takes its adjustments as a fill does', () => {
    const filters = { exposure: -1, contrast: -1 }
    const stroked = middlePixelOfEachSwatchOverBlack({
      strokes: [{ ...imagePaint(filters), weight: SWATCH * 2, align: 'CENTER' }],
      strokeWeight: SWATCH * 2,
      strokeAlign: 'CENTER'
    })
    for (const channel of stroked.flat()) {
      expect(channel).toBeLessThanOrEqual(43 + FIGMA_TOLERANCE)
    }
    expect(stroked.flat().some((channel) => channel > 20)).toBe(true)
  })
})
