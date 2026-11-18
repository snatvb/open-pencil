import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { parseFigBuffer, patchFigArchive, readStreamBytes } from '@open-pencil/fig'
import { initCodec, type VariableDataEntry } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type Effect } from '@open-pencil/scene-graph'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'
import { expectDefined } from '@open-pencil/test-support/assert'

const SHADOW: Effect = {
  type: 'DROP_SHADOW',
  color: { r: 1, g: 0, b: 0, a: 1 },
  offset: { x: 0, y: 2 },
  radius: 3,
  spread: 0,
  visible: true,
  blendMode: 'NORMAL'
}

/** A Light and Dark shadow, the Dark default, with one card in each mode. */
function elevation() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const theme = graph.createCollection('Theme')
  const light = theme.defaultModeId
  graph.addMode(theme.id, 'dark', 'Dark')
  const color = graph.createVariable('Shadow', 'COLOR', theme.id, { r: 0, g: 0, b: 0.5, a: 0.25 })
  color.valuesByMode.dark = { r: 0, g: 0, b: 0, a: 0.6 }
  const radius = graph.createVariable('Blur', 'FLOAT', theme.id, 8)
  radius.valuesByMode.dark = 24
  const card = (name: string, variableModes: Record<string, string> = {}) => {
    const node = graph.createNode('RECTANGLE', page.id, {
      name,
      width: 40,
      height: 40,
      variableModes,
      effects: [SHADOW]
    })
    graph.bindVariable(node.id, 'effects/0/color', color.id)
    graph.bindVariable(node.id, 'effects/0/radius', radius.id)
    graph.bindVariable(node.id, 'effects/0/offsetY', radius.id)
    return node
  }
  card('Light card', { [theme.id]: light })
  card('Dark card', { [theme.id]: 'dark' })
  return { graph, theme }
}

beforeAll(async () => {
  await initCodec()
})

describe('Figma export of effect variable bindings', () => {
  test('writes each bound property as an alias, with the value of the card’s mode', async () => {
    const { graph } = elevation()
    const records = parseFigBuffer(Uint8Array.from(await exportFigFile(graph)).buffer).nodeChanges
    const guid = (name: string) =>
      expectDefined(
        records.find((record) => record.type === 'VARIABLE' && record.name === name)?.guid,
        name
      )
    const effect = (name: string) =>
      expectDefined(records.find((record) => record.name === name)?.effects?.[0], name)
    const alias = (name: string, type: string) => ({
      dataType: 'ALIAS',
      resolvedDataType: type,
      value: { alias: { guid: guid(name) } }
    })

    expect(effect('Light card')).toMatchObject({
      radius: 8,
      offset: { x: 0, y: 8 },
      colorVar: alias('Shadow', 'COLOR'),
      radiusVar: alias('Blur', 'FLOAT'),
      yVar: alias('Blur', 'FLOAT')
    })
    expect(effect('Light card').color?.a).toBeCloseTo(0.25, 5)
    expect(effect('Light card')).not.toHaveProperty('spreadVar')
    expect(effect('Dark card')).toMatchObject({ radius: 24, offset: { x: 0, y: 24 } })
  })

  test('reads the aliases back and resolves the values a file saved for another mode', async () => {
    const { graph } = elevation()
    const exported = await exportFigFile(graph)
    const record = expectDefined(
      parseFigBuffer(Uint8Array.from(exported).buffer).nodeChanges.find(
        (node) => node.name === 'Dark card'
      ),
      'Dark card'
    )
    // Figma saves the default mode's values even on a layer set to another mode.
    const saved = {
      ...record,
      effects: record.effects?.map((effect) => ({ ...effect, radius: 8, offset: { x: 0, y: 8 } }))
    }
    const patched = await readStreamBytes(
      patchFigArchive(
        Uint8Array.from(exported).buffer,
        { records: [saved], blobs: [], removed: [], replaceVariables: false },
        { thumbnailPNG: new Uint8Array(), metaJSON: '{}', images: [] }
      )
    )

    const reopened = await parseFigFile(Uint8Array.from(patched).buffer)
    const variable = (name: string) =>
      expectDefined(
        [...reopened.variables.values()].find((candidate) => candidate.name === name),
        name
      ).id
    const dark = expectDefined(
      [...reopened.getAllNodes()].find((node) => node.name === 'Dark card'),
      'reopened Dark card'
    )

    expect(dark.boundVariables).toMatchObject({
      'effects/0/color': variable('Shadow'),
      'effects/0/radius': variable('Blur'),
      'effects/0/offsetY': variable('Blur')
    })
    expect(dark.effects[0]).toMatchObject({ radius: 24, offset: { x: 0, y: 24 } })
    expect(dark.effects[0].color.a).toBeCloseTo(0.6, 5)
  })

  test('drops an alias the document no longer binds', async () => {
    const { graph } = elevation()
    const reopened = await parseFigFile(Uint8Array.from(await exportFigFile(graph)).buffer)
    const light = expectDefined(
      [...reopened.getAllNodes()].find((node) => node.name === 'Light card'),
      'reopened Light card'
    )
    reopened.unbindVariable(light.id, 'effects/0/radius')

    const records = parseFigBuffer(
      Uint8Array.from(await exportFigFile(reopened)).buffer
    ).nodeChanges
    const effect = records.find((record) => record.name === 'Light card')?.effects?.[0]
    expect(effect).not.toHaveProperty('radiusVar')
    expect(effect).toHaveProperty('yVar')
  })
})

