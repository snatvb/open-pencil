import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import {
  archiveWithSavedLayout,
  HUG_ROW,
  openLaidOut,
  rowComponent,
  ROW_SAVED_WITH_WIDER_LEAD
} from '#core-tests/helpers/fig/saved-instance-layout'

import { FigmaAPI } from '@open-pencil/core'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'
import { computeAllLayouts } from '#core/layout'
import { withTextMeasurer } from '#core/layout/text-measurement'

setDefaultTimeout(30_000)

function instanceNamed(graph: SceneGraph, name: string): SceneNode {
  const instance = [...graph.getAllNodes()].find(
    (node) => node.type === 'INSTANCE' && node.name === name
  )
  if (!instance) {
    throw new Error(`Missing instance ${name}`)
  }
  return instance
}

function rowShape(graph: SceneGraph, row: SceneNode) {
  const [lead, tail] = graph.getChildren(row.id)
  return { width: row.width, lead: lead.width, tail: tail.x }
}

async function openSavedRow() {
  const source = new SceneGraph()
  const page = source.getPages()[0]
  const row = rowComponent(source, page.id, 'Row', 20)
  rowComponent(source, page.id, 'Wide row', 24)
  source.createInstance(row.id, page.id, { name: 'Placed', y: 100 })
  const graph = await openLaidOut(
    await archiveWithSavedLayout(source, { Placed: ROW_SAVED_WITH_WIDER_LEAD })
  )
  const placed = instanceNamed(graph, 'Placed')
  return { graph, placed, api: new FigmaAPI(graph) }
}

function labelSource() {
  const source = new SceneGraph()
  const page = source.getPages()[0]
  const label = source.createNode('COMPONENT', page.id, {
    ...HUG_ROW,
    name: 'Label',
    width: 100,
    height: 40
  })
  const caption = source.createNode('TEXT', label.id, {
    name: 'Caption',
    text: 'Hello',
    fontSize: 14,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 10,
    y: 10,
    width: 40,
    height: 20
  })
  source.createNode('FRAME', label.id, { name: 'Tail', x: 60, y: 10, width: 20, height: 20 })
  source.createInstance(label.id, page.id, { name: 'Placed label', y: 100 })
  return { source, caption }
}

function archiveWithSavedLabel(source: SceneGraph): Promise<Uint8Array> {
  return archiveWithSavedLayout(source, {
    'Placed label': { width: 110, layers: { Caption: { width: 60 }, Tail: { x: 80 } } }
  })
}

