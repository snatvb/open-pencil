import { clamp } from 'es-toolkit'

import type { ImageFilters } from '@open-pencil/scene-graph'

import { toneCurve, toned } from './curves'

type RGB = [number, number, number]

type Matrix = readonly [RGB, RGB, RGB]

interface Adjustment {
  readonly labShift: readonly [number, number]
  readonly contrastCurve: readonly number[]
  readonly exposureGain: number
  readonly exposureFalloff: number
  readonly exposureMix: number
  readonly highlightsCurve: readonly number[]
  readonly addsHighlights: boolean
  readonly shadowsCurve: readonly number[]
  readonly saturation: number
}

export type Sliders = Required<ImageFilters>

export const GAMMA = 2.2
export const EPSILON = 0.000001
export const LUMA: RGB = [0.2126, 0.7152, 0.0722]
const WHITE_POINT: RGB = [0.95047, 1, 1.08883]
const TO_XYZ: Matrix = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505]
]
const FROM_XYZ: Matrix = [
  [3.240625, -1.537208, -0.498629],
  [-0.968931, 1.875756, 0.041518],
  [0.05571, -0.204021, 1.056996]
]

// Fitted to Figma's renders of gray and color swatches at each slider's -1, -0.5, 0.5, and 1.
const LAB_SHIFT = 30
const EXPOSURE_GAIN = 100
const DARKENING_INPUT_SCALE = 0.937
const DARKENING_LUMA_MIX = 0.4
const BRIGHTENING_LUMA_MIX = 0.65
// Figma's renders set no limit for colors near gray; twice the chroma keeps them from turning vivid.
export const SATURATION_REACH = 2

function sliderValue(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0
  }
  return clamp(value, -1, 1)
}

function sliders(filters: ImageFilters): Sliders {
  return {
    exposure: sliderValue(filters.exposure),
    contrast: sliderValue(filters.contrast),
    saturation: sliderValue(filters.saturation),
    temperature: sliderValue(filters.temperature),
    tint: sliderValue(filters.tint),
    highlights: sliderValue(filters.highlights),
    shadows: sliderValue(filters.shadows)
  }
}

export function slidersMoved(filters: ImageFilters | undefined): Sliders | null {
  if (filters === undefined) {
    return null
  }
  const values = sliders(filters)
  return Object.values(values).some((value) => value !== 0) ? values : null
}

function exposureOf(
  exposure: number
): Pick<Adjustment, 'exposureGain' | 'exposureFalloff' | 'exposureMix'> {
  const gain = EXPOSURE_GAIN ** Math.abs(exposure)
  if (exposure >= 0) {
    return { exposureGain: gain, exposureFalloff: gain - 1, exposureMix: BRIGHTENING_LUMA_MIX }
  }
  const scale = DARKENING_INPUT_SCALE ** Math.abs(exposure)
  return {
    exposureGain: scale / gain,
    exposureFalloff: (-(gain - 1) * scale) / gain,
    exposureMix: DARKENING_LUMA_MIX
  }
}

export function adjustmentOf(values: Sliders): Adjustment {
  const { exposure, contrast, saturation, temperature, tint, highlights, shadows } = values
  return {
    labShift: [LAB_SHIFT * tint, LAB_SHIFT * temperature],
    contrastCurve: toneCurve('contrast', contrast),
    ...exposureOf(exposure),
    highlightsCurve: toneCurve('highlights', highlights),
    addsHighlights: highlights > 0,
    shadowsCurve: toneCurve('shadows', shadows),
    saturation
  }
}

function perChannel(color: RGB, change: (channel: number, axis: number) => number): RGB {
  return [change(color[0], 0), change(color[1], 1), change(color[2], 2)]
}

function transformed(matrix: Matrix, [x, y, z]: RGB): RGB {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z
  ]
}

function luma([red, green, blue]: RGB): number {
  return LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue
}

function clamped(color: RGB): RGB {
  return perChannel(color, (channel) => clamp(channel, 0, 1))
}

