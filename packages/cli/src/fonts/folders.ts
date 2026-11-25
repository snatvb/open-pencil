import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

import { compact } from 'es-toolkit/array'

export interface FontFolderHost {
  platform: NodeJS.Platform
  home: string
  env: Readonly<Record<string, string | undefined>>
}

const CURRENT_HOST: FontFolderHost = {
  platform: process.platform,
  home: homedir(),
  env: process.env
}

function windowsFolders({ env }: FontFolderHost): string[] {
  const windows = env.WINDIR ?? env.SystemRoot
  return compact([
    windows && win32.join(windows, 'Fonts'),
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')
  ])
}

function macFolders({ home }: FontFolderHost): string[] {
  return ['/Library/Fonts', posix.join(home, 'Library', 'Fonts'), '/System/Library/Fonts']
}

function unixFolders({ home }: FontFolderHost): string[] {
  return [
    posix.join(home, '.local', 'share', 'fonts'),
    posix.join(home, '.fonts'),
    '/usr/share/fonts',
    '/usr/local/share/fonts'
  ]
}

export function systemFontFolders(host: FontFolderHost = CURRENT_HOST): string[] {
  if (host.platform === 'win32') {
    return windowsFolders(host)
  }
  if (host.platform === 'darwin') {
    return macFolders(host)
  }
  return unixFolders(host)
}
