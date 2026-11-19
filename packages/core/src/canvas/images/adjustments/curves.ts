import { clamp } from 'es-toolkit'

const TONE_LEVELS = 17

const LEVEL_STEP = 16
const WHITE = 255

type Levels = readonly number[]

interface MeasuredCurve {
  readonly darkest: Levels
  readonly darker: Levels
  readonly lighter: Levels
  readonly lightest: Levels
}

type ToneSlider = 'contrast' | 'highlights' | 'shadows'

const GRAYS: Levels = Array.from({ length: TONE_LEVELS }, (_, index) =>
  Math.min(index * LEVEL_STEP, WHITE)
)

// Figma's renders of gray levels 0, 16, ..., 240, 255 with the slider at -1, -0.5, 0.5, and 1.
const FIGMA_TONE_CURVES: Readonly<Record<ToneSlider, MeasuredCurve>> = {
  contrast: {
    darkest: [17, 36, 50, 63, 76, 89, 101, 113, 126, 138, 150, 162, 173, 185, 197, 209, 220],
    darker: [7, 25, 41, 56, 70, 84, 99, 113, 127, 141, 155, 169, 183, 197, 210, 224, 237],
    lighter: [1, 16, 30, 43, 56, 72, 90, 110, 131, 152, 170, 187, 201, 215, 229, 242, 255],
    lightest: [3, 16, 27, 38, 49, 64, 84, 108, 134, 159, 181, 197, 210, 222, 233, 244, 255]
  },
  highlights: {
    darkest: [0, 16, 32, 48, 64, 80, 96, 112, 128, 133, 138, 142, 149, 160, 177, 203, 246],
    darker: [0, 16, 32, 48, 64, 80, 96, 112, 128, 139, 149, 159, 171, 186, 204, 226, 253],
    lighter: [0, 16, 32, 48, 64, 80, 96, 112, 128, 149, 171, 191, 209, 224, 237, 247, 255],
    lightest: [0, 16, 32, 48, 64, 80, 96, 112, 128, 155, 181, 205, 223, 236, 245, 251, 255]
  },
  shadows: {
    darkest: [0, 12, 24, 36, 50, 65, 83, 104, 128, 144, 160, 176, 192, 208, 224, 240, 255],
    darker: [0, 14, 28, 42, 57, 72, 89, 108, 128, 144, 160, 176, 192, 208, 224, 240, 255],
    lighter: [0, 19, 37, 55, 72, 88, 103, 116, 128, 144, 160, 176, 192, 208, 224, 240, 255],
    lightest: [0, 22, 43, 63, 81, 97, 110, 120, 128, 144, 160, 176, 192, 208, 224, 240, 255]
  }
}

function between(from: Levels, to: Levels, weight: number): number[] {
  return from.map((level, index) => (level + (to[index] - level) * weight) / WHITE)
}

export function toneCurve(slider: ToneSlider, value: number): number[] {
  const { darkest, darker, lighter, lightest } = FIGMA_TONE_CURVES[slider]
  const amount = clamp(Math.abs(value), 0, 1)
  const [half, full] = value < 0 ? [darker, darkest] : [lighter, lightest]
  return amount <= 0.5 ? between(GRAYS, half, amount * 2) : between(half, full, amount * 2 - 1)
}

export function toned(curve: readonly number[], encoded: number): number {
  const level = encoded * WHITE
  const index = Math.min(Math.floor(level / LEVEL_STEP), TONE_LEVELS - 2)
  const low = GRAYS[index]
  const high = GRAYS[index + 1]
  return curve[index] + ((curve[index + 1] - curve[index]) * (level - low)) / (high - low)
}