describe('an instance opened from a .fig file keeps the layout Figma saved for it', () => {
  test('until something changes it, laying it out again included', async () => {
    const { graph, placed } = await openSavedRow()
    expect(rowShape(graph, placed)).toEqual({ width: 80, lead: 30, tail: 50 })
    computeAllLayouts(graph)
    expect(rowShape(graph, placed)).toEqual({ width: 80, lead: 30, tail: 50 })
  })

  test('when fonts arrive that measure its text otherwise', async () => {
    const graph = await openLaidOut(await archiveWithSavedLabel(labelSource().source))
    withTextMeasurer(
      () => ({ width: 45, height: 20 }),
      () => graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph))
    )
    const placed = instanceNamed(graph, 'Placed label')
    expect(rowShape(graph, placed)).toEqual({ width: 110, lead: 60, tail: 80 })
  })

  test('lays out text another mode restyles', async () => {
    const { source, caption } = labelSource()
    const type = source.createCollection('Type')
    const size = source.createVariable('size', 'FLOAT', type.id, 14)
    const large = source.createMode(type.id, 'Large')
    if (!large) {
      throw new Error('Missing mode')
    }
    size.valuesByMode[large] = 20
    source.bindVariable(caption.id, 'fontSize', size.id)
    const graph = await openLaidOut(await archiveWithSavedLabel(source))
    const placed = instanceNamed(graph, 'Placed label')
    const instance = new FigmaAPI(graph).getNodeById(placed.id)
    withTextMeasurer(
      (node) => ({ width: node.fontSize * 2, height: 20 }),
      () => {
        instance?.setExplicitVariableModeForCollection(type.id, large)
        expect(instance?.width).toBe(90)
      }
    )
    expect(rowShape(graph, placed)).toEqual({ width: 90, lead: 40, tail: 60 })
  })

  test('inside a nested instance as well', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const row = rowComponent(source, page.id, 'Row', 20)
    const card = source.createNode('COMPONENT', page.id, {
      name: 'Card',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      width: 70,
      height: 40
    })
    source.createInstance(row.id, card.id, { name: 'Inner' })
    source.createInstance(card.id, page.id, { name: 'Placed card', y: 100 })
    const bytes = await archiveWithSavedLayout(source, {
      'Placed card': {
        width: 80,
        layers: { Inner: { width: 80 }, ...ROW_SAVED_WITH_WIDER_LEAD.layers }
      }
    })
    const graph = await openLaidOut(bytes)
    const [inner] = graph.getChildren(instanceNamed(graph, 'Placed card').id)
    expect(rowShape(graph, inner)).toEqual({ width: 80, lead: 30, tail: 50 })
  })

  test('lays out what an edit inside it changes', async () => {
    const { graph, placed, api } = await openSavedRow()
    const [lead] = graph.getChildren(placed.id)
    const [dot] = graph.getChildren(lead.id)
    api.getNodeById(dot.id)?.resize(25, 20)
    expect(api.getNodeById(placed.id)?.width).toBe(75)
    expect(rowShape(graph, placed)).toEqual({ width: 75, lead: 25, tail: 45 })
  })

  test('lays out an edit its component passes on', async () => {
    const { graph, placed } = await openSavedRow()
    createEditor({ graph })
    const row = [...graph.getAllNodes()].find(
      (node) => node.type === 'COMPONENT' && node.name === 'Row'
    )
    const [lead] = graph.getChildren(row?.id ?? '')
    const [dot] = graph.getChildren(lead.id)
    graph.updateNode(dot.id, { width: 25 })
    await Promise.resolve()
    expect(rowShape(graph, placed)).toEqual({ width: 75, lead: 25, tail: 45 })
  })

  test('lays out a switch to another component', async () => {
    const { graph, placed, api } = await openSavedRow()
    const wide = [...graph.getAllNodes()].find((node) => node.name === 'Wide row')
    const instance = api.getNodeById(placed.id)
    if (!wide || instance?.type !== 'INSTANCE') {
      throw new Error('Missing swap')
    }
    const component = api.getNodeById(wide.id)
    if (component?.type !== 'COMPONENT') {
      throw new Error('Missing component')
    }
    instance.swapComponent(component)
    expect(instance.width).toBe(74)
    expect(rowShape(graph, placed)).toEqual({ width: 74, lead: 24, tail: 44 })
  })

  test('lays the instance out again for another mode, around the layers it leaves as saved', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const row = rowComponent(source, page.id, 'Row', 20)
    const spacing = source.createCollection('Spacing')
    const gap = source.createVariable('gap', 'FLOAT', spacing.id, 10)
    const loose = source.createMode(spacing.id, 'Loose')
    if (!loose) {
      throw new Error('Missing mode')
    }
    gap.valuesByMode[loose] = 16
    source.bindVariable(row.id, 'itemSpacing', gap.id)
    source.createInstance(row.id, page.id, { name: 'Placed', y: 100 })
    const graph = await openLaidOut(
      await archiveWithSavedLayout(source, { Placed: ROW_SAVED_WITH_WIDER_LEAD })
    )
    const placed = instanceNamed(graph, 'Placed')
    const api = new FigmaAPI(graph)
    const instance = api.getNodeById(placed.id)
    instance?.setExplicitVariableModeForCollection(spacing.id, loose)
    expect(instance?.width).toBe(86)
    expect(rowShape(graph, placed)).toEqual({ width: 86, lead: 30, tail: 56 })
  })

  test('lays out a layer that fills once its parent resizes it', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const bar = source.createNode('COMPONENT', page.id, {
      ...HUG_ROW,
      name: 'Bar',
      primaryAxisSizing: 'FIXED',
      width: 200,
      height: 40
    })
    source.createNode('RECTANGLE', bar.id, { name: 'Knob', x: 10, y: 10, width: 20, height: 20 })
    const grow = source.createNode('FRAME', bar.id, {
      name: 'Grow',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG',
      primaryAxisAlign: 'MAX',
      layoutGrow: 1,
      x: 40,
      y: 10,
      width: 150,
      height: 20
    })
    source.createNode('RECTANGLE', grow.id, { name: 'Pin', x: 130, width: 20, height: 20 })
    source.createInstance(bar.id, page.id, { name: 'Placed bar', y: 100 })
    const bytes = await archiveWithSavedLayout(source, {
      'Placed bar': {
        width: 200,
        layers: { Knob: { width: 30 }, Grow: { x: 50, width: 140 }, Pin: { x: 120 } }
      }
    })
    const graph = await openLaidOut(bytes)
    const placed = instanceNamed(graph, 'Placed bar')
    const [knob, filled] = graph.getChildren(placed.id)
    const [pin] = graph.getChildren(filled.id)
    expect([filled.width, pin.x]).toEqual([140, 120])
    const api = new FigmaAPI(graph)
    api.getNodeById(knob.id)?.resize(40, 20)
    expect(api.getNodeById(pin.id)?.x).toBe(110)
    expect([filled.x, filled.width]).toEqual([60, 130])
  })
})
