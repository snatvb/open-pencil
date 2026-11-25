import { resolve } from 'node:path'

import { fontManager, type FontManager } from '@open-pencil/core/text'

import { systemFontFolders } from '#cli/fonts/folders'
import { InstalledFonts } from '#cli/fonts/installed'

export const FONT_DIR_FLAG = '--font-dir'

export interface FontDirArgs {
  fontDirs: string[]
  args: string[]
}

export function takeFontDirs(argv: readonly string[]): FontDirArgs {
  const fontDirs: string[] = []
  const args: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      return { fontDirs, args: args.concat(argv.slice(index)) }
    }
    if (arg === FONT_DIR_FLAG && index + 1 < argv.length) {
      fontDirs.push(argv[++index])
    } else if (arg.startsWith(`${FONT_DIR_FLAG}=`)) {
      fontDirs.push(arg.slice(FONT_DIR_FLAG.length + 1))
    } else {
      args.push(arg)
    }
  }
  return { fontDirs, args }
}

export function useInstalledFonts(
  fontDirs: readonly string[],
  manager: FontManager = fontManager,
  systemFolders: () => readonly string[] = systemFontFolders
): InstalledFonts {
  const installed = new InstalledFonts({
    folders: () => [...fontDirs.map((dir) => resolve(dir)), ...systemFolders()],
    onIndexed: (families) => manager.setHostFontCatalog(families)
  })
  manager.setHostFontLoader(async (family, style) =>
    manager.bundlesFace(family, style) ? null : installed.load(family, style)
  )
  return installed
}
