import { uniq } from 'es-toolkit/array'

import { normalizeFontFamily, type FontFamilyStyle } from '@open-pencil/scene-graph'

import { chooseLocalFontMatch } from '#core/text/font/style'

export interface NamedLocalFont extends FontFamilyStyle {
  fullName: string
  postscriptName: string
}

export interface LocalFontIndex<T extends NamedLocalFont> {
  families: ReadonlyMap<string, readonly T[]>
  names: ReadonlyMap<string, T>
}

function nameKey(name: string): string {
  return name.toLowerCase()
}

export function indexLocalFonts<T extends NamedLocalFont>(fonts: readonly T[]): LocalFontIndex<T> {
  const families = new Map<string, T[]>()
  const names = new Map<string, T>()
  for (const font of fonts) {
    const family = families.get(font.family)
    if (family) {
      family.push(font)
    } else {
      families.set(font.family, [font])
    }
    for (const name of [font.postscriptName, font.fullName]) {
      if (name && !names.has(nameKey(name))) {
        names.set(nameKey(name), font)
      }
    }
  }
  return { families, names }
}

export function matchLocalFont<T extends NamedLocalFont>(
  index: LocalFontIndex<T>,
  family: string,
  style?: string,
  postScriptName?: string
): T | undefined {
  const familyFonts = uniq([family, normalizeFontFamily(family)]).flatMap(
    (name) => index.families.get(name) ?? []
  )
  return (
    chooseLocalFontMatch(familyFonts, family, style) ??
    (postScriptName ? index.names.get(nameKey(postScriptName)) : undefined) ??
    // Windows lists a face beyond regular, bold, and italic as a family named by its full name.
    (style ? index.names.get(nameKey(`${family} ${style}`)) : undefined)
  )
}

export class LocalFontLibrary<T extends NamedLocalFont> {
  private index: Promise<LocalFontIndex<T>> | null = null
  private relistedThisGeneration = false

  constructor(private readonly queryFonts: () => Promise<readonly T[]>) {}

  forget(): void {
    this.index = null
    this.beginGeneration()
  }

  beginGeneration(): void {
    this.relistedThisGeneration = false
  }

  async match(family: string, style?: string, postScriptName?: string): Promise<T | undefined> {
    const known = this.index
    const match = matchLocalFont(await (known ?? this.reindex()), family, style, postScriptName)
    if (match || !known) {
      return match
    }
    return matchLocalFont(await this.indexAfterMiss(), family, style, postScriptName)
  }

  private indexAfterMiss(): Promise<LocalFontIndex<T>> {
    if (this.relistedThisGeneration && this.index) {
      return this.index
    }
    this.relistedThisGeneration = true
    return this.reindex()
  }

  private reindex(): Promise<LocalFontIndex<T>> {
    const index = this.queryFonts().then((fonts) => indexLocalFonts(fonts))
    this.index = index
    return index
  }
}
