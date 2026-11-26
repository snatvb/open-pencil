import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renamedFont } from '#cli-tests/helpers/fonts'
import { requireBuiltWorkspacePackages } from '#cli-tests/helpers/paths'
import { runCLI } from '#cli-tests/helpers/run'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import type { DocumentFontStatus } from '@open-pencil/core/text'
import { FIXTURES } from '@open-pencil/test-support/paths'
import { firstPageId, makeSceneGraph } from '@open-pencil/test-support/scene'

import { systemFontFolders } from '#cli/fonts/folders'
import { FontDirError, takeFontDirs } from '#cli/fonts/install'

requireBuiltWorkspacePackages()
setDefaultTimeout(60_000)

const FAMILY = 'Acme Sans'
const io = new IORegistry(BUILTIN_IO_FORMATS)

async function fixtures(): Promise<{ document: string; fontDir: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'open-pencil-cli-installed-'))
  const fontDir = join(directory, 'fonts')
  const inter = new Uint8Array(await readFile(join(FIXTURES, 'fonts', 'InterRegular-Faces.ttf')))
  await Bun.write(join(fontDir, 'acme.ttf'), renamedFont(inter, { 1: FAMILY, 2: 'Regular' }))
  const graph = makeSceneGraph('Fonts')
  graph.createNode('TEXT', firstPageId(graph), {
    text: 'Hello',
    fontFamily: FAMILY,
    fontWeight: 400
  })
  const document = join(directory, 'acme.fig')
  await writeFile(document, (await io.writeDocument('fig', graph)).data as Uint8Array)
  return { document, fontDir }
}

test('takes every --font-dir out of the arguments a command parses', () => {
  expect(
    takeFontDirs(['export', '--font-dir', 'a', 'file.fig', '--font-dir=b', '--', '--font-dir', 'c'])
  ).toEqual({ fontDirs: ['a', 'b'], args: ['export', 'file.fig', '--', '--font-dir', 'c'] })
})

test('refuses a --font-dir without a folder', () => {
  for (const argv of [['--font-dir='], ['export', '--font-dir'], ['--font-dir', '--json']]) {
    expect(() => takeFontDirs(argv)).toThrow(FontDirError)
  }
})

test('stops with a message when --font-dir has no folder', async () => {
  const { stderr, exitCode } = await runCLI(['formats', '--font-dir='])
  expect(exitCode).toBe(1)
  expect(stderr).toContain('--font-dir needs a folder')
})

test('lists --font-dir in the help of commands that draw text', async () => {
  for (const command of ['export', 'fonts', 'eval', 'convert']) {
    const { stdout } = await runCLI([command, '--help'])
    expect(stdout).toContain('--font-dir')
  }
})

test('looks for installed fonts in each platform’s font folders', () => {
  const env = { WINDIR: 'X:\\Win', LOCALAPPDATA: 'X:\\Data' }
  expect(systemFontFolders({ platform: 'win32', home: 'X:\\Home', env })).toEqual([
    'X:\\Win\\Fonts',
    'X:\\Data\\Microsoft\\Windows\\Fonts'
  ])
  expect(systemFontFolders({ platform: 'darwin', home: '/home/me', env: {} })).toEqual([
    '/Library/Fonts',
    '/home/me/Library/Fonts',
    '/System/Library/Fonts'
  ])
  expect(systemFontFolders({ platform: 'linux', home: '/home/me', env: {} })).toEqual([
    '/home/me/.local/share/fonts',
    '/home/me/.fonts',
    '/usr/share/fonts',
    '/usr/local/share/fonts'
  ])
})

test('reports a font in a --font-dir folder as loaded, and as missing without it', async () => {
  const { document, fontDir } = await fixtures()
  const found = await runCLI(['fonts', document, '--json', '--font-dir', fontDir])
  expect(found.exitCode).toBe(0)
  const status: DocumentFontStatus = JSON.parse(found.stdout)
  expect(status.faithful).toBe(true)
  expect(status.faces).toMatchObject([{ family: FAMILY, status: 'available', source: 'local' }])

  const missing = await runCLI(['fonts', document, '--json'])
  const missingStatus: DocumentFontStatus = JSON.parse(missing.stdout)
  expect(missingStatus.faithful).toBe(false)
})

test('exports without substitution when the font is in a --font-dir folder', async () => {
  const { document, fontDir } = await fixtures()
  const output = join(fontDir, '..', 'out.png')
  const found = await runCLI(['export', document, '-o', output, '--font-dir', fontDir])
  expect(found.exitCode).toBe(0)
  expect(found.stderr).not.toContain('Font substitution')

  const missing = await runCLI(['export', document, '-o', output])
  expect(missing.stderr).toContain(`Font substitution: ${FAMILY}`)
})