function toLab(linear: RGB): RGB {
  const [fx, fy, fz] = perChannel(transformed(TO_XYZ, linear), (value, axis) =>
    Math.cbrt(value / WHITE_POINT[axis])
  )
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function fromLab([lightness, a, b]: RGB): RGB {
  const fy = (lightness + 16) / 116
  const xyz: RGB = [fy + a / 500, fy, fy - b / 200]
  return clamped(
    transformed(
      FROM_XYZ,
      perChannel(xyz, (f, axis) => f * f * f * WHITE_POINT[axis])
    )
  )
}

function luminanceOfLightness(lightness: number): number {
  const f = (lightness + 16) / 116
  return f * f * f
}

function lightnessOfLuminance(luminance: number): number {
  return 116 * Math.cbrt(luminance) - 16
}

function tonedLuminance(curve: readonly number[], luminance: number): number {
  return toned(curve, clamp(luminance, 0, 1) ** (1 / GAMMA)) ** GAMMA
}

function exposed(adjustment: Adjustment, linear: RGB): RGB {
  const { exposureGain, exposureFalloff, exposureMix } = adjustment
  const gray = luma(linear)
  const curved = perChannel(linear, (channel) => {
    const mixed = channel + (gray - channel) * exposureMix
    return (exposureGain * mixed) / (1 + exposureFalloff * mixed)
  })
  const curvedGray = luma(curved)
  return clamped(
    perChannel(curved, (channel) => (channel - exposureMix * curvedGray) / (1 - exposureMix))
  )
}

function highlighted(adjustment: Adjustment, linear: RGB): RGB {
  const luminance = luma(linear)
  const target = tonedLuminance(adjustment.highlightsCurve, luminance)
  if (adjustment.addsHighlights) {
    return clamped(perChannel(linear, (channel) => channel + target - luminance))
  }
  const [, a, b] = toLab(linear)
  return fromLab([lightnessOfLuminance(target), a, b])
}

function shadowed(adjustment: Adjustment, linear: RGB): RGB {
  const luminance = luma(linear)
  const scale = tonedLuminance(adjustment.shadowsCurve, luminance) / Math.max(luminance, EPSILON)
  return clamped(perChannel(linear, (channel) => channel * scale))
}

function channelReach(luminance: number, channel: number): number {
  if (channel > EPSILON) {
    return (1 - luminance) / channel
  }
  if (channel < -EPSILON) {
    return luminance / -channel
  }
  return SATURATION_REACH
}

function gamutReach(luminance: number, red: number, green: number, blue: number): number {
  return Math.min(
    SATURATION_REACH,
    channelReach(luminance, red),
    channelReach(luminance, green),
    channelReach(luminance, blue)
  )
}

export function saturationScale(
  saturation: number,
  luminance: number,
  red: number,
  green: number,
  blue: number
): number {
  if (saturation <= 0) {
    return 1 + saturation
  }
  return 1 + saturation * (gamutReach(luminance, red, green, blue) - 1)
}

function saturated(saturation: number, linear: RGB): RGB {
  const luminance = luma(linear)
  const chroma = perChannel(linear, (channel) => channel - luminance)
  const scale = saturationScale(saturation, luminance, ...chroma)
  return clamped(perChannel(chroma, (channel) => luminance + channel * scale))
}

function contrasted(adjustment: Adjustment, linear: RGB): RGB {
  const [lightness, a, b] = toLab(linear)
  const [shiftA, shiftB] = adjustment.labShift
  const luminance = tonedLuminance(adjustment.contrastCurve, luminanceOfLightness(lightness))
  return fromLab([lightnessOfLuminance(luminance), a + shiftA, b + shiftB])
}

function linearized(color: RGB): RGB {
  return perChannel(color, (channel) => channel ** GAMMA)
}

function encoded(linear: RGB): RGB {
  return perChannel(linear, (channel) => channel ** (1 / GAMMA))
}

export function saturationBoost(saturation: number): number {
  return Math.max(saturation, 0)
}

export function tableSaturation(saturation: number): number {
  return Math.min(saturation, 0)
}

export function tonedColor(adjustment: Adjustment, color: RGB): RGB {
  const toned = shadowed(
    adjustment,
    highlighted(adjustment, exposed(adjustment, contrasted(adjustment, linearized(color))))
  )
  return encoded(saturated(tableSaturation(adjustment.saturation), toned))
}

export function adjustedColor(adjustment: Adjustment, color: RGB): RGB {
  const boost = saturationBoost(adjustment.saturation)
  return encoded(saturated(boost, linearized(tonedColor(adjustment, color))))
}