/** A number binding as Figma writes `variable × factor`, the factor first. */
function multiplied(alias: VariableDataEntry, factor: number): VariableDataEntry {
  return {
    dataType: 'EXPRESSION',
    resolvedDataType: 'FLOAT',
    value: {
      expressionValue: {
        expressionFunction: 'MULTIPLY',
        expressionArguments: [
          { dataType: 'FLOAT', resolvedDataType: 'FLOAT', value: { floatValue: factor } },
          alias
        ]
      }
    }
  }
}

/** The cards of `elevation()` saved with their blur and lift written as twice the variable. */
async function doubledElevation() {
  const exported = Uint8Array.from(await exportFigFile(elevation().graph)).buffer
  const cards = parseFigBuffer(exported).nodeChanges.filter((record) =>
    record.name?.endsWith(' card')
  )
  const doubled = cards.map((record) => ({
    ...record,
    effects: record.effects?.map((effect) => ({
      ...effect,
      radiusVar: effect.radiusVar && multiplied(effect.radiusVar, 2),
      yVar: effect.yVar && multiplied(effect.yVar, 2)
    }))
  }))
  const patched = await readStreamBytes(
    patchFigArchive(
      exported,
      { records: doubled, blobs: [], removed: [], replaceVariables: false },
      { thumbnailPNG: new Uint8Array(), metaJSON: '{}', images: [] }
    )
  )
  return Uint8Array.from(patched).buffer
}

function nodeNamed(graph: SceneGraph, name: string) {
  return expectDefined(
    [...graph.getAllNodes()].find((node) => node.name === name),
    name
  )
}

describe('Figma effect bindings written as variable × number', () => {
  test('read as bindings and resolve to the product in each card’s mode', async () => {
    const graph = await parseFigFile(await doubledElevation())
    const blur = expectDefined(
      [...graph.variables.values()].find((variable) => variable.name === 'Blur'),
      'Blur'
    )

    for (const [name, value] of [
      ['Light card', 16],
      ['Dark card', 48]
    ] as const) {
      const card = nodeNamed(graph, name)
      expect(card.boundVariables).toMatchObject({
        'effects/0/radius': blur.id,
        'effects/0/offsetY': blur.id
      })
      expect(card.variableBindingScales).toMatchObject({
        'effects/0/radius': 2,
        'effects/0/offsetY': 2
      })
      expect(card.effects[0]).toMatchObject({ radius: value, offset: { x: 0, y: value } })
    }
  })

  test('follow a mode change', async () => {
    const graph = await parseFigFile(await doubledElevation())
    const light = nodeNamed(graph, 'Light card')
    const dark = nodeNamed(graph, 'Dark card')
    graph.updateNode(light.id, { variableModes: { ...dark.variableModes } })
    reconcileVariableBindings(graph, { subtrees: [light.id] })

    expect(nodeNamed(graph, 'Light card').effects[0]).toMatchObject({
      radius: 48,
      offset: { x: 0, y: 48 }
    })
  })

  test('save back as one expression per property, kept or rewritten with an edit', async () => {
    const graph = await parseFigFile(await doubledElevation())
    const dark = nodeNamed(graph, 'Dark card')
    graph.updateNode(dark.id, { effects: [{ ...dark.effects[0], spread: 3 }] })
    const records = parseFigBuffer(Uint8Array.from(await exportFigFile(graph)).buffer).nodeChanges
    const blur = expectDefined(
      records.find((record) => record.type === 'VARIABLE' && record.name === 'Blur')?.guid,
      'Blur'
    )
    const alias = { dataType: 'ALIAS', resolvedDataType: 'FLOAT', value: { alias: { guid: blur } } }
    const effects = (name: string) => records.find((record) => record.name === name)?.effects

    for (const name of ['Light card', 'Dark card']) {
      expect(effects(name)).toHaveLength(1)
      expect(effects(name)?.[0]).toMatchObject({
        radiusVar: multiplied(alias, 2),
        yVar: multiplied(alias, 2)
      })
      expect(effects(name)?.[0]).not.toHaveProperty('spreadVar')
    }
    expect(effects('Dark card')?.[0]).toMatchObject({ radius: 48, offset: { x: 0, y: 48 } })
  })
})
