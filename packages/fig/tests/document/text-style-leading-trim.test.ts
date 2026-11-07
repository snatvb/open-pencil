import { describe, expect, test } from 'bun:test'

import { figArchiveOf } from '#fig-tests/helpers/fig-fixtures'
import { materializeDocument, materializeFigArchive } from '#fig/document/materialize'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph } from '@open-pencil/scene-graph'

const guid = (localID: number) => ({ sessionID: 1, localID })
const under = (parent: number, position = '!') => ({ guid: guid(parent), position })

const UNTRIMMED_STYLE = { guid: guid(2) }
const TRIMMED_STYLE = { guid: guid(3) }

function textStyle(localID: number, fields: Partial<NodeChange>): NodeChange {
  return {
    guid: guid(localID),
    type: 'TEXT',
    parentIndex: under(1, ' '),
    styleType: 'TEXT',
    fontSize: 14,
    ...fields
  }
}

function text(localID: number, parent: number, fields: Partial<NodeChange>): NodeChange {
  return {
    guid: guid(localID),
    type: 'TEXT',
    parentIndex: under(parent, String.fromCharCode(33 + localID)),
    overrideKey: guid(localID),
    textData: { characters: 'Label' },
    fontName: { family: 'Inter', style: 'Regular', postscript: '' },
    fontSize: 14,
    ...fields
  }
}

function instance(localID: number, position: string, overrides: NodeChange[]): NodeChange {
  return {
    guid: guid(localID),
    type: 'INSTANCE',
    parentIndex: under(1, position),
    symbolData: { symbolID: guid(10), symbolOverrides: overrides }
  } as NodeChange
}

const claim = (target: number, fields: Partial<NodeChange>): NodeChange =>
  ({ guidPath: { guids: [guid(target)] }, ...fields }) as NodeChange

const records: NodeChange[] = [
  { guid: guid(0), type: 'DOCUMENT' },
  { guid: guid(1), type: 'CANVAS', parentIndex: under(0) },
  textStyle(2, {}),
  textStyle(3, { leadingTrim: 'CAP_HEIGHT' }),
  { guid: guid(10), type: 'SYMBOL', parentIndex: under(1, '!') },
  text(11, 10, { leadingTrim: 'CAP_HEIGHT' }),
  text(12, 10, { leadingTrim: 'CAP_HEIGHT', styleIdForText: UNTRIMMED_STYLE }),
  text(13, 10, {}),
  instance(20, '#', [
    claim(11, { styleIdForText: UNTRIMMED_STYLE }),
    claim(13, { styleIdForText: TRIMMED_STYLE })
  ]),
  instance(21, '$', [claim(11, { styleIdForText: UNTRIMMED_STYLE, leadingTrim: 'CAP_HEIGHT' })]),
  instance(22, '%', [claim(12, { leadingTrim: 'CAP_HEIGHT' })])
]

function leadingTrimOf(
  graph: SceneGraph,
  sources: ReadonlyMap<string, string>,
  sourceId: string,
  childIndex?: number
) {
  const id = sources.get(sourceId) ?? ''
  const node = graph.getNode(childIndex === undefined ? id : graph.getChildren(id)[childIndex].id)
  if (node?.type !== 'TEXT') {
    throw new Error(`No text at ${sourceId}`)
  }
  return node.leadingTrim
}

async function readers() {
  return {
    'records read whole': materializeDocument(records),
    'archive read by headers': materializeFigArchive(await figArchiveOf(records))
  }
}

describe('a text that names a text style', async () => {
  for (const [reader, { graph, sources }] of Object.entries(await readers())) {
    test(`draws untrimmed when the style saves no leading trim (${reader})`, () => {
      expect(leadingTrimOf(graph, sources, '1:12')).toBe('NONE')
      expect(leadingTrimOf(graph, sources, '1:20', 0)).toBe('NONE')
    })

    test(`takes the leading trim the style saves (${reader})`, () => {
      expect(leadingTrimOf(graph, sources, '1:20', 2)).toBe('CAP_HEIGHT')
    })

    test(`draws the style's trim over one a claim saves beside the style (${reader})`, () => {
      expect(leadingTrimOf(graph, sources, '1:21', 0)).toBe('NONE')
    })

    test(`draws its inherited style's trim over a claimed one (${reader})`, () => {
      expect(leadingTrimOf(graph, sources, '1:22', 1)).toBe('NONE')
    })
  }
})
