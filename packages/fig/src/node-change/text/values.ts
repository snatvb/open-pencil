import * as v from 'valibot'

import { percentOfFontSize, type SceneNode, type TextDecoration } from '@open-pencil/scene-graph'

type FigTextLength = { value: number; units: string }

export type PercentLineHeightUnits = 'PERCENT' | 'RAW'

const DEFAULT_FONT_SIZE = 14

export function mapTextDecoration(d?: string): TextDecoration {
  switch (d) {
    case 'UNDERLINE':
      return 'UNDERLINE'
    case 'STRIKETHROUGH':
      return 'STRIKETHROUGH'
    default:
      return 'NONE'
  }
}

/** How Figma writes an auto line height; a percent the user set is a `RAW` multiplier. */
export const FIGMA_AUTO_LINE_HEIGHT = { value: 100, units: 'PERCENT' } as const

export function isFigmaAutoLineHeight(lh?: { value: number; units: string }): boolean {
  return lh?.units === FIGMA_AUTO_LINE_HEIGHT.units && lh.value === FIGMA_AUTO_LINE_HEIGHT.value
}

export function lineHeightPercent(lh?: FigTextLength): number | null {
  if (!lh || isFigmaAutoLineHeight(lh)) {
    return null
  }
  if (lh.units === 'PERCENT') {
    return lh.value
  }
  if (lh.units === 'RAW') {
    return lh.value * 100
  }
  return null
}

export function convertLineHeight(lh?: FigTextLength, fontSize?: number): number | null {
  if (!lh || isFigmaAutoLineHeight(lh)) {
    return null
  }
  if (lh.units === 'PIXELS') {
    return lh.value
  }
  const percent = lineHeightPercent(lh)
  return percent === null ? null : percentOfFontSize(percent, fontSize ?? DEFAULT_FONT_SIZE)
}

export function letterSpacingPercent(ls?: FigTextLength): number | null {
  return ls?.units === 'PERCENT' ? ls.value : null
}

export function convertLetterSpacing(ls?: FigTextLength, fontSize?: number): number {
  if (!ls) {
    return 0
  }
  const percent = letterSpacingPercent(ls)
  return percent === null ? ls.value : percentOfFontSize(percent, fontSize ?? DEFAULT_FONT_SIZE)
}

const PercentLineHeightSchema = v.object({
  value: v.number(),
  units: v.picklist(['PERCENT', 'RAW'])
})

const StyleOverrideTableSchema = v.object({
  styleOverrideTable: v.array(v.object({ lineHeight: v.optional(v.unknown()) }))
})

function percentUnitsOf(lineHeight: unknown): PercentLineHeightUnits | undefined {
  const parsed = v.safeParse(PercentLineHeightSchema, lineHeight)
  if (!parsed.success || isFigmaAutoLineHeight(parsed.output)) {
    return undefined
  }
  return parsed.output.units
}

export function authoredLineHeightUnits(node: Pick<SceneNode, 'source'>): PercentLineHeightUnits {
  const raw = node.source.fig.rawNodeFields
  const own = percentUnitsOf(raw.lineHeight)
  if (own) {
    return own
  }
  const textData = v.safeParse(StyleOverrideTableSchema, raw.textData)
  const overrides = textData.success ? textData.output.styleOverrideTable : []
  for (const override of overrides) {
    const units = percentUnitsOf(override.lineHeight)
    if (units) {
      return units
    }
  }
  return 'RAW'
}

export function lineHeightToKiwi(
  lineHeight: number | null,
  percent: number | null,
  units: PercentLineHeightUnits
): FigTextLength {
  if (lineHeight === null) {
    return { ...FIGMA_AUTO_LINE_HEIGHT }
  }
  if (percent === null) {
    return { value: lineHeight, units: 'PIXELS' }
  }
  const authored = { value: percent, units }
  if (units === 'RAW' || isFigmaAutoLineHeight(authored)) {
    return { value: percent / 100, units: 'RAW' }
  }
  return authored
}

export function letterSpacingToKiwi(letterSpacing: number, percent: number | null): FigTextLength {
  return percent === null
    ? { value: letterSpacing, units: 'PIXELS' }
    : { value: percent, units: 'PERCENT' }
}
