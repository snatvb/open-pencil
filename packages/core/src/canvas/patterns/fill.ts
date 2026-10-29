import type { Canvas, Shader } from 'canvaskit-wasm'

import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { createPatternSourceLookup } from '@open-pencil/scene-graph/paints'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { withWorldViewport } from '#core/canvas/renderer/picture'

import { patternTileKey, patternTileLayout, type PatternTileLayout } from './layout'
import { patternTilesOf, type PatternTiles } from './tiles'

const UNBOUNDED_VIEWPORT = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }

export type DrawSourceFills = (
  r: SkiaRenderer,
  canvas: Canvas,
  source: SceneNode,
  graph: SceneGraph
) => void

function hasVisibleOwnFill(source: SceneNode): boolean {
  return (
    source.fills.some((fill) => fill.visible) ||
    source.fillGeometry.some((geometry) => geometry.fills?.some((fill) => fill.visible))
  )
}

function drawSourceLayer(r: SkiaRenderer, canvas: Canvas, source: SceneNode, graph: SceneGraph) {
  canvas.translate(-source.x, -source.y)
  const sceneBacking = r.renderingSceneBacking
  r.renderingSceneBacking = false
  try {
    withWorldViewport(r, UNBOUNDED_VIEWPORT, () => r.renderNode(canvas, graph, source.id, {}))
  } finally {
    r.renderingSceneBacking = sceneBacking
  }
}

function recordPatternTile(
  r: SkiaRenderer,
  source: SceneNode,
  graph: SceneGraph,
  layout: PatternTileLayout,
  drawSourceFills: DrawSourceFills
): Shader {
  const tile = r.ck.LTRBRect(0, 0, layout.rect.width, layout.rect.height)
  const recorder = new r.ck.PictureRecorder()
  try {
    const canvas = recorder.beginRecording(tile)
    for (const position of layout.positions) {
      canvas.save()
      canvas.translate(position.x, position.y)
      canvas.scale(layout.scale, layout.scale)
      if (source.visible) {
        drawSourceLayer(r, canvas, source, graph)
      } else {
        drawSourceFills(r, canvas, source, graph)
      }
      canvas.restore()
    }
    const picture = recorder.finishRecordingAsPicture()
    const shader = picture.makeShader(
      r.ck.TileMode.Repeat,
      r.ck.TileMode.Repeat,
      r.ck.FilterMode.Linear,
      undefined,
      tile
    )
    picture.delete()
    return shader
  } finally {
    recorder.delete()
  }
}

function drawableSource(
  tiles: PatternTiles,
  graph: SceneGraph,
  sourceId: string
): SceneNode | null {
  const source = createPatternSourceLookup(graph)(sourceId)
  if (!source) {
    tiles.unresolvedSources.add(sourceId)
    return null
  }
  if (source.width <= 0 || source.height <= 0 || tiles.sourcesInProgress.has(source.id)) {
    return null
  }
  if (!source.visible && !hasVisibleOwnFill(source)) {
    return null
  }
  return source
}

function recordWithoutReentry(
  r: SkiaRenderer,
  tiles: PatternTiles,
  source: SceneNode,
  fill: Fill,
  graph: SceneGraph,
  drawSourceFills: DrawSourceFills
): Shader {
  tiles.sourcesInProgress.add(source.id)
  try {
    return recordPatternTile(r, source, graph, patternTileLayout(source, fill), drawSourceFills)
  } finally {
    tiles.sourcesInProgress.delete(source.id)
  }
}

export function applyPatternFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  drawSourceFills: DrawSourceFills
): boolean {
  const sourceId = fill.sourceNodeId
  if (!sourceId || sourceId === node.id || sourceId === node.source.id) {
    return false
  }
  const tiles = patternTilesOf(r)
  tiles.prepare(graph, r.fontGeneration)
  if (tiles.unresolvedSources.has(sourceId)) {
    return false
  }
  const key = patternTileKey(sourceId, fill)
  const nested = tiles.sourcesInProgress.size > 0
  const cached = nested ? undefined : tiles.shaders.get(key)
  if (cached) {
    tiles.addTarget(cached.sourceId, node.id)
    r.fillPaint.setShader(cached.shader)
    return true
  }
  const source = drawableSource(tiles, graph, sourceId)
  if (!source) {
    return false
  }
  const dependsOnRenderState = nested || r.viewportImageRendering
  const shader = recordWithoutReentry(r, tiles, source, fill, graph, drawSourceFills)
  r.fillPaint.setShader(shader)
  tiles.addTarget(source.id, node.id)
  if (dependsOnRenderState || !tiles.shaders.set(key, { shader, sourceId: source.id })) {
    shader.delete()
  }
  return true
}
