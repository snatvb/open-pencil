import type { Image, Shader } from '@open-pencil/canvaskit'
import type { ImageFilters } from '@open-pencil/scene-graph'

import { compiledProgram } from '#core/canvas/renderer/shaders'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { defineShader, type Float3 } from '#core/canvas/sksl'

import adjustmentsSource from './adjustments.sksl?raw'
import { EPSILON, GAMMA, LUMA, SATURATION_REACH, saturationBoost, slidersMoved } from './color'
import { type AdjustmentTable, adjustmentTableOf } from './image'
import { TABLE_SIDE } from './table'

interface AdjustmentUniforms {
  side: number
  slicesPerRow: number
  saturationBoost: number
  saturationReach: number
  gamma: number
  epsilon: number
  luma: Float3
}

const SLICES_PER_ROW = Math.ceil(Math.sqrt(TABLE_SIDE))
const TEXTURE_WIDTH = TABLE_SIDE * SLICES_PER_ROW
const TEXTURE_HEIGHT = TABLE_SIDE * Math.ceil(TABLE_SIDE / SLICES_PER_ROW)
const TEXEL_CHANNELS = 4
const TABLE_CHANNELS = 3
const HALF_FLOAT_BYTES = 2

const HALF_MANTISSA_BITS = 10
const HALF_EXPONENT_BIAS = 15
const HALF_SMALLEST_NORMAL = 2 ** -14
const HALF_SUBNORMAL_STEP = 2 ** -24
const HALF_ONE = 0x3c00

const IMAGE_ADJUSTMENTS = defineShader<AdjustmentUniforms>('image adjustments', adjustmentsSource)

function halfFloat(value: number): number {
  if (value < HALF_SMALLEST_NORMAL) {
    return Math.round(value / HALF_SUBNORMAL_STEP)
  }
  const exponent = Math.floor(Math.log2(value))
  const mantissa = Math.round((value / 2 ** exponent - 1) * 2 ** HALF_MANTISSA_BITS)
  return ((exponent + HALF_EXPONENT_BIAS) << HALF_MANTISSA_BITS) + mantissa
}

function texels(colors: Float32Array): Uint16Array<ArrayBuffer> {
  const texels = new Uint16Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * TEXEL_CHANNELS)
  for (let cell = 0; cell * TABLE_CHANNELS < colors.length; cell++) {
    const red = cell % TABLE_SIDE
    const green = Math.floor(cell / TABLE_SIDE) % TABLE_SIDE
    const blue = Math.floor(cell / (TABLE_SIDE * TABLE_SIDE))
    const x = (blue % SLICES_PER_ROW) * TABLE_SIDE + red
    const y = Math.floor(blue / SLICES_PER_ROW) * TABLE_SIDE + green
    const from = cell * TABLE_CHANNELS
    texels.set(
      [halfFloat(colors[from]), halfFloat(colors[from + 1]), halfFloat(colors[from + 2]), HALF_ONE],
      (y * TEXTURE_WIDTH + x) * TEXEL_CHANNELS
    )
  }
  return texels
}

function tableTexture(r: SkiaRenderer, table: AdjustmentTable): Image | null {
  table.texture ??= r.ck.MakeImage(
    {
      width: TEXTURE_WIDTH,
      height: TEXTURE_HEIGHT,
      alphaType: r.ck.AlphaType.Unpremul,
      colorType: r.ck.ColorType.RGBA_F16,
      colorSpace: r.ck.ColorSpace.SRGB
    },
    new Uint8Array(texels(table.colors).buffer),
    TEXTURE_WIDTH * TEXEL_CHANNELS * HALF_FLOAT_BYTES
  )
  return table.texture
}

export function adjustedImageShader(
  r: SkiaRenderer,
  filters: ImageFilters | undefined,
  image: Shader
): Shader {
  const values = slidersMoved(filters)
  if (!values) {
    return image
  }
  const program = compiledProgram(r.ck, r.shaders, IMAGE_ADJUSTMENTS)
  const texture = tableTexture(r, adjustmentTableOf(r, values))
  if (!texture) {
    return image
  }
  const table = texture.makeShaderOptions(
    r.ck.TileMode.Clamp,
    r.ck.TileMode.Clamp,
    r.ck.FilterMode.Nearest,
    r.ck.MipmapMode.None
  )
  try {
    return program.effect.makeShaderWithChildren(
      program.uniforms({
        side: TABLE_SIDE,
        slicesPerRow: SLICES_PER_ROW,
        saturationBoost: saturationBoost(values.saturation),
        saturationReach: SATURATION_REACH,
        gamma: GAMMA,
        epsilon: EPSILON,
        luma: LUMA
      }),
      [image, table]
    )
  } finally {
    table.delete()
    image.delete()
  }
}
