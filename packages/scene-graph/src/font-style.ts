import { memoize } from 'es-toolkit/function'
import { omit } from 'es-toolkit/object'

import type { CharacterStyleOverride, SceneNode, StyleRun } from './types'

export interface FontFamilyStyle {
  family: string
  style: string
}

export interface FontName extends FontFamilyStyle {
  postScriptName: string
}

export interface ParsedFontStyle {
  weight: number
  italic: boolean
  width: number
}

export const FONT_WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black'
}

const FONT_WEIGHT_ALIASES = [
  { weight: 100, names: ['thin', 'hairline', 'extrathin', 'ultrathin'] },
  { weight: 200, names: ['extralight', 'ultralight'] },
  { weight: 300, names: ['light'] },
  { weight: 400, names: ['regular', 'normal', 'book', 'roman', 'plain'] },
  { weight: 500, names: ['medium'] },
  { weight: 600, names: ['semibold', 'demibold'] },
  { weight: 700, names: ['bold'] },
  { weight: 800, names: ['extrabold', 'ultrabold'] },
  { weight: 900, names: ['black', 'heavy'] }
] as const

const FONT_WEIGHT_BY_STYLE: ReadonlyMap<string, number> = new Map(
  FONT_WEIGHT_ALIASES.flatMap(({ names, weight }) => names.map((name) => [name, weight] as const))
)

export function normalizeFontStyleName(style: string): string {
  return style
    .toLowerCase()
    .replace(/italic|oblique/u, '')
    .replace(/[^a-z0-9]+/gu, '')
}

export const NORMAL_FONT_WIDTH = 5

const FONT_WIDTH_ALIASES = [
  { width: 1, names: ['ultracondensed', 'ultracompressed', 'extracompressed'] },
  { width: 2, names: ['extracondensed', 'compressed'] },
  { width: 3, names: ['condensed', 'narrow', 'semicompressed'] },
  { width: 4, names: ['semicondensed', 'demicondensed'] },
  { width: 6, names: ['semiexpanded', 'semiextended'] },
  { width: 7, names: ['expanded', 'extended', 'wide'] },
  { width: 8, names: ['extraexpanded', 'extraextended'] },
  { width: 9, names: ['ultraexpanded', 'ultraextended'] }
] as const

const FONT_WIDTH_BY_NAME: ReadonlyMap<string, number> = new Map(
  FONT_WIDTH_ALIASES.flatMap(({ names, width }) => names.map((name) => [name, width] as const))
)

const FONT_WIDTH_NAME = new RegExp(
  [...FONT_WIDTH_BY_NAME.keys()].toSorted((a, b) => b.length - a.length).join('|'),
  'u'
)

