import { afterAll, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { TARGET, addOutlineSource, addTarget } from '#core-tests/helpers/patterns'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io/formats/raster'
import { SceneGraph } from '@open-pencil/scene-graph'

import { patternTilesOf } from '#core/canvas/patterns/tiles'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(TARGET, TARGET), 'surface'))
afterAll(() => renderer.destroy())

function outlinedScene() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const source = addOutlineSource(graph, page)
  const target = addTarget(graph, page, source)
  const other = graph.createNode('RECTANGLE', page, { x: 100 })
  return { graph, page, source, target, other }
}

function draw(graph: SceneGraph, page: string): void {
  renderer.renderSceneToCanvas(renderer.surface.getCanvas(), graph, page)
}

function cachedShaders() {
  return [...patternTilesOf(renderer).shaders.values()].map((tile) => tile.shader)
}

describe('pattern tiles', () => {
  test('are recorded once and kept across frames', () => {
    const { graph, page } = outlinedScene()
    renderer.invalidateAllPictures()
    draw(graph, page)
    const first = cachedShaders()
    draw(graph, page)
    expect(first).toHaveLength(1)
    expect(cachedShaders()[0]).toBe(first[0])
  })

  test('are dropped when a layer inside their source changes, and only then', () => {
    const { graph, page, source, other } = outlinedScene()
    renderer.invalidateAllPictures()
    draw(graph, page)
    renderer.invalidateNodePicture(other.id)
    expect(cachedShaders()).toHaveLength(1)
    renderer.invalidateNodePicture(source.childIds[0])
    expect(cachedShaders()).toHaveLength(0)
  })

  test('are recorded again after fonts change', () => {
    const { graph, page } = outlinedScene()
    renderer.invalidateAllPictures()
    draw(graph, page)
    const first = cachedShaders()
    renderer.fontGeneration += 1
    draw(graph, page)
    expect(cachedShaders()).toHaveLength(1)
    expect(cachedShaders()[0]).not.toBe(first[0])
  })

  test('are not kept while images draw at preview resolution', () => {
    const { graph, target } = outlinedScene()
    renderer.invalidateAllPictures()
    renderer.viewportImageRendering = true
    renderer.worldViewport = { x: 0, y: 0, w: TARGET, h: TARGET }
    try {
      renderer.renderNode(renderer.surface.getCanvas(), graph, target.id, {})
    } finally {
      renderer.viewportImageRendering = false
    }
    expect(cachedShaders()).toHaveLength(0)
  })

  test('belong to the document they were drawn from', () => {
    const first = outlinedScene()
    const second = outlinedScene()
    renderer.invalidateAllPictures()
    draw(first.graph, first.page)
    const shaders = cachedShaders()
    draw(second.graph, second.page)
    expect(cachedShaders()).toHaveLength(1)
    expect(cachedShaders()[0]).not.toBe(shaders[0])
  })
})
