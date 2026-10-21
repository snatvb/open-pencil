import { describe, expect, test } from 'bun:test'

import { nodeChangeToProps, sceneNodeToKiwi } from '#fig/node-change/index'
import { omit } from 'es-toolkit/object'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  runLetterSpacing,
  runLineHeight,
  SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

const PERCENT_TEXT: NodeChange = {
  type: 'TEXT',
  fontSize: 20,
  letterSpacing: { value: 25, units: 'PERCENT' },
  lineHeight: { value: 1.5, units: 'RAW' },
  textData: {
    characters: 'Acme',
    characterStyleIDs: [1, 1],
    styleOverrideTable: [{ styleID: 1, fontSize: 40 }]
  }
}

function exported(node: SceneNode, graph: SceneGraph): NodeChange {
  return sceneNodeToKiwi(node, { sessionID: 1, localID: 1 }, 0, { value: 2 }, graph, [])[0]
}

function imported(change: NodeChange) {
  const graph = new SceneGraph()
  const props = omit(nodeChangeToProps(change, []), ['nodeType'])
  return { graph, node: graph.createNode('TEXT', graph.getPages()[0].id, props) }
}

describe('.fig text lengths in percent of the font size', () => {
  test('import as their percent, which a run with its own font size inherits', () => {
    const props = nodeChangeToProps(PERCENT_TEXT, [])

    expect(props).toMatchObject({
      letterSpacing: 5,
      letterSpacingPercent: 25,
      lineHeight: 30,
      lineHeightPercent: 150
    })
    const style = props.styleRuns?.[0]?.style
    expect(style).toEqual({ fontSize: 40 })
    expect(runLetterSpacing(style, { letterSpacing: 5, letterSpacingPercent: 25 })).toBe(10)
    expect(runLineHeight(style, { lineHeight: 30, lineHeightPercent: 150 })).toBe(60)
  })

  test('import pixels as pixels', () => {
    const props = nodeChangeToProps(
      {
        type: 'TEXT',
        fontSize: 20,
        letterSpacing: { value: 3, units: 'PIXELS' },
        lineHeight: { value: 24, units: 'PIXELS' }
      },
      []
    )

    expect(props).toMatchObject({
      letterSpacing: 3,
      letterSpacingPercent: null,
      lineHeight: 24,
      lineHeightPercent: null
    })
  })

  test('export in percent after the font size changes, and read back at the new size', () => {
    const { graph, node } = imported(PERCENT_TEXT)
    graph.updateNode(node.id, { fontSize: 10 })

    const change = exported(node, graph)
    expect(change.letterSpacing).toEqual({ value: 25, units: 'PERCENT' })
    expect(change.lineHeight).toEqual({ value: 1.5, units: 'RAW' })
    const [override] = change.textData?.styleOverrideTable ?? []
    expect(override).toMatchObject({ fontSize: 40 })
    expect(override).not.toHaveProperty('letterSpacing')
    expect(override).not.toHaveProperty('lineHeight')
    expect(nodeChangeToProps(change, [])).toMatchObject({
      letterSpacing: 2.5,
      letterSpacingPercent: 25,
      lineHeight: 15,
      lineHeightPercent: 150
    })
  })

  test('export a line height in the percent unit the file wrote it in', () => {
    const percent = imported({ ...PERCENT_TEXT, lineHeight: { value: 150, units: 'PERCENT' } })
    const raw = imported(PERCENT_TEXT)
    for (const { graph, node } of [percent, raw]) {
      graph.updateNode(node.id, { lineHeightPercent: 200 })
    }

    expect(exported(percent.node, percent.graph).lineHeight).toEqual({
      value: 200,
      units: 'PERCENT'
    })
    expect(exported(raw.node, raw.graph).lineHeight).toEqual({ value: 2, units: 'RAW' })
  })

  test('export 100 percent as RAW, which PERCENT would read back as automatic', () => {
    const { graph, node } = imported({
      ...PERCENT_TEXT,
      lineHeight: { value: 150, units: 'PERCENT' }
    })
    graph.updateNode(node.id, { lineHeightPercent: 100 })

    const change = exported(node, graph)

    expect(change.lineHeight).toEqual({ value: 1, units: 'RAW' })
    expect(nodeChangeToProps(change, [])).toMatchObject({
      lineHeight: 20,
      lineHeightPercent: 100
    })
  })

  test('export pixels as pixels', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', graph.getPages()[0].id, {
      fontSize: 20,
      letterSpacing: 3,
      lineHeight: 24
    })

    const change = exported(node, graph)

    expect(change.letterSpacing).toEqual({ value: 3, units: 'PIXELS' })
    expect(change.lineHeight).toEqual({ value: 24, units: 'PIXELS' })
  })
})
