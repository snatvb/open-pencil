import { describe, expect, test } from 'bun:test'

import {
  createDefaultSourceMetadata,
  reconcileVariableBindings,
  runLetterSpacing,
  runLineHeight,
  SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

type Spacing = Pick<SceneNode, 'letterSpacing' | 'letterSpacingPercent'>

function styledText(spacing: Spacing) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const collection = graph.createCollection('Scale')
  const size = graph.createVariable('Size', 'FLOAT', collection.id, 20)
  const style = graph.createNodeWithId('style:body', 'TEXT', page, {
    name: 'Body',
    sharedStyleType: 'TEXT',
    internalOnly: true,
    fontSize: 20,
    lineHeight: 24,
    ...spacing,
    boundVariables: { fontSize: size.id },
    source: { ...createDefaultSourceMetadata(), id: 'style:body' }
  })
  const text = graph.createNode('TEXT', page, {
    text: 'Hello world',
    fontSize: 20,
    lineHeight: 24,
    ...spacing,
    textStyleId: 'style:body',
    styleRuns: [{ start: 6, length: 5, style: { fontSize: 40 } }]
  })
  reconcileVariableBindings(graph, { subtrees: [text.id] })
  return { graph, style, text }
}

function restyle(graph: SceneGraph, style: SceneNode, changes: Partial<SceneNode>) {
  graph.updateNode(style.id, changes)
  reconcileVariableBindings(graph, { subtrees: [style.id] })
}

function spacingOf(text: SceneNode) {
  return {
    letterSpacing: text.letterSpacing,
    letterSpacingPercent: text.letterSpacingPercent,
    run: runLetterSpacing(text.styleRuns[0].style, text)
  }
}

const PERCENT: Spacing = { letterSpacing: 2, letterSpacingPercent: 10 }
const PIXELS: Spacing = { letterSpacing: 2, letterSpacingPercent: null }

describe('text style lengths in percent of the font size', () => {
  test.each([
    {
      name: 'a percent style set in pixels',
      before: PERCENT,
      edit: { letterSpacing: 5, letterSpacingPercent: null },
      after: { letterSpacing: 5, letterSpacingPercent: null, run: 5 },
      resized: 5
    },
    {
      name: 'a pixel style set in percent',
      before: PIXELS,
      edit: { letterSpacingPercent: 20 },
      after: { letterSpacing: 4, letterSpacingPercent: 20, run: 8 },
      resized: 6
    },
    {
      name: 'a percent style set to another percent',
      before: PERCENT,
      edit: { letterSpacingPercent: 25 },
      after: { letterSpacing: 5, letterSpacingPercent: 25, run: 10 },
      resized: 7.5
    }
  ])('$name reaches the texts using it in its unit', ({ before, edit, after, resized }) => {
    const { graph, style, text } = styledText(before)

    restyle(graph, style, edit)
    expect(spacingOf(text)).toEqual(after)

    graph.updateNode(text.id, { fontSize: 30 })
    expect(text.letterSpacing).toBe(resized)
  })

  test('characters without their own spacing keep reading it from the text', () => {
    const { graph, style, text } = styledText(PIXELS)

    restyle(graph, style, { letterSpacingPercent: 20 })

    expect(text.styleRuns[0].style).toEqual({ fontSize: 40 })
  })

  test('a line height a style sets in percent reaches the texts using it', () => {
    const { graph, style, text } = styledText(PIXELS)

    restyle(graph, style, { lineHeightPercent: 150 })

    expect([text.lineHeight, text.lineHeightPercent]).toEqual([30, 150])
    expect(runLineHeight(text.styleRuns[0].style, text)).toBe(60)
  })

  test('restoring a style brings back both units on the texts using it', () => {
    const { graph, style, text } = styledText(PERCENT)

    restyle(graph, style, { letterSpacing: 5, letterSpacingPercent: null })
    restyle(graph, style, PERCENT)

    expect(spacingOf(text)).toEqual({ letterSpacing: 2, letterSpacingPercent: 10, run: 4 })
  })
})