function weightOfStyleName(name: string): number {
  const numericWeight = name.match(/(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/u)?.[1]
  return numericWeight ? Number(numericWeight) : (FONT_WEIGHT_BY_STYLE.get(name) ?? 400)
}

function parseUncachedFontStyle(style: string | undefined): ParsedFontStyle {
  const raw = style ?? ''
  const normalized = normalizeFontStyleName(raw)
  const widthName = normalized.match(FONT_WIDTH_NAME)?.[0]
  return {
    weight: weightOfStyleName(widthName ? normalized.replace(widthName, '') : normalized),
    italic: /(?:italic|oblique)/iu.test(raw),
    width: (widthName && FONT_WIDTH_BY_NAME.get(widthName)) || NORMAL_FONT_WIDTH
  }
}

export const parseFontStyle = memoize(parseUncachedFontStyle)

export function styleToWeight(style: string | undefined): number {
  return parseFontStyle(style).weight
}

export function normalizeFontFamily(family: string): string {
  return family.replace(/\s+(Variable|\d+(?:pt|px|em))$/i, '')
}

export function styleToVariant(style: string): string {
  const weight = styleToWeight(style)
  const italic = style.toLowerCase().includes('italic')
  if (weight === 400 && !italic) return 'regular'
  if (weight === 400 && italic) return 'italic'
  return italic ? `${weight}italic` : `${weight}`
}

export function weightToStyle(weight: number, italic = false): string {
  const rounded = Math.round(weight / 100) * 100
  const label = (FONT_WEIGHT_NAMES[rounded] ?? 'Regular').replace(/ /g, '')
  return italic ? `${label} Italic` : label
}

export function authoredFontName(
  fontName: FontName | null | undefined,
  family: string,
  weight: number,
  italic: boolean
): FontName | null {
  if (!fontName || fontName.family !== family) {
    return null
  }
  const authored = parseFontStyle(fontName.style)
  return authored.weight === weight && authored.italic === italic ? fontName : null
}

const namesOnlyWeightAndSlant = memoize((style: string): boolean => {
  if (parseFontStyle(style).width !== NORMAL_FONT_WIDTH) {
    return false
  }
  const name = normalizeFontStyleName(style)
  return name === '' || FONT_WEIGHT_BY_STYLE.has(name) || /^[1-9]00$/u.test(name)
})

export function distinctFontFace(
  fontName: FontName | null | undefined,
  family: string,
  weight: number,
  italic: boolean
): FontName | null {
  const authored = authoredFontName(fontName, family, weight, italic)
  return authored && !namesOnlyWeightAndSlant(authored.style) ? authored : null
}

export function fontFaceStyle(
  fontName: FontName | null | undefined,
  family: string,
  weight: number,
  italic: boolean
): string {
  return distinctFontFace(fontName, family, weight, italic)?.style ?? weightToStyle(weight, italic)
}

export function runFontName(
  text: { fontName: FontName | null },
  style: Pick<CharacterStyleOverride, 'fontName'>
): FontName | null {
  return style.fontName === undefined ? text.fontName : style.fontName
}

const FONT_FACE_FIELDS = ['fontFamily', 'fontWeight', 'italic'] as const

type FontFaceField = (typeof FONT_FACE_FIELDS)[number]

type FontFaceStyle = Pick<CharacterStyleOverride, FontFaceField | 'fontName'>

export function isFontFaceField(field: string): field is FontFaceField {
  return (FONT_FACE_FIELDS as readonly string[]).includes(field)
}

const NO_FONT_FACE_FIELDS: readonly FontFaceField[] = []

function setsNoFontFaceField(changes: FontFaceStyle): boolean {
  return (
    changes.fontFamily === undefined &&
    changes.fontWeight === undefined &&
    changes.italic === undefined
  )
}

function changedFontFaceFields(
  current: FontFaceStyle,
  changes: FontFaceStyle
): readonly FontFaceField[] {
  if (setsNoFontFaceField(changes)) {
    return NO_FONT_FACE_FIELDS
  }
  return FONT_FACE_FIELDS.filter(
    (field) => changes[field] !== undefined && changes[field] !== current[field]
  )
}

function inheritsAnyOf(style: CharacterStyleOverride, fields: readonly FontFaceField[]): boolean {
  return fields.some((field) => style[field] === undefined)
}

export function fontNameDetachmentChanges(
  node: Pick<SceneNode, FontFaceField | 'fontName' | 'styleRuns'>,
  changes: Partial<SceneNode>
): Partial<SceneNode> {
  const changed = changedFontFaceFields(node, changes)
  if (changed.length === 0) {
    return changes
  }
  const fontName = changes.fontName ?? null
  const runs = changes.styleRuns ?? node.styleRuns
  const isStale = (run: StyleRun) =>
    run.style.fontName !== undefined && inheritsAnyOf(run.style, changed)
  if (!runs.some(isStale)) {
    return { ...changes, fontName }
  }
  const styleRuns = runs
    .map((run) => (isStale(run) ? { ...run, style: omit(run.style, ['fontName']) } : run))
    .filter((run) => Object.keys(run.style).length > 0)
  return { ...changes, fontName, styleRuns }
}
