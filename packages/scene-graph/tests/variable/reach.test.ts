import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import { collectionsReachedBy } from '@open-pencil/scene-graph/variables'

function threeCollections() {
  const graph = new SceneGraph()
  const base = graph.createCollection('Base')
  const theme = graph.createCollection('Theme')
  const brand = graph.createCollection('Brand')
  const size = graph.createVariable('Size', 'STRING', base.id, 'S')
  const scale = graph.createVariable('Scale', 'STRING', theme.id, 'S')
  const tone = graph.createVariable('Tone', 'STRING', brand.id, 'S')
  return { graph, base, theme, brand, size, scale, tone }
}

describe('collections a binding reaches', () => {
  test('are the variable’s own when it holds plain values', () => {
    const { graph, base, size } = threeCollections()

    expect([...collectionsReachedBy(graph, [size.id])]).toEqual([base.id])
  })

  test('follow aliases through every collection on the chain', () => {
    const { graph, base, theme, brand, size, scale, tone } = threeCollections()
    tone.valuesByMode[brand.defaultModeId] = { aliasId: scale.id }
    scale.valuesByMode[theme.defaultModeId] = { aliasId: size.id }

    expect(collectionsReachedBy(graph, [tone.id])).toEqual(new Set([brand.id, theme.id, base.id]))
  })

  test('end on an alias cycle', () => {
    const { graph, theme, brand, scale, tone } = threeCollections()
    tone.valuesByMode[brand.defaultModeId] = { aliasId: scale.id }
    scale.valuesByMode[theme.defaultModeId] = { aliasId: tone.id }

    expect(collectionsReachedBy(graph, [tone.id])).toEqual(new Set([brand.id, theme.id]))
  })

  test('skip variables that are gone', () => {
    const { graph } = threeCollections()

    expect(collectionsReachedBy(graph, ['missing']).size).toBe(0)
  })
})
