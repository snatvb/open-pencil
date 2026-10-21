import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { buildFigmaClipboardHTML, parseFigmaClipboard } from '@open-pencil/core'
import { initCodec } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

beforeAll(async () => {
  await initCodec()
})

test('copies a line height in percent of the font size as a multiplier, as Figma writes it', async () => {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    name: 'Caption',
    text: 'Acme',
    fontFamily: 'Acme Sans',
    fontSize: 20,
    lineHeight: 30,
    lineHeightPercent: 150,
    letterSpacing: 2,
    letterSpacingPercent: 10
  })

  const { nodes } = expectDefined(
    await parseFigmaClipboard(expectDefined(await buildFigmaClipboardHTML([node], graph)))
  )
  const record = expectDefined(nodes.find((change) => change.name === 'Caption'))

  expect(record.lineHeight).toEqual({ value: 1.5, units: 'RAW' })
  expect(record.letterSpacing).toEqual({ value: 10, units: 'PERCENT' })
})
