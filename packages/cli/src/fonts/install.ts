import { resolve } from 'node:path'

import { fontManager, type FontManager } from '@open-pencil/core/text'

import { systemFontFolders } from '#cli/fonts/folders'
import { InstalledFonts } from '#cli/fonts/installed'

export const FONT_DIR_FLAG = '--font-dir'

export const fontDirOptions = {
  'font-dir': {
    type: 'string',
    description: 'Folder of installed fonts to search before the system ones; repeat for more'
  }
} as const

export interface FontDirArgs {
  fontDirs: string[]
  args: string[]
}

export class FontDirError extends Error {
  constructor() {
    super(`${FONT_DIR_FLAG} needs a folder, as in ${FONT_DIR_FLAG} ./fonts`)
    this.name = 'FontDirError'
  }
}

function fontDirValue(value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new FontDirError()
  }
  return value
}

export function takeFontDirs(argv: readonly string[]): FontDirArgs {
  const fontDirs: string[] = []
  const args: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      return { fontDirs, args: args.concat(argv.slice(index)) }
    }
    if (arg === FONT_DIR_FLAG) {
      fontDirs.push(fontDirValue(argv[++index]))
    } else if (arg.startsWith(`${FONT_DIR_FLAG}=`)) {
      fontDirs.push(fontDirValue(arg.slice(FONT_DIR_FLAG.length + 1)))
    } else {
      args.push(arg)
    }
  }
  return { fontDirs, args }
}

let processFonts: InstalledFonts | null = null

export function useInstalledFonts(
  fontDirs: readonly string[],
  manager: FontManager = fontManager,
  systemFolders: () => readonly string[] = systemFontFolders
): InstalledFonts {
  const installed = new InstalledFonts({
    folders: () => [...fontDirs.map((dir) => resolve(dir)), ...systemFolders()],
    onIndexed: (families) => manager.setHostFontCatalog(families)
  })
  manager.setHostFontLoader((family, style) => installed.load(family, style))
  if (manager === fontManager) {
    processFonts = installed
  }
  return installed
}

export async function listInstalledFonts(): Promise<void> {
  await processFonts?.families()
}
