#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

import { fontDirOptions, takeFontArgs, useInstalledFonts } from '#cli/fonts/install'
import { printError } from '#cli/format'

import { COMMANDS } from './commands'

const { version } = await import('../package.json')

const main = defineCommand({
  meta: {
    name: 'openpencil',
    description:
      'OpenPencil CLI — inspect, export, and lint design documents, and drive the running app',
    version
  },
  args: fontDirOptions,
  subCommands: COMMANDS
})

function cliArgs(): string[] | null {
  try {
    const { args, ...sources } = takeFontArgs(process.argv.slice(2))
    useInstalledFonts(sources)
    return args
  } catch (error) {
    printError(error)
    return null
  }
}

const rawArgs = cliArgs()
if (rawArgs) {
  void runMain(main, { rawArgs })
} else {
  process.exitCode = 1
}
