import { describe, expect, test } from 'bun:test'

import { fontFaceName, fontLegacyFamilyName } from '#core/text/font/variation'

interface NameEntry {
  platform: number
  encoding: number
  language: number
  id: number
  text: string
}

const WIN_EN = { platform: 3, encoding: 1, language: 0x409 }
const WIN_DE = { platform: 3, encoding: 1, language: 0x407 }
const MAC_EN = { platform: 1, encoding: 0, language: 0 }
const MAC_DE = { platform: 1, encoding: 0, language: 2 }
const UNICODE = { platform: 0, encoding: 3, language: 0 }

function encoded({ platform, text }: NameEntry): number[] {
  if (platform === MAC_EN.platform) {
    return Array.from(new TextEncoder().encode(text))
  }
  return Array.from(text).flatMap((character) => {
    const code = character.charCodeAt(0)
    return [code >> 8, code & 0xff]
  })
}

function u16(value: number): number[] {
  return [value >> 8, value & 0xff]
}

function fontWithNames(entries: readonly NameEntry[]): ArrayBuffer {
  const sorted = entries.toSorted(
    (a, b) =>
      a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id
  )
  const strings = sorted.map(encoded)
  let stringOffset = 0
  const records = sorted.flatMap((entry, index) => {
    const fields = [entry.platform, entry.encoding, entry.language, entry.id]
    const record = [...fields, strings[index].length, stringOffset].flatMap(u16)
    stringOffset += strings[index].length
    return record
  })
  const name = [...u16(0), ...u16(sorted.length), ...u16(6 + records.length), ...records]
  const table = [...name, ...strings.flat()]
  const tableOffset = 12 + 16
  const header = [...u16(1), ...u16(0), ...u16(1), ...u16(0), ...u16(0), ...u16(0)]
  const record = [
    ...Array.from('name', (c) => c.charCodeAt(0)),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(tableOffset),
    ...u16(0),
    ...u16(table.length)
  ]
  return new Uint8Array([...header, ...record, ...table]).buffer
}

describe('font names, read as the desktop app reads them', () => {
  test('prefers the typographic names and falls back to the legacy ones', () => {
    const font = fontWithNames([
      { ...WIN_EN, id: 1, text: 'Acme Sans Compressed' },
      { ...WIN_EN, id: 2, text: 'Regular' },
      { ...WIN_EN, id: 16, text: 'Acme Sans' },
      { ...WIN_EN, id: 17, text: 'Compressed Medium' }
    ])
    expect(fontFaceName(font)).toEqual({ family: 'Acme Sans', style: 'Compressed Medium' })
    expect(fontLegacyFamilyName(font)).toBe('Acme Sans Compressed')
  })

  test('trims names and skips blank ones, so a blank typographic name falls back', () => {
    const font = fontWithNames([
      { ...WIN_EN, id: 1, text: ' Acme Sans ' },
      { ...WIN_EN, id: 2, text: 'Bold' },
      { ...WIN_EN, id: 16, text: ' ' },
      { ...WIN_EN, id: 17, text: '' }
    ])
    expect(fontFaceName(font)).toEqual({ family: 'Acme Sans', style: 'Bold' })
  })

  test('reads names on the Unicode platform', () => {
    const font = fontWithNames([
      { ...UNICODE, id: 1, text: 'Acme Sans' },
      { ...UNICODE, id: 2, text: 'Italic' }
    ])
    expect(fontFaceName(font)).toEqual({ family: 'Acme Sans', style: 'Italic' })
  })

  test('takes Windows English, then Mac English, then the rest in table order', () => {
    const unicodeAndMac = fontWithNames([
      { ...UNICODE, id: 1, text: 'Acme Unicode' },
      { ...MAC_EN, id: 1, text: 'Acme Mac' }
    ])
    const all = fontWithNames([
      { ...UNICODE, id: 1, text: 'Acme Unicode' },
      { ...MAC_EN, id: 1, text: 'Acme Mac' },
      { ...WIN_EN, id: 1, text: 'Acme Windows' }
    ])
    const others = fontWithNames([
      { ...MAC_DE, id: 1, text: 'Acme Mac Deutsch' },
      { ...WIN_DE, id: 1, text: 'Acme Windows Deutsch' }
    ])
    expect(fontLegacyFamilyName(unicodeAndMac)).toBe('Acme Mac')
    expect(fontLegacyFamilyName(all)).toBe('Acme Windows')
    expect(fontLegacyFamilyName(others)).toBe('Acme Mac Deutsch')
  })

  test('takes a Mac English name over a blank Windows English one', () => {
    const font = fontWithNames([
      { ...WIN_EN, id: 1, text: '' },
      { ...MAC_EN, id: 1, text: 'Acme Sans' }
    ])
    expect(fontLegacyFamilyName(font)).toBe('Acme Sans')
  })

  test('names nothing for a font without a family', () => {
    const font = fontWithNames([{ ...WIN_EN, id: 2, text: 'Regular' }])
    expect(fontFaceName(font)).toBeNull()
    expect(fontLegacyFamilyName(font)).toBeNull()
  })
})
