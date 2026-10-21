import { describe, expect, test } from 'bun:test'

import {
  authoredFontName,
  parseFontStyle,
  runFontName,
  SceneGraph,
  type SceneNode,
  weightToStyle
} from '@open-pencil/scene-graph'

const COMPRESSED_MEDIUM = {
  family: 'Acme Sans',
  style: 'Compressed Medium',
  postScriptName: 'AcmeSans-CompressedMedium'
}

describe('parseFontStyle', () => {
  test('takes the weight from what a width name leaves', () => {
    expect(parseFontStyle('Compressed Medium')).toEqual({ weight: 500, italic: false, width: 2 })
    expect(parseFontStyle('Condensed Bold Italic')).toEqual({ weight: 700, italic: true, width: 3 })
    expect(parseFontStyle('Extra Condensed Light')).toEqual({
      weight: 300,
      italic: false,
      width: 2
    })
    expect(parseFontStyle('SemiBold SemiCondensed')).toEqual({
      weight: 600,
      italic: false,
      width: 4
    })
    expect(parseFontStyle('Expanded')).toEqual({ weight: 400, italic: false, width: 7 })
  })

  test('reads plain weight names at the normal width', () => {
    expect(parseFontStyle('Regular')).toEqual({ weight: 400, italic: false, width: 5 })
    expect(parseFontStyle('Book')).toEqual({ weight: 400, italic: false, width: 5 })
    expect(parseFontStyle('Semi Bold Italic')).toEqual({ weight: 600, italic: true, width: 5 })
    expect(parseFontStyle(undefined)).toEqual({ weight: 400, italic: false, width: 5 })
  })
})

describe('authoredFontName', () => {
  test('holds while the family, weight, and slant are the ones it names', () => {
    expect(authoredFontName(COMPRESSED_MEDIUM, 'Acme Sans', 500, false)).toBe(COMPRESSED_MEDIUM)
  })

  test('lapses once the family, weight, or slant changes', () => {
    expect(authoredFontName(COMPRESSED_MEDIUM, 'Acme Serif', 500, false)).toBeNull()
    expect(authoredFontName(COMPRESSED_MEDIUM, 'Acme Sans', 700, false)).toBeNull()
    expect(authoredFontName(COMPRESSED_MEDIUM, 'Acme Sans', 500, true)).toBeNull()
    expect(authoredFontName(null, 'Acme Sans', 500, false)).toBeNull()
  })
})

describe('runFontName', () => {
  test('a run without its own font name takes the text one', () => {
    const text = { fontName: COMPRESSED_MEDIUM }
    expect(runFontName(text, {})).toBe(COMPRESSED_MEDIUM)
    expect(runFontName(text, { fontName: null })).toBeNull()
  })
})

describe('a change of face', () => {
  function compressedMediumText(overrides: Partial<SceneNode> = {}) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      text: 'ab',
      fontFamily: 'Acme Sans',
      fontWeight: 500,
      fontName: COMPRESSED_MEDIUM,
      ...overrides
    })
    const faceStyle = () => {
      const node = graph.getNode(text.id)
      if (!node) {
        return ''
      }
      const { fontName, fontFamily, fontWeight, italic } = node
      return (
        authoredFontName(fontName, fontFamily, fontWeight, italic)?.style ??
        weightToStyle(fontWeight, italic)
      )
    }
    return { graph, id: text.id, faceStyle }
  }

  test('does not bring the authored style back with the weight it named', () => {
    const { graph, id, faceStyle } = compressedMediumText()
    graph.updateNode(id, { fontWeight: 700 })
    graph.updateNode(id, { fontWeight: 500 })
    expect(graph.getNode(id)?.fontName).toBeNull()
    expect(faceStyle()).toBe('Medium')
  })

  test('does not bring the authored style back with the family it named', () => {
    const { graph, id, faceStyle } = compressedMediumText()
    graph.updateNode(id, { fontFamily: 'Acme Serif' })
    graph.updateNode(id, { fontFamily: 'Acme Sans' })
    expect(graph.getNode(id)?.fontName).toBeNull()
    expect(faceStyle()).toBe('Medium')
  })

  test('keeps a font name it names, and one a same value leaves standing', () => {
    const { graph, id } = compressedMediumText()
    graph.updateNode(id, { fontWeight: 500, italic: false })
    expect(graph.getNode(id)?.fontName).toBe(COMPRESSED_MEDIUM)
    const bold = { ...COMPRESSED_MEDIUM, style: 'Compressed Bold' }
    graph.updateNode(id, { fontWeight: 700, fontName: bold })
    expect(graph.getNode(id)?.fontName).toBe(bold)
  })

  test('clears the font name of runs that take the changed field from the text', () => {
    const { graph, id } = compressedMediumText({
      fontName: null,
      styleRuns: [
        { start: 0, length: 1, style: { fontName: COMPRESSED_MEDIUM } },
        { start: 1, length: 1, style: { fontWeight: 500, fontName: COMPRESSED_MEDIUM } }
      ]
    })
    graph.updateNode(id, { fontWeight: 700 })
    expect(graph.getNode(id)?.styleRuns).toEqual([
      { start: 1, length: 1, style: { fontWeight: 500, fontName: COMPRESSED_MEDIUM } }
    ])
  })

  test('clears the font name of runs taking the changed field when it names its own', () => {
    const { graph, id } = compressedMediumText({
      styleRuns: [
        { start: 0, length: 1, style: { fontName: COMPRESSED_MEDIUM } },
        { start: 1, length: 1, style: { fontWeight: 500, fontName: COMPRESSED_MEDIUM } }
      ]
    })
    const bold = { ...COMPRESSED_MEDIUM, style: 'Compressed Bold' }
    graph.updateNode(id, { fontWeight: 700, fontName: bold })
    expect(graph.getNode(id)?.fontName).toBe(bold)
    expect(graph.getNode(id)?.styleRuns).toEqual([
      { start: 1, length: 1, style: { fontWeight: 500, fontName: COMPRESSED_MEDIUM } }
    ])
  })
})
