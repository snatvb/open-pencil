import type {
  Blender,
  BlendMode as SkBlendMode,
  Canvas,
  CanvasKit,
  Paint
} from '@open-pencil/canvaskit'
import type { BlendMode, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { compiledBlender, keptBlender } from '#core/canvas/renderer/shaders'
import { defineBlender, type NoUniforms, type SkslProgram } from '#core/canvas/sksl'

import fadeSource from './blenders/fade.sksl?raw'
import plusDarkerSource from './blenders/plus-darker.sksl?raw'
import plusLighterSource from './blenders/plus-lighter.sksl?raw'
import softLightSource from './blenders/soft-light.sksl?raw'
import type { SkiaRenderer } from './renderer'

type LinearBlendMode = 'LINEAR_BURN' | 'LINEAR_DODGE'

/** Figma's plus darker and plus lighter: Skia has no blend mode for either. */
const LINEAR_BLENDERS: Record<LinearBlendMode, SkslProgram<NoUniforms>> = {
  LINEAR_BURN: defineBlender('plus darker blender', plusDarkerSource),
  LINEAR_DODGE: defineBlender('plus lighter blender', plusLighterSource)
}

const SOFT_LIGHT_BLENDER = defineBlender('soft light blender', softLightSource)

function isLinearBlendMode(mode?: BlendMode): mode is LinearBlendMode {
  return mode === 'LINEAR_BURN' || mode === 'LINEAR_DODGE'
}

function blenderFor(r: SkiaRenderer, mode?: BlendMode): SkslProgram<NoUniforms> | null {
  if (isLinearBlendMode(mode)) {
    return LINEAR_BLENDERS[mode]
  }
  if (mode === 'SOFT_LIGHT' && !r.builtInBlendModesOnly) {
    return SOFT_LIGHT_BLENDER
  }
  return null
}

export function figmaBlendModeToSkia(
  ck: CanvasKit,
  mode?: Exclude<BlendMode, LinearBlendMode>
): SkBlendMode {
  switch (mode) {
    case 'DARKEN':
      return ck.BlendMode.Darken
    case 'MULTIPLY':
      return ck.BlendMode.Multiply
    case 'COLOR_BURN':
      return ck.BlendMode.ColorBurn
    case 'LIGHTEN':
      return ck.BlendMode.Lighten
    case 'SCREEN':
      return ck.BlendMode.Screen
    case 'COLOR_DODGE':
      return ck.BlendMode.ColorDodge
    case 'OVERLAY':
      return ck.BlendMode.Overlay
    case 'SOFT_LIGHT':
      return ck.BlendMode.SoftLight
    case 'HARD_LIGHT':
      return ck.BlendMode.HardLight
    case 'DIFFERENCE':
      return ck.BlendMode.Difference
    case 'EXCLUSION':
      return ck.BlendMode.Exclusion
    case 'HUE':
      return ck.BlendMode.Hue
    case 'SATURATION':
      return ck.BlendMode.Saturation
    case 'COLOR':
      return ck.BlendMode.Color
    case 'LUMINOSITY':
      return ck.BlendMode.Luminosity
    default:
      return ck.BlendMode.SrcOver
  }
}

export function setPaintBlendMode(r: SkiaRenderer, paint: Paint, mode?: BlendMode): void {
  const blender = blenderFor(r, mode)
  if (blender) {
    paint.setBlender(compiledBlender(r.ck, r.shaders, blender))
    return
  }
  paint.setBlendMode(figmaBlendModeToSkia(r.ck, isLinearBlendMode(mode) ? 'NORMAL' : mode))
}

// Skia restores a runtime-blender layer over the whole clip; ours leave transparent pixels as is.
function clipToBlendedLayer(r: SkiaRenderer, canvas: Canvas, bounds: Float32Array): void {
  const matrix = canvas.getTotalMatrix()
  const pixelX = 1 / Math.hypot(matrix[0], matrix[3])
  const pixelY = 1 / Math.hypot(matrix[1], matrix[4])
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
    return
  }
  const [left, top, right, bottom] = bounds
  const grown = r.ck.LTRBRect(left - pixelX, top - pixelY, right + pixelX, bottom + pixelY)
  canvas.clipRect(grown, r.ck.ClipOp.Intersect, true)
}

/** Opens a layer clipped to its bounds; returns the saves `restoreBlendedLayer` closes. */
export function saveClippedLayer(
  r: SkiaRenderer,
  canvas: Canvas,
  paint: Paint,
  bounds: Float32Array | null,
  flags = 0
): number {
  if (!bounds) {
    canvas.saveLayer(paint, bounds, null, flags)
    return 1
  }
  canvas.save()
  clipToBlendedLayer(r, canvas, bounds)
  canvas.saveLayer(paint, bounds, null, flags)
  return 2
}

/** Opens a layer composited with `mode`; returns the saves `restoreBlendedLayer` closes. */
export function saveBlendedLayer(
  r: SkiaRenderer,
  canvas: Canvas,
  paint: Paint,
  mode: BlendMode | undefined,
  bounds: Float32Array | null,
  flags = 0
): number {
  setPaintBlendMode(r, paint, mode)
  if (blenderFor(r, mode)) {
    return saveClippedLayer(r, canvas, paint, bounds, flags)
  }
  canvas.saveLayer(paint, bounds, null, flags)
  return 1
}

export function restoreBlendedLayer(canvas: Canvas, saves: number): void {
  for (let restored = 0; restored < saves; restored++) {
    canvas.restore()
  }
}

export function needsIsolatedBlendLayer(mode?: BlendMode): boolean {
  return mode !== undefined && mode !== 'NORMAL' && mode !== 'PASS_THROUGH'
}

const FADE_BLENDER = defineBlender<{ opacity: number }>('fade blender', fadeSource)

/**
 * Mixes a layer into what is under it by `opacity`. A layer that starts as a copy of its backdrop
 * needs it: source-over at that alpha would count the backdrop twice where it is translucent.
 */
export function fadeBlender(r: SkiaRenderer, opacity: number): Blender {
  return keptBlender(r.ck, r.shaders, FADE_BLENDER, { opacity })
}

export function paintsBlendWithBackdrop(node: SceneNode): boolean {
  return [node.fills, node.strokes, node.effects].some((paints) =>
    paints.some((paint) => paint.visible && needsIsolatedBlendLayer(paint.blendMode))
  )
}

/**
 * Whether a pass-through layer's children blend with what is under it, through every child that
 * opens no isolated layer of its own. Figma blends them with the backdrop under the group and
 * fades the result by the group's opacity, so such a layer starts as a copy of that backdrop.
 */
export function childrenBlendWithBackdrop(graph: SceneGraph, node: SceneNode): boolean {
  return node.childIds.some((childId) => {
    const child = graph.getNode(childId)
    if (!child?.visible) return false
    if (needsIsolatedBlendLayer(child.blendMode)) return true
    if (child.opacity < 1 && child.blendMode !== 'PASS_THROUGH') return false
    return paintsBlendWithBackdrop(child) || childrenBlendWithBackdrop(graph, child)
  })
}
