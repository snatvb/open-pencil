import { describe, expect, test } from 'bun:test'

import type { ImageFilters } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import {
  adjustedColor,
  adjustmentOf,
  saturationBoost,
  slidersMoved
} from '#core/canvas/images/adjustments/color'
import { adjustmentTable, adjustPixels } from '#core/canvas/images/adjustments/table'

const WHITE = 255
const GRID_STEP = 17
const RGBA = 4

interface Miss {
  readonly largest: number
  readonly overFive: number
}

function colorGrid(): number[][] {
  const levels = Array.from({ length: WHITE / GRID_STEP + 1 }, (_, index) => index * GRID_STEP)
  const nearWhiteYellows = Array.from({ length: 16 }, (_, index) => [
    240 + index,
    230 + index,
    150 + index * 6
  ])
  return [
    ...levels.flatMap((red) => levels.flatMap((green) => levels.map((blue) => [red, green, blue]))),
    ...nearWhiteYellows
  ]
}

function missAgainstFormula(filters: ImageFilters): Miss {
  const values = expectDefined(slidersMoved(filters), 'moved sliders')
  const adjustment = adjustmentOf(values)
  const colors = colorGrid()
  const pixels = new Uint8Array(colors.length * RGBA)
  for (const [index, color] of colors.entries()) {
    pixels.set([...color, WHITE], index * RGBA)
  }
  adjustPixels(pixels, adjustmentTable(values), saturationBoost(values.saturation))
  let largest = 0
  let overFive = 0
  for (const [index, color] of colors.entries()) {
    const exact = adjustedColor(adjustment, [color[0] / WHITE, color[1] / WHITE, color[2] / WHITE])
    const miss = exact.reduce(
      (largestChannel, channel, axis) =>
        Math.max(
          largestChannel,
          Math.abs(Math.round(channel * WHITE) - pixels[index * RGBA + axis])
        ),
      0
    )
    largest = Math.max(largest, miss)
    if (miss > 5) {
      overFive++
    }
  }
  return { largest, overFive: overFive / colors.length }
}

describe('the adjustment table', () => {
  for (const saturation of [-1, -0.5, 0.5, 1]) {
    test(`saturation ${saturation} lands within a level of the formula, near white too`, () => {
      expect(missAgainstFormula({ saturation }).largest).toBeLessThanOrEqual(1)
    })
  }

  const OTHERS: ImageFilters[] = [
    { exposure: 1 },
    { exposure: -1 },
    { contrast: 1 },
    { contrast: -1 },
    { temperature: 1 },
    { tint: -1 },
    { highlights: 1 },
    { highlights: -1 },
    { shadows: 1 },
    { exposure: 0.4, contrast: 0.3, saturation: 0.6, temperature: -0.3, shadows: 0.5 }
  ]
  for (const filters of OTHERS) {
    test(`${JSON.stringify(filters)} misses the formula by more than 5 levels on few colors`, () => {
      expect(missAgainstFormula(filters).overFive).toBeLessThanOrEqual(0.02)
    })
  }
})
