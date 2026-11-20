import type { SkPicture } from '@open-pencil/canvaskit'
import type { SceneNode } from '@open-pencil/scene-graph'

import { clearPatternTiles, invalidatePatternTargets } from '#core/canvas/patterns/tiles'
import { type SampledPicture, SamplingSlots } from '#core/canvas/renderer/sampling-slots'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { changesShaping } from '#core/canvas/text/paragraph/inputs'

export interface NodeFlash {
  nodeId: string
  startTime: number
}

/** Layers flashing for attention, and those the AI is working on or has just finished. */
export interface FeedbackMarks {
  readonly flashes: NodeFlash[]
  readonly aiActive: Set<string>
  readonly aiDone: NodeFlash[]
}

export function createFeedbackMarks(): FeedbackMarks {
  return { flashes: [], aiActive: new Set(), aiDone: [] }
}

/** A node's picture of itself with its effects, good while the font generation holds. */
export interface NodePictureEntry extends SampledPicture {
  picture: SkPicture
  fontGeneration: number
}

export interface ScenePicture extends SampledPicture {
  picture: SkPicture
}

export interface WholeScenePicture {
  readonly pictures: SamplingSlots<ScenePicture>
  version: number
  fontGeneration: number
  positionPreviewVersion: number
  pageId: string | null
}

export function createWholeScenePicture(): WholeScenePicture {
  return {
    pictures: new SamplingSlots(),
    version: -1,
    fontGeneration: -1,
    positionPreviewVersion: -1,
    pageId: null
  }
}

export function invalidateScenePicture(r: SkiaRenderer): void {
  r.wholeScene.pictures.release()
  r.wholeScene.version = -1
  r.wholeScene.fontGeneration = -1
}

export function clearNodePictures(r: Pick<SkiaRenderer, 'nodePictures'>): void {
  for (const slots of r.nodePictures.values()) {
    slots.release()
  }
  r.nodePictures.clear()
}

export function invalidateAllPictures(r: SkiaRenderer): void {
  r.textPreparationCache.clear()
  r.textFonts.readiness.clear()
  invalidateScenePicture(r)
  r.tiledScene.invalidateStructure()
  clearNodePictures(r)
  clearPatternTiles(r)
  r.renderedBounds.clear()
}

export function invalidateNodePicture(
  r: SkiaRenderer,
  nodeId: string,
  changedKeys?: readonly (keyof SceneNode)[]
): void {
  r.textPreparationCache.deleteNode(nodeId, {
    keepShaping: changedKeys !== undefined && !changesShaping(changedKeys)
  })
  r.textFonts.readiness.delete(nodeId)
  invalidatePatternTargets(r, nodeId)
  r.renderedBounds.forget(nodeId)
  r.nodePictures.get(nodeId)?.release()
  r.nodePictures.delete(nodeId)
}

export function flashNode(r: SkiaRenderer, nodeId: string): void {
  r.feedback.flashes.push({ nodeId, startTime: performance.now() })
}

export function aiMarkActive(r: SkiaRenderer, nodeIds: string[]): void {
  for (const id of nodeIds) r.feedback.aiActive.add(id)
}

export function aiMarkDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    if (r.feedback.aiActive.delete(id)) {
      r.feedback.aiDone.push({ nodeId: id, startTime: now })
    }
  }
}

export function aiFlashDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    r.feedback.aiDone.push({ nodeId: id, startTime: now })
  }
}

export function aiClearActive(r: SkiaRenderer): void {
  r.feedback.aiActive.clear()
}

export function aiClearAll(r: SkiaRenderer): void {
  r.feedback.aiActive.clear()
  r.feedback.aiDone.length = 0
}

export function hasActiveFlashes(r: SkiaRenderer): boolean {
  return (
    r.feedback.flashes.length > 0 || r.feedback.aiActive.size > 0 || r.feedback.aiDone.length > 0
  )
}
