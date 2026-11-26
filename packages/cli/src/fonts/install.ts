import { resolve } from 'node:path'

import { fontManager, type FontManager } from '@open-pencil/core/text'

import { systemFontFolders } from '#cli/fonts/folders'
import { InstalledFonts } from '#cli/fonts/installed'

export const FONT_DIR_FLAG = '--font-dir'
export const NO_SYSTEM_FONTS_FLAG = '--no-system-fonts'
export const NO_SYSTEM_FONTS_ENV = 'OPENPENCIL_NO_SYSTEM_FONTS'

export const fontDirOptions = {
  'font-dir': {
    type: 'string',
    description: 'Folder of installed fonts to search before the system ones; repeat for more'
  },
  'system-fonts': {
    type: 'boolean',
    default: true,
    description: `Search the system font folders; ${NO_SYSTEM_FONTS_ENV}=1 also turns them off`
  }
} as const

export interface FontSources {
  fontDirs: string[]
  systemFonts: boolean
}

export interface FontArgs extends FontSources {
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

export function takeFontArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): FontArgs {
  const fontDirs: string[] = []
  const args: string[] = []
  let systemFonts = env[NO_SYSTEM_FONTS_ENV] !== '1'
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      return { fontDirs, systemFonts, args: args.concat(argv.slice(index)) }
    }
    if (arg === NO_SYSTEM_FONTS_FLAG) {
      systemFonts = false
    } else if (arg === FONT_DIR_FLAG) {
      fontDirs.push(fontDirValue(argv[++index]))
    } else if (arg.startsWith(`${FONT_DIR_FLAG}=`)) {
      fontDirs.push(fontDirValue(arg.slice(FONT_DIR_FLAG.length + 1)))
    } else {
      args.push(arg)
    }
  }
  return { fontDirs, systemFonts, args }
}

let processFonts: InstalledFonts | null = null

function noFolders(): string[] {
  return []
}

export function useInstalledFonts(
  { fontDirs, systemFonts }: FontSources,
  manager: FontManager = fontManager,
  systemFolders: () => readonly string[] = systemFontFolders
): InstalledFonts {
  const searchedSystemFolders = systemFonts ? systemFolders : noFolders
  const installed = new InstalledFonts({
    folders: () => [...fontDirs.map((dir) => resolve(dir)), ...searchedSystemFolders()],
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
