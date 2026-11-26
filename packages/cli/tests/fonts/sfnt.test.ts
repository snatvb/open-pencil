import { expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fontCollection,
  MAC_ENGLISH,
  nameRecordTable,
  namedFont,
  os2Table,
  sfnt,
  UNICODE,
  WINDOWS_ENGLISH,
  WINDOWS_GERMAN,
  type NameRecord
} from '#cli-tests/helpers/fonts'

import { fontFaceName } from '@open-pencil/core/text'

import { readFaceData, readFontFileFaces } from '#cli/fonts/sfnt'

async function fontFile(name: string, data: Uint8Array): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'open-pencil-sfnt-')), name)
  await writeFile(path, data)
  return path
}

test('names a face by its typographic family and subfamily over the legacy ones', async () => {
  const path = await fontFile(
    'acme.ttf',
    namedFont(
      { 1: 'Acme Sans Compressed', 2: 'Regular', 16: 'Acme Sans', 17: 'Compressed Medium' },
      500
    )
  )
  const [face] = await readFontFileFaces(path)
  expect(face).toMatchObject({
    family: 'Acme Sans',
    style: 'Compressed Medium',
    weight: 500,
    italic: false
  })
})

test('names a face by its legacy family and subfamily when it has no typographic ones', async () => {
  const path = await fontFile(
    'acme.otf',
    namedFont({ 1: 'Acme Serif', 2: 'Bold Italic' }, 700, true)
  )
  const [face] = await readFontFileFaces(path)
  expect(face).toMatchObject({
    family: 'Acme Serif',
    style: 'Bold Italic',
    weight: 700,
    italic: true
  })
})

test('lists every face of a collection and loads each as a font of its own', async () => {
  const path = await fontFile(
    'acme.ttc',
    fontCollection([
      namedFont({ 1: 'Acme Sans', 2: 'Regular' }),
      namedFont({ 1: 'Acme Sans', 2: 'Italic' }, 400, true)
    ])
  )
  const faces = await readFontFileFaces(path)
  expect(faces.map(({ style, italic }) => ({ style, italic }))).toEqual([
    { style: 'Regular', italic: false },
    { style: 'Italic', italic: true }
  ])
  const italic = await readFaceData(faces[1])
  expect(fontFaceName(italic)).toEqual({ family: 'Acme Sans', style: 'Italic' })
})

const NAME_RECORD = 12 + 16

function withUint32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice()
  new DataView(copy.buffer).setUint32(offset, value)
  return copy
}

function fontNamed(records: NameRecord[], extraTables: string[] = []): Uint8Array {
  return sfnt([
    { tag: 'OS/2', data: os2Table(400, false) },
    ...extraTables.map((tag) => ({ tag, data: new Uint8Array(16) })),
    { tag: 'name', data: nameRecordTable(records) }
  ])
}

const ACME = namedFont({ 1: 'Acme Sans', 2: 'Regular' })
const ACME_BOLD = namedFont({ 1: 'Acme Sans', 2: 'Bold' }, 700)

test('reads no face from a file cut short of its table directory', async () => {
  const path = await fontFile('broken.ttf', new TextEncoder().encode('not a font at all'))
  await expect(readFontFileFaces(path)).resolves.toEqual([])
})

test('reads lengths from the file only as far as the file goes', async () => {
  const overlapping = ACME.slice()
  const view = new DataView(overlapping.buffer)
  view.setUint32(12 + 8, view.getUint32(NAME_RECORD + 8))
  const cases = {
    'huge-name.ttf': withUint32(ACME, NAME_RECORD + 12, 0xffffffff),
    'far-name.ttf': withUint32(ACME, NAME_RECORD + 8, 0x7ffffff0),
    'huge-count.ttc': withUint32(fontCollection([ACME]), 8, 2 ** 28),
    'overlapping.ttf': overlapping
  }
  const rss = process.memoryUsage().rss
  const faces = await Promise.all(
    Object.entries(cases).map(async ([name, data]) => readFontFileFaces(await fontFile(name, data)))
  )
  expect(process.memoryUsage().rss - rss).toBeLessThan(256 * 2 ** 20)
  expect(faces.map((found) => found.length)).toEqual([0, 0, 0, 1])
})

test('keeps the good faces of a collection with a broken one', async () => {
  const collection = withUint32(fontCollection([ACME, ACME_BOLD]), 16, 0xfffffff0)
  const faces = await readFontFileFaces(await fontFile('half.ttc', collection))
  expect(faces.map(({ style }) => style)).toEqual(['Regular'])
})

