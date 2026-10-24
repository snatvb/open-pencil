import { describe, expect, test } from 'bun:test'

import { characterStyles, styleRunsWithPatch } from '#core/text/character-style'

import { SceneGraph, type StyleRun } from '@open-pencil/scene-graph'

function spacedText(spacing: { letterSpacing: number; letterSpacingPercent: number | null }) {
  const graph = new SceneGraph()
  return graph.createNode('TEXT', graph.getPages()[0].id, {
    text: 'Acme Sans',
    fontFamily: 'Acme Sans',
    fontSize: 20,
    ...spacing
  })
}

function sizedRun(fontSize: number): StyleRun {
  return { start: 0, length: 4, style: { fontSize } }
}

describe('character styles of text lengths in percent of the font size', () => {
  test('a range with its own font size reads the text percent at that size', () => {
    const node = spacedText({ letterSpacing: 5, letterSpacingPercent: 25 })
    node.styleRuns = [sizedRun(40)]

    const [sized, plain] = [...characterStyles(node, 0, 1), ...characterStyles(node, 5, 6)]

    expect(sized).toMatchObject({ letterSpacing: 10, letterSpacingPercent: 25 })
    expect(plain).toMatchObject({ letterSpacing: 5, letterSpacingPercent: 25 })
  })

  test('a range given pixels equal to the text pixels keeps them over the text percent', () => {
    const node = spacedText({ letterSpacing: 5, letterSpacingPercent: 25 })

    const [run] = styleRunsWithPatch(node, 0, 4, { fontSize: 40, letterSpacing: 5 })

    expect(run.style).toEqual({ fontSize: 40, letterSpacing: 5, letterSpacingPercent: null })
  })

  test('a range given a percent over a text in pixels keeps its pixels with it', () => {
    const node = spacedText({ letterSpacing: 5, letterSpacingPercent: null })

    const [run] = styleRunsWithPatch(node, 0, 4, (fontSize) => ({
      letterSpacing: fontSize / 4,
      letterSpacingPercent: 25
    }))

    expect(run.style).toEqual({ letterSpacing: 5, letterSpacingPercent: 25 })
  })
})
