import { expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fontCollection, namedFont } from '#cli-tests/helpers/fonts'

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

test('fails to read a file cut short of its table directory', async () => {
  const path = await fontFile('broken.ttf', new TextEncoder().encode('not a font at all'))
  await expect(readFontFileFaces(path)).rejects.toThrow(RangeError)
})
