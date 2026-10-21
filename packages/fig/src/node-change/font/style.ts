import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  authoredFontName,
  FONT_WEIGHT_NAMES,
  normalizeFontFamily,
  parseFontStyle,
  type FontName
} from '@open-pencil/scene-graph'

type FigmaFontName = NonNullable<NodeChange['fontName']>

export function weightToFigmaStyle(weight: number, italic = false): string {
  const rounded = Math.round(weight / 100) * 100
  const label = FONT_WEIGHT_NAMES[rounded] ?? 'Regular'
  return italic ? `${label} Italic` : label
}

export function importFontName(fontName: FigmaFontName | undefined): FontName | null {
  if (!fontName) {
    return null
  }
  return {
    family: fontName.family,
    style: fontName.style,
    postScriptName: fontName.postscript ?? ''
  }
}

export function isItalicFigmaFont(fontName: FigmaFontName | undefined): boolean {
  return parseFontStyle(fontName?.style).italic
}

export function figmaFontName(
  fontName: FontName | null | undefined,
  family: string,
  weight: number,
  italic: boolean
): FigmaFontName {
  const authored = authoredFontName(fontName, family, weight, italic)
  if (authored) {
    return { family: authored.family, style: authored.style, postscript: authored.postScriptName }
  }
  return {
    family: normalizeFontFamily(family),
    style: weightToFigmaStyle(weight, italic),
    postscript: ''
  }
}