const NAME_TABLES: Array<[string, NameRecord[], { family: string; style: string } | null]> = [
  [
    'blank typographic names',
    [
      { ...WINDOWS_ENGLISH, id: 1, text: 'Acme Sans' },
      { ...WINDOWS_ENGLISH, id: 2, text: 'Bold' },
      { ...WINDOWS_ENGLISH, id: 16, text: ' ' },
      { ...WINDOWS_ENGLISH, id: 17, text: ' ' }
    ],
    { family: 'Acme Sans', style: 'Bold' }
  ],
  [
    'trailing space in the family',
    [
      { ...WINDOWS_ENGLISH, id: 1, text: 'Acme Sans ' },
      { ...WINDOWS_ENGLISH, id: 2, text: 'Regular' }
    ],
    { family: 'Acme Sans', style: 'Regular' }
  ],
  [
    'Unicode platform only',
    [
      { ...UNICODE, id: 1, text: 'Acme Sans' },
      { ...UNICODE, id: 2, text: 'Regular' }
    ],
    { family: 'Acme Sans', style: 'Regular' }
  ],
  [
    'blank Windows English family beside a Mac English one',
    [
      { ...WINDOWS_ENGLISH, id: 1, text: '' },
      { ...MAC_ENGLISH, id: 1, text: 'Acme Sans' },
      { ...WINDOWS_ENGLISH, id: 2, text: 'Regular' }
    ],
    { family: 'Acme Sans', style: 'Regular' }
  ],
  [
    'German Windows family beside a Mac English one',
    [
      { ...WINDOWS_GERMAN, id: 1, text: 'Acme Grotesk' },
      { ...MAC_ENGLISH, id: 1, text: 'Acme Sans' },
      { ...WINDOWS_ENGLISH, id: 2, text: 'Regular' }
    ],
    { family: 'Acme Sans', style: 'Regular' }
  ]
]

for (const [label, records, names] of NAME_TABLES) {
  test(`reads names as the desktop does: ${label}`, async () => {
    const [face] = await readFontFileFaces(await fontFile('face.ttf', fontNamed(records)))
    expect(face ? { family: face.family, style: face.style } : null).toEqual(names)
  })
}

test('knows a face by its legacy family as well as its typographic one', async () => {
  const path = await fontFile(
    'acme.ttf',
    namedFont({ 1: 'Acme Sans Compressed', 2: 'Regular', 16: 'Acme Sans', 17: 'Compressed Medium' })
  )
  const [face] = await readFontFileFaces(path)
  expect(face.familyNames).toEqual(['Acme Sans', 'Acme Sans Compressed'])
})

test('marks a face whose outlines are only in hvgl as one the renderer cannot draw', async () => {
  const plain = [
    { ...WINDOWS_ENGLISH, id: 1, text: 'Acme Sans' },
    { ...WINDOWS_ENGLISH, id: 2, text: 'Regular' }
  ]
  const hvglOnly = await readFontFileFaces(await fontFile('a.ttf', fontNamed(plain, ['hvgl'])))
  const withGlyf = await readFontFileFaces(
    await fontFile('b.ttf', fontNamed(plain, ['glyf', 'hvgl']))
  )
  expect(hvglOnly[0].drawable).toBe(false)
  expect(withGlyf[0].drawable).toBe(true)
})

function craftedCollection(faces: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size).fill(0xff)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('ttcf'))
  view.setUint32(4, 0x00010000)
  view.setUint32(8, faces)
  for (let face = 0; face < faces; face++) {
    view.setUint32(12 + face * 4, 12 + faces * 4 + face * 16)
  }
  return bytes
}

test('reads a crafted collection of many faces with many tables in bounded time', async () => {
  const cases = {
    'many-tables.ttc': craftedCollection(3000, 1_060_000),
    'many-faces.ttc': craftedCollection(50_000, 1_000_000)
  }
  for (const [name, data] of Object.entries(cases)) {
    const path = await fontFile(name, data)
    const started = performance.now()
    expect(await readFontFileFaces(path)).toEqual([])
    expect(performance.now() - started).toBeLessThan(1000)
  }
})

test('skips a face whose name table is larger than any real one', async () => {
  const padding = new Uint8Array(1_100_000)
  const font = sfnt([
    { tag: 'OS/2', data: os2Table(400, false) },
    { tag: 'name', data: nameRecordTable([{ ...WINDOWS_ENGLISH, id: 1, text: 'Acme Sans' }]) },
    { tag: 'zzzz', data: padding }
  ])
  const bloated = withUint32(font, NAME_RECORD + 12, (1 << 20) + 1)
  expect(await readFontFileFaces(await fontFile('bloated.ttf', bloated))).toEqual([])
  expect(await readFontFileFaces(await fontFile('plain.ttf', font))).toHaveLength(1)
})
