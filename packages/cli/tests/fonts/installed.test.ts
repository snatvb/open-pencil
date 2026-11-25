import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { namedFont } from '#cli-tests/helpers/fonts'

import { fontFaceName, fontManager, fontTableView, prepareGraphFonts } from '@open-pencil/core/text'
import type { HostFontFamily } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { useInstalledFonts } from '#cli/fonts/install'
import { chooseInstalledFace, InstalledFonts } from '#cli/fonts/installed'
import type { InstalledFace } from '#cli/fonts/sfnt'

function face(
  style: string,
  weight: number,
  overrides: Partial<InstalledFace> = {}
): InstalledFace {
  return {
    path: style,
    directoryOffset: 0,
    family: 'Acme Sans',
    style,
    weight,
    italic: false,
    normalWidth: true,
    weightAxis: null,
    instances: [],
    ...overrides
  }
}

async function fontFolder(fonts: Record<string, Uint8Array>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'open-pencil-installed-'))
  await mkdir(join(folder, 'nested'))
  await Promise.all(
    Object.entries(fonts).map(([name, data]) => writeFile(join(folder, name), data))
  )
  return folder
}

test('picks a face by its own name, compared without case or spaces', () => {
  const faces = [face('Compressed Medium', 500, { normalWidth: false }), face('Medium', 500)]
  expect(chooseInstalledFace(faces, 'compressed medium')?.style).toBe('Compressed Medium')
})

test('picks the normal-width face for a name that only names a weight', () => {
  const faces = [face('Compressed Medium', 500, { normalWidth: false }), face('Book', 500)]
  expect(chooseInstalledFace(faces, 'Medium')?.style).toBe('Book')
})

test('picks a variable face by one of its named instances or by its weight axis', () => {
  const variable = face('Regular', 400, {
    weightAxis: { min: 100, max: 900 },
    instances: [{ name: 'Retina', weight: 450 }]
  })
  expect(chooseInstalledFace([variable], 'Retina')).toBe(variable)
  expect(chooseInstalledFace([variable], 'Black')).toBe(variable)
})

test('substitutes no other face for a name of its own or a weight the family lacks', () => {
  const faces = [face('Regular', 400), face('Bold', 700)]
  expect(chooseInstalledFace(faces, 'Condensed Bold')).toBeUndefined()
  expect(chooseInstalledFace(faces, 'Light')).toBeUndefined()
  expect(chooseInstalledFace(faces, 'Bold Italic')).toBeUndefined()
})

test('takes a weight halfway between two names as the lighter one', () => {
  const book = face('Book', 350)
  expect(chooseInstalledFace([book], 'Regular')).toBeUndefined()
  expect(chooseInstalledFace([book], 'Light')).toBe(book)
})

test('reads nested folders, skips unreadable files, and lists the families it found', async () => {
  const folder = await fontFolder({
    'nested/acme-bold.ttf': namedFont({ 1: 'Acme Sans', 2: 'Bold' }, 700),
    'acme.otf': namedFont({ 1: 'Acme Sans', 2: 'Regular' }),
    'broken.ttf': new TextEncoder().encode('broken'),
    'readme.txt': new TextEncoder().encode('Acme Sans')
  })
  let catalog: HostFontFamily[] = []
  const fonts = new InstalledFonts({
    folders: () => [folder],
    onIndexed: (families) => {
      catalog = families
    }
  })
  const bold = await fonts.load('acme sans', 'Bold')
  expect(bold && fontFaceName(bold)).toEqual({ family: 'Acme Sans', style: 'Bold' })
  expect(catalog).toHaveLength(1)
  expect(catalog[0].family).toBe('Acme Sans')
  expect(catalog[0].faces.map(({ style }) => style).sort()).toEqual(['Bold', 'Regular'])
})

test('searches the folders it is given before later ones', async () => {
  const first = await fontFolder({ 'a.ttf': namedFont({ 1: 'Acme Sans', 2: 'Regular' }, 400) })
  const second = await fontFolder({ 'b.ttf': namedFont({ 1: 'Acme Sans', 2: 'Regular' }, 450) })
  const fonts = new InstalledFonts({ folders: () => [first, second] })
  const data = await fonts.load('Acme Sans', 'Regular')
  expect(data && fontTableView(data, 'OS/2')?.getUint16(4)).toBe(400)
})

test('scans the folders once, on the first face asked for, however many miss', async () => {
  let scans = 0
  const fonts = new InstalledFonts({
    folders: () => {
      scans++
      return []
    }
  })
  expect(scans).toBe(0)
  const loads = await Promise.all(
    ['Regular', 'Bold', 'Italic'].map((style) => fonts.load('Nowhere Sans', style))
  )
  await fonts.load('Nowhere Serif', 'Regular')
  expect(loads).toEqual([null, null, null])
  expect(scans).toBe(1)
})

test('scans nothing for a document without text or for bundled faces', async () => {
  let scans = 0
  useInstalledFonts([], fontManager, () => {
    scans++
    return []
  })
  try {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.createNode('RECTANGLE', pageId, { width: 10, height: 10 })
    await prepareGraphFonts(graph, [pageId])
    await fontManager.loadLocalFont('Inter', 'Regular')
    expect(scans).toBe(0)
  } finally {
    fontManager.setHostFontLoader(null)
  }
})

test('knows which faces the bundled fonts cover', () => {
  expect(fontManager.bundlesFace('Inter', 'Regular')).toBe(true)
  expect(fontManager.bundlesFace('Acme Sans', 'Regular')).toBe(false)
})
