#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

import { takeFontDirs, useInstalledFonts } from '#cli/fonts/install'

import { COMMANDS } from './commands'

const { version } = await import('../package.json')

const main = defineCommand({
  meta: {
    name: 'openpencil',
    description:
      'OpenPencil CLI — inspect, export, and lint design documents, and drive the running app',
    version
  },
  args: {
    'font-dir': {
      type: 'string',
      description:
        'Folder of installed fonts to search before the system ones; repeat for more folders'
    }
  },
  subCommands: COMMANDS
})

const { fontDirs, args } = takeFontDirs(process.argv.slice(2))
useInstalledFonts(fontDirs)
void runMain(main, { rawArgs: args })
