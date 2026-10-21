import { describe, expect, test } from 'bun:test'

import { indexLocalFonts, LocalFontLibrary, matchLocalFont } from '#core/text/font/local'

function font(family: string, style: string, postscriptName: string, fullName = family) {
  return { family, style, postscriptName, fullName }
}

const ACME = [
  font('Acme', 'Regular', 'Acme-Regular', 'Acme Regular'),
  font('Acme', 'Medium', 'Acme-Medium', 'Acme Medium'),
  font('Acme Compressed Medium', 'Regular', 'Acme-CompressedMedium', 'Acme Compressed Medium'),
  font(
    'Acme Compressed Medium',
    'Italic',
    'Acme-CompressedMediumItalic',
    'Acme Compressed Medium Italic'
  ),
  font('Acme Wide', 'Bold', 'AcmeWide-Bold', 'Acme Wide Bold')
]

describe('matchLocalFont', () => {
  const index = indexLocalFonts(ACME)

  test('takes the face its family lists under the style', () => {
    expect(matchLocalFont(index, 'Acme', 'Medium')?.postscriptName).toBe('Acme-Medium')
  })

  test('does not take a face of another width for a width style', () => {
    expect(matchLocalFont(index, 'Acme', 'Compressed Medium')?.postscriptName).toBe(
      'Acme-CompressedMedium'
    )
  })

  test('finds a face listed as a family of its own by PostScript name', () => {
    expect(
      matchLocalFont(index, 'Acme', 'Compressed Medium Italic', 'Acme-CompressedMediumItalic')
        ?.fullName
    ).toBe('Acme Compressed Medium Italic')
  })

  test('finds it by full name without a PostScript name', () => {
    expect(matchLocalFont(index, 'Acme', 'Compressed Medium Italic')?.postscriptName).toBe(
      'Acme-CompressedMediumItalic'
    )
  })

  test('leaves a face nothing names missing', () => {
    expect(matchLocalFont(index, 'Acme', 'Condensed Bold')).toBeUndefined()
  })
})

describe('LocalFontLibrary', () => {
  function library(installed: ReturnType<typeof font>[]) {
    let queries = 0
    const fonts = new LocalFontLibrary(async () => {
      queries++
      return [...installed]
    })
    return { fonts, queries: () => queries }
  }

  test('lists the installed fonts once while they have what is asked for', async () => {
    const { fonts, queries } = library(ACME)
    await fonts.match('Acme', 'Regular')
    await fonts.match('Acme', 'Medium')
    expect(queries()).toBe(1)
  })

  test('lists them again once on a miss, and finds a font installed since', async () => {
    const installed = [...ACME]
    const { fonts, queries } = library(installed)
    await fonts.match('Acme', 'Regular')
    installed.push(font('Foo', 'Regular', 'Foo-Regular', 'Foo Regular'))
    expect((await fonts.match('Foo', 'Regular'))?.postscriptName).toBe('Foo-Regular')
    expect(queries()).toBe(2)
  })

  test('does not list them again for a miss on a fresh list', async () => {
    const { fonts, queries } = library(ACME)
    expect(await fonts.match('Bar', 'Regular')).toBeUndefined()
    expect(queries()).toBe(1)
    expect(await fonts.match('Bar', 'Regular')).toBeUndefined()
    expect(queries()).toBe(2)
  })

  test('lists them again once for many misses until a new generation begins', async () => {
    const { fonts, queries } = library(ACME)
    await fonts.match('Acme', 'Regular')
    for (const family of ['Bar', 'Baz', 'Qux']) {
      expect(await fonts.match(family, 'Regular')).toBeUndefined()
    }
    expect(queries()).toBe(2)
  })

  test('lists them again on the first miss of a new generation', async () => {
    const installed = [...ACME]
    const { fonts, queries } = library(installed)
    await fonts.match('Acme', 'Regular')
    await fonts.match('Bar', 'Regular')
    installed.push(font('Bar', 'Regular', 'Bar-Regular', 'Bar Regular'))
    fonts.beginGeneration()
    expect((await fonts.match('Bar', 'Regular'))?.postscriptName).toBe('Bar-Regular')
    expect(queries()).toBe(3)
    await fonts.match('Baz', 'Regular')
    expect(queries()).toBe(3)
  })

  test('shares one new list among misses waiting on the same old one', async () => {
    const { fonts, queries } = library(ACME)
    await fonts.match('Acme', 'Regular')
    await Promise.all([fonts.match('Bar', 'Regular'), fonts.match('Baz', 'Regular')])
    expect(queries()).toBe(2)
  })
})
