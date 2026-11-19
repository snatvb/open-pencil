import { adjustmentOf, GAMMA, LUMA, saturationScale, type Sliders, tonedColor } from './color'

export const TABLE_SIDE = 33
const LAST_CELL = TABLE_SIDE - 1
const CHANNELS = 3
const RED_STRIDE = CHANNELS
const GREEN_STRIDE = TABLE_SIDE * RED_STRIDE
const BLUE_STRIDE = TABLE_SIDE * GREEN_STRIDE
const CORNER_STRIDE = RED_STRIDE + GREEN_STRIDE + BLUE_STRIDE
const WHITE = 255
const RGBA = 4
const LIGHT_STEPS = 8192

export function adjustmentTable(values: Sliders): Float32Array<ArrayBuffer> {
  const adjustment = adjustmentOf(values)
  const table = new Float32Array(TABLE_SIDE * BLUE_STRIDE)
  for (let blue = 0; blue < TABLE_SIDE; blue++) {
    for (let green = 0; green < TABLE_SIDE; green++) {
      for (let red = 0; red < TABLE_SIDE; red++) {
        const color = tonedColor(adjustment, [red / LAST_CELL, green / LAST_CELL, blue / LAST_CELL])
        table.set(color, blue * BLUE_STRIDE + green * GREEN_STRIDE + red * RED_STRIDE)
      }
    }
  }
  return table
}

const CELL_OF_LEVEL = Int32Array.from({ length: WHITE + 1 }, (_, level) =>
  Math.min(Math.floor((level / WHITE) * LAST_CELL), LAST_CELL - 1)
)
const WEIGHT_OF_LEVEL = Float64Array.from(
  { length: WHITE + 1 },
  (_, level) => (level / WHITE) * LAST_CELL - CELL_OF_LEVEL[level]
)
const LIGHT_OF_ENCODED = Float64Array.from(
  { length: LIGHT_STEPS + 2 },
  (_, step) => Math.min(step / LIGHT_STEPS, 1) ** GAMMA
)
const LEVEL_OF_ROOT_LIGHT = Uint8Array.from({ length: LIGHT_STEPS + 1 }, (_, step) =>
  Math.round((step / LIGHT_STEPS) ** (2 / GAMMA) * WHITE)
)

function lightOf(encoded: number): number {
  const scaled = encoded * LIGHT_STEPS
  const step = Math.floor(scaled)
  const low = LIGHT_OF_ENCODED[step]
  return low + (LIGHT_OF_ENCODED[step + 1] - low) * (scaled - step)
}

function levelOfLight(light: number): number {
  return LEVEL_OF_ROOT_LIGHT[Math.round(Math.sqrt(Math.min(Math.max(light, 0), 1)) * LIGHT_STEPS)]
}

function strideOfAxisAt(weight: number, red: number, green: number): number {
  if (red === weight) {
    return RED_STRIDE
  }
  if (green === weight) {
    return GREEN_STRIDE
  }
  return BLUE_STRIDE
}

export function adjustPixels(
  pixels: Uint8Array,
  table: Float32Array,
  saturationBoost: number
): void {
  const toned = new Float64Array(CHANNELS)
  for (let at = 0; at < pixels.length; at += RGBA) {
    const red = WEIGHT_OF_LEVEL[pixels[at]]
    const green = WEIGHT_OF_LEVEL[pixels[at + 1]]
    const blue = WEIGHT_OF_LEVEL[pixels[at + 2]]
    const origin =
      CELL_OF_LEVEL[pixels[at]] * RED_STRIDE +
      CELL_OF_LEVEL[pixels[at + 1]] * GREEN_STRIDE +
      CELL_OF_LEVEL[pixels[at + 2]] * BLUE_STRIDE
    const high = Math.max(red, green, blue)
    const low = Math.min(red, green, blue)
    const middle = red + green + blue - high - low
    const first = origin + strideOfAxisAt(high, red, green)
    const second = origin + CORNER_STRIDE - strideOfAxisAt(low, red, green)
    const corner = origin + CORNER_STRIDE
    for (let channel = 0; channel < CHANNELS; channel++) {
      toned[channel] =
        (1 - high) * table[origin + channel] +
        (high - middle) * table[first + channel] +
        (middle - low) * table[second + channel] +
        low * table[corner + channel]
    }
    if (saturationBoost === 0) {
      pixels[at] = Math.round(toned[0] * WHITE)
      pixels[at + 1] = Math.round(toned[1] * WHITE)
      pixels[at + 2] = Math.round(toned[2] * WHITE)
    } else {
      saturatePixel(pixels, at, saturationBoost, toned[0], toned[1], toned[2])
    }
  }
}

function saturatePixel(
  pixels: Uint8Array,
  at: number,
  saturation: number,
  tonedRed: number,
  tonedGreen: number,
  tonedBlue: number
): void {
  const red = lightOf(tonedRed)
  const green = lightOf(tonedGreen)
  const blue = lightOf(tonedBlue)
  const luminance = LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue
  const scale = saturationScale(
    saturation,
    luminance,
    red - luminance,
    green - luminance,
    blue - luminance
  )
  pixels[at] = levelOfLight(luminance + (red - luminance) * scale)
  pixels[at + 1] = levelOfLight(luminance + (green - luminance) * scale)
  pixels[at + 2] = levelOfLight(luminance + (blue - luminance) * scale)
}
