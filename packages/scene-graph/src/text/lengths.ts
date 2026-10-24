import { isEmptyObject } from 'es-toolkit/predicate'

import type { CharacterStyleOverride, SceneNode, StyleRun } from '../types'

export const PERCENT_TEXT_LENGTHS = [
  { length: 'letterSpacing', percent: 'letterSpacingPercent' },
  { length: 'lineHeight', percent: 'lineHeightPercent' }
] as const

type PercentTextLength = (typeof PERCENT_TEXT_LENGTHS)[number]

export type TextLengthPercentKey = PercentTextLength['percent']

export type TextLengthFields = Pick<
  SceneNode,
  'fontSize' | 'letterSpacingPercent' | 'lineHeightPercent' | 'styleRuns'
>

type RunLengthStyle = Pick<CharacterStyleOverride, 'fontSize' | 'letterSpacing' | 'lineHeight'>

const PERCENT_OF_TEXT_LENGTH: ReadonlyMap<string, TextLengthPercentKey> = new Map(
  PERCENT_TEXT_LENGTHS.map(({ length, percent }) => [length, percent])
)

const TEXT_LENGTH_KEYS = new Set<string>([
  'fontSize',
  'styleRuns',
  ...PERCENT_TEXT_LENGTHS.flatMap(({ length, percent }) => [length, percent])
])

export function percentOfFontSize(percent: number, fontSize: number): number {
  return (percent / 100) * fontSize
}

export function textLengthPercentKey(key: string): TextLengthPercentKey | undefined {
  return PERCENT_OF_TEXT_LENGTH.get(key)
}

export function withPairedTextLengthKeys(
  keys: readonly (keyof SceneNode)[]
): readonly (keyof SceneNode)[] {
  let paired: (keyof SceneNode)[] | undefined
  for (const { length, percent } of PERCENT_TEXT_LENGTHS) {
    const hasLength = keys.includes(length)
    if (hasLength === keys.includes(percent)) {
      continue
    }
    paired ??= [...keys]
    paired.push(hasLength ? percent : length)
  }
  return paired ?? keys
}

export function isDerivedTextLength(
  text: Pick<SceneNode, TextLengthPercentKey>,
  key: string
): boolean {
  const percent = PERCENT_OF_TEXT_LENGTH.get(key)
  return percent !== undefined && text[percent] !== null
}

export function withPixelLengths(style: CharacterStyleOverride): CharacterStyleOverride {
  let withUnits = style
  for (const { length, percent } of PERCENT_TEXT_LENGTHS) {
    if (style[length] !== undefined && style[percent] === undefined) {
      withUnits = { ...withUnits, [percent]: null }
    }
  }
  return withUnits
}

function lengthAtRunFontSize(percent: number | null, runFontSize: number | undefined) {
  if (percent === null || runFontSize === undefined) {
    return undefined
  }
  return percentOfFontSize(percent, runFontSize)
}

export function runLetterSpacing(
  style: RunLengthStyle | undefined,
  text: Pick<SceneNode, 'letterSpacing' | 'letterSpacingPercent'>
): number {
  return (
    style?.letterSpacing ??
    lengthAtRunFontSize(text.letterSpacingPercent, style?.fontSize) ??
    text.letterSpacing
  )
}

export function runLineHeight(
  style: RunLengthStyle | undefined,
  text: Pick<SceneNode, 'lineHeight' | 'lineHeightPercent'>
): number | null {
  if (style?.lineHeight !== undefined) {
    return style.lineHeight
  }
  return lengthAtRunFontSize(text.lineHeightPercent, style?.fontSize) ?? text.lineHeight
}

function percentAfter(
  text: Pick<SceneNode, 'fontSize' | 'letterSpacingPercent' | 'lineHeightPercent'>,
  changes: Partial<SceneNode>,
  { length, percent }: PercentTextLength
): number | null {
  const changedPercent = changes[percent]
  if (changedPercent !== undefined) {
    return changedPercent
  }
  const current = text[percent]
  const changedLength = changes[length]
  if (current === null || changedLength === undefined) {
    return current
  }
  const fontSize = changes.fontSize ?? text.fontSize
  if (changedLength === percentOfFontSize(current, fontSize)) {
    return current
  }
  if (changedLength === null || fontSize === 0) {
    return null
  }
  return (changedLength / fontSize) * 100
}

function runWithOwnPercentLengths(run: StyleRun, textFontSize: number): StyleRun {
  let style = run.style
  const fontSize = style.fontSize ?? textFontSize
  for (const field of PERCENT_TEXT_LENGTHS) {
    const percent = style[field.percent]
    if (percent === undefined || percent === null) {
      continue
    }
    const length = percentOfFontSize(percent, fontSize)
    if (style[field.length] !== length) {
      style = { ...style, [field.length]: length }
    }
  }
  return style === run.style ? run : { ...run, style }
}

function styleRunsWithOwnPercentLengths(styleRuns: StyleRun[], fontSize: number): StyleRun[] {
  let resolved: StyleRun[] | undefined
  for (let index = 0; index < styleRuns.length; index++) {
    const run = runWithOwnPercentLengths(styleRuns[index], fontSize)
    if (run !== styleRuns[index]) {
      resolved ??= styleRuns.slice()
      resolved[index] = run
    }
  }
  return resolved ?? styleRuns
}

function touchesTextLengths(changes: Partial<SceneNode>): boolean {
  for (const key of TEXT_LENGTH_KEYS) {
    if (key in changes) {
      return true
    }
  }
  return false
}

export function withTextLengths(
  text: Pick<SceneNode, keyof TextLengthFields | 'letterSpacing' | 'lineHeight'>,
  changes: Partial<SceneNode>
): Partial<SceneNode> {
  if (!touchesTextLengths(changes)) {
    return changes
  }
  const derived: Partial<SceneNode> = {}
  const fontSize = changes.fontSize ?? text.fontSize
  for (const field of PERCENT_TEXT_LENGTHS) {
    const percent = percentAfter(text, changes, field)
    if (percent !== text[field.percent]) {
      derived[field.percent] = percent
    }
    if (percent === null || field.length in changes) {
      continue
    }
    const length = percentOfFontSize(percent, fontSize)
    if (length !== text[field.length]) {
      derived[field.length] = length
    }
  }
  const styleRuns = changes.styleRuns ?? text.styleRuns
  if (styleRuns.length > 0) {
    const resolvedRuns = styleRunsWithOwnPercentLengths(styleRuns, fontSize)
    if (resolvedRuns !== styleRuns) {
      derived.styleRuns = resolvedRuns
    }
  }
  return isEmptyObject(derived) ? changes : { ...changes, ...derived }
}
