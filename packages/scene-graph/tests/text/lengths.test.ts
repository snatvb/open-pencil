import { describe, expect, test } from 'bun:test'

import {
  reconcileVariableBindings,
  recordInstanceOverride,
  runLetterSpacing,
  runLineHeight,
  SceneGraph,
  type StyleRun
} from '@open-pencil/scene-graph'

import { expectDefined } from '../helpers/assert'

function addPercentText(graph: SceneGraph, styleRuns: StyleRun[] = []) {
  return graph.createNode('TEXT', graph.getPages()[0].id, {
    text: 'Acme Sans',
    fontSize: 20,
    letterSpacing: 5,
    letterSpacingPercent: 25,
    lineHeight: 30,
    lineHeightPercent: 150,
    styleRuns
  })
}

function percentText(styleRuns: StyleRun[] = []) {
  const graph = new SceneGraph()
  return { graph, node: addPercentText(graph, styleRuns) }
}

describe('text lengths in percent of the font size', () => {
  test('follow a new font size', () => {
    const { graph, node } = percentText()

    graph.updateNode(node.id, { fontSize: 40 })

    expect(node).toMatchObject({
      letterSpacing: 10,
      letterSpacingPercent: 25,
      lineHeight: 60,
      lineHeightPercent: 150
    })
  })

  test('stay in pixels when the text has no percent', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', graph.getPages()[0].id, {
      fontSize: 20,
      letterSpacing: 2,
      lineHeight: 30
    })

    graph.updateNode(node.id, { fontSize: 40 })

    expect(node).toMatchObject({ letterSpacing: 2, lineHeight: 30, letterSpacingPercent: null })
  })

  test('keep their unit when a length is written alone', () => {
    const { graph, node } = percentText()

    graph.updateNode(node.id, { letterSpacing: 10 })
    graph.updateNode(node.id, { fontSize: 10 })

    expect(node).toMatchObject({ letterSpacingPercent: 50, letterSpacing: 5 })
  })

  test('switch to pixels when the percent is cleared', () => {
    const { graph, node } = percentText()

    graph.updateNode(node.id, { letterSpacingPercent: null, lineHeight: null })
    graph.updateNode(node.id, { fontSize: 40 })

    expect(node).toMatchObject({
      letterSpacing: 5,
      letterSpacingPercent: null,
      lineHeight: null,
      lineHeightPercent: null
    })
  })

  test('resolve at the font size of each run, which inherits the text percent', () => {
    const { graph, node } = percentText([
      { start: 0, length: 4, style: { fontSize: 30 } },
      { start: 5, length: 4, style: { letterSpacingPercent: 50, letterSpacing: 10 } }
    ])

    graph.updateNode(node.id, { fontSize: 40 })

    const [sized, spaced] = node.styleRuns.map((run) => run.style)
    expect(sized).toEqual({ fontSize: 30 })
    expect(runLetterSpacing(sized, node)).toBe(7.5)
    expect(runLineHeight(sized, node)).toBe(45)
    expect(spaced).toEqual({ letterSpacingPercent: 50, letterSpacing: 20 })
  })

  test('leave a run with its own font size inheriting after the text percent changes', () => {
    const { graph, node } = percentText([{ start: 0, length: 4, style: { fontSize: 30 } }])

    graph.updateNode(node.id, { fontSize: 40 })
    graph.updateNode(node.id, { letterSpacingPercent: 10, lineHeightPercent: 200 })

    const [sized] = node.styleRuns.map((run) => run.style)
    expect(sized).toEqual({ fontSize: 30 })
    expect(runLetterSpacing(sized, node)).toBe(3)
    expect(runLineHeight(sized, node)).toBe(60)
  })

  test('resolve at the font size an instance overrides when its component changes them', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id)
    const source = graph.createNode('TEXT', component.id, {
      fontSize: 20,
      letterSpacing: 5,
      letterSpacingPercent: 25
    })
    const instance = expectDefined(graph.createInstance(component.id, graph.getPages()[0].id))
    const copy = graph.getChildren(instance.id)[0]
    graph.updateNode(copy.id, { fontSize: 40 })
    recordInstanceOverride(graph, copy.id, ['fontSize'])

    graph.updateNode(source.id, { letterSpacingPercent: 50 })
    graph.syncInstances(component.id)

    expect(copy).toMatchObject({ fontSize: 40, letterSpacing: 20, letterSpacingPercent: 50 })
  })

  test('keep the length an instance overrides, with its unit, when its component syncs', () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id)
    const source = graph.createNode('TEXT', component.id, {
      fontSize: 20,
      letterSpacing: 5,
      letterSpacingPercent: 25,
      lineHeight: 30,
      lineHeightPercent: 150
    })
    const instance = expectDefined(graph.createInstance(component.id, graph.getPages()[0].id))
    const copy = graph.getChildren(instance.id)[0]
    graph.updateNode(copy.id, { lineHeight: null, letterSpacing: 2 })
    recordInstanceOverride(graph, copy.id, ['lineHeight', 'letterSpacing'])

    graph.updateNode(source.id, { opacity: 0.5 })
    graph.syncInstances(component.id)

    expect(copy).toMatchObject({
      lineHeight: null,
      lineHeightPercent: null,
      letterSpacing: 2,
      letterSpacingPercent: 10
    })
  })

  test('follow a bound font size into another mode, for the text and for its runs', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Type')
    const size = graph.createVariable('Body', 'FLOAT', collection.id, 20)
    const large = expectDefined(graph.createMode(collection.id, 'Large'))
    size.valuesByMode[large] = 32
    const node = addPercentText(graph)
    graph.bindVariable(node.id, 'fontSize', size.id)
    const ranged = addPercentText(graph, [
      { start: 0, length: 4, style: { fontSize: 20, boundVariables: { fontSize: size.id } } }
    ])

    graph.setActiveMode(collection.id, large)
    reconcileVariableBindings(graph)

    expect(node).toMatchObject({ fontSize: 32, letterSpacing: 8, lineHeight: 48 })
    const [sized] = ranged.styleRuns.map((run) => run.style)
    expect(sized).not.toHaveProperty('letterSpacing')
    expect(runLetterSpacing(sized, ranged)).toBe(8)
    expect(runLineHeight(sized, ranged)).toBe(48)
  })

  test('switch to pixels on a text whose length a variable binds', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Type')
    const tracking = graph.createVariable('Tracking', 'FLOAT', collection.id, 3)
    const node = addPercentText(graph)
    graph.bindVariable(node.id, 'letterSpacing', tracking.id)

    reconcileVariableBindings(graph)
    graph.updateNode(node.id, { fontSize: 40 })
    reconcileVariableBindings(graph)

    expect(node).toMatchObject({ letterSpacing: 3, letterSpacingPercent: null, lineHeight: 60 })
  })

  test('switch to pixels on a run whose length a variable binds', () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Type')
    const leading = graph.createVariable('Leading', 'FLOAT', collection.id, 18)
    const node = addPercentText(graph, [
      {
        start: 0,
        length: 4,
        style: {
          lineHeight: 30,
          lineHeightPercent: 150,
          boundVariables: { lineHeight: leading.id }
        }
      }
    ])

    reconcileVariableBindings(graph)
    graph.updateNode(node.id, { fontSize: 40 })

    expect(node.styleRuns[0].style).toMatchObject({ lineHeight: 18, lineHeightPercent: null })
  })
})
