import type { Blender, BlendMode as SkBlendMode, CanvasKit, Paint } from '@open-pencil/canvaskit'
import type { BlendMode, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { compiledBlender, keptBlender } from '#core/canvas/renderer/shaders'
import { defineBlender, type NoUniforms, type SkslProgram } from '#core/canvas/sksl'

import fadeSource from './blenders/fade.sksl?raw'
import plusDarkerSource from './blenders/plus-darker.sksl?raw'
import plusLighterSource from './blenders/plus-lighter.sksl?raw'
import softLightSource from './blenders/soft-light.sksl?raw'
import type { SkiaRenderer } from './renderer'

type BlenderMode = 'LINEAR_BURN' | 'LINEAR_DODGE' | 'SOFT_LIGHT'

/** Figma modes Skia draws differently or not at all: plus darker, plus lighter, soft light. */
const BLENDERS: Record<BlenderMode, SkslProgram<NoUniforms>> = {
  LINEAR_BURN: defineBlender('plus darker blender', plusDarkerSource),
  LINEAR_DODGE: defineBlender('plus lighter blender', plusLighterSource),
  SOFT_LIGHT: defineBlender('soft light blender', softLightSource)
}

function isBlenderMode(mode?: BlendMode): mode is BlenderMode {
  return mode !== undefined && mode in BLENDERS
}

export function figmaBlendModeToSkia(
  ck: CanvasKit,
  mode?: Exclude<BlendMode, BlenderMode>
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
  if (isBlenderMode(mode)) {
    paint.setBlender(compiledBlender(r.ck, r.shaders, BLENDERS[mode]))
    return
  }
  paint.setBlendMode(figmaBlendModeToSkia(r.ck, mode))
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
