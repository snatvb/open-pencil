import type { BlendMode } from '../types'

const CSS_BLEND_MODE_NAMES = [
  ['NORMAL', 'normal'],
  ['DARKEN', 'darken'],
  ['MULTIPLY', 'multiply'],
  ['COLOR_BURN', 'color-burn'],
  ['LIGHTEN', 'lighten'],
  ['LINEAR_BURN', 'plus-darker'],
  ['SCREEN', 'screen'],
  ['LINEAR_DODGE', 'plus-lighter'],
  ['COLOR_DODGE', 'color-dodge'],
  ['OVERLAY', 'overlay'],
  ['SOFT_LIGHT', 'soft-light'],
  ['HARD_LIGHT', 'hard-light'],
  ['DIFFERENCE', 'difference'],
  ['EXCLUSION', 'exclusion'],
  ['HUE', 'hue'],
  ['SATURATION', 'saturation'],
  ['COLOR', 'color'],
  ['LUMINOSITY', 'luminosity']
] as const satisfies ReadonlyArray<readonly [BlendMode, string]>

/**
 * Each blend mode as CSS names it, for `mix-blend-mode` and `background-blend-mode`. Linear
 * burn and linear dodge are the `plus-` modes, which `mix-blend-mode` takes and
 * `background-blend-mode` does not.
 */
export const CSS_BLEND_MODE: Partial<Record<BlendMode, string>> =
  Object.fromEntries(CSS_BLEND_MODE_NAMES)

export function blendModeFromCSS(name: string): BlendMode | undefined {
  return CSS_BLEND_MODE_NAMES.find(([, css]) => css === name)?.[0]
}
