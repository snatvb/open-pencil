import {
  parseFontStyle,
  type CharacterStyleOverride,
  type FontFamilyStyle
} from '@open-pencil/scene-graph'

import { FONT_WEIGHT_NAMES } from '#core/text/fonts'

export type FigmaFontName = FontFamilyStyle
export type FigmaFont = { fontName: FigmaFontName }

export function weightToStyleName(weight: number, italic: boolean): string {
  const base = FONT_WEIGHT_NAMES[weight] ?? 'Regular'
  return italic ? `${base} Italic` : base
}

export function styleNameToWeight(style: string): { weight: number; italic: boolean } {
  const { weight, italic } = parseFontStyle(style)
  return { weight, italic }
}

export function fontNameFields(
  fontName: FigmaFontName
): Pick<CharacterStyleOverride, 'fontFamily' | 'fontWeight' | 'italic' | 'fontName'> {
  const { weight, italic } = parseFontStyle(fontName.style)
  return {
    fontFamily: fontName.family,
    fontWeight: weight,
    italic,
    fontName: { family: fontName.family, style: fontName.style, postScriptName: '' }
  }
}
