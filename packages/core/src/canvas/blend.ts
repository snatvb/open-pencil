import type {
  Blender,
  BlendMode as SkBlendMode,
  CanvasKit,
  Paint,
  RuntimeEffect
} from '@open-pencil/canvaskit'
import type { BlendMode, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from './renderer'
import { keptFadeBlender } from './renderer/shaders'

type LinearBlendMode = 'LINEAR_BURN' | 'LINEAR_DODGE'

/**
 * Figma's plus darker and plus lighter, in premultiplied sRGB with source-over coverage: the sum
 * less the overlap clamped at zero, and the sum clamped at the coverage (live-measured).
 */
const LINEAR_BLEND_COLORS: Record<LinearBlendMode, string> = {
  LINEAR_BURN: 'max(src.rgb + dst.rgb - src.a * dst.a, half3(0))',
  LINEAR_DODGE: 'min(src.rgb + dst.rgb, half3(alpha))'
}

function linearBlendSource(mode: LinearBlendMode): string {
  return `half4 main(half4 src, half4 dst) {
  half alpha = src.a + dst.a * (1 - src.a);
  return half4(${LINEAR_BLEND_COLORS[mode]}, alpha);
}`
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
  if (mode === 'LINEAR_BURN' || mode === 'LINEAR_DODGE') {
    paint.setBlender(linearBlender(r, mode))
    return
  }
  paint.setBlendMode(figmaBlendModeToSkia(r.ck, mode))
}

/** Skia has no blend mode for either: they are runtime blenders, compiled once per renderer. */
function linearBlender(r: SkiaRenderer, mode: LinearBlendMode): Blender {
  if (mode === 'LINEAR_BURN') return (r.shaders.linearBurn ??= compileLinearBlender(r.ck, mode))
  return (r.shaders.linearDodge ??= compileLinearBlender(r.ck, mode))
}

function compileLinearBlender(ck: CanvasKit, mode: LinearBlendMode): Blender {
  let error = ''
  const effect = ck.RuntimeEffect.MakeForBlender(linearBlendSource(mode), (message) => {
    error = message
  })
  if (!effect) throw new Error(`Cannot compile ${mode} blender: ${error}`)
  const blender = effect.makeBlender([])
  effect.delete()
  return blender
}

export function needsIsolatedBlendLayer(mode?: BlendMode): boolean {
  return mode !== undefined && mode !== 'NORMAL' && mode !== 'PASS_THROUGH'
}

const FADE_BLENDER_SOURCE = `uniform float opacity;
half4 main(half4 src, half4 dst) {
  return mix(dst, src, half(opacity));
}`

/**
 * Mixes a layer into what is under it by `opacity`. A layer that starts as a copy of its backdrop
 * needs it: source-over at that alpha would count the backdrop twice where it is translucent.
 */
export function fadeBlender(r: SkiaRenderer, opacity: number): Blender {
  r.shaders.fadeEffect ??= compileFadeEffect(r.ck)
  return keptFadeBlender(r.shaders, r.shaders.fadeEffect, opacity)
}

function compileFadeEffect(ck: CanvasKit): RuntimeEffect {
  let error = ''
  const effect = ck.RuntimeEffect.MakeForBlender(FADE_BLENDER_SOURCE, (message) => {
    error = message
  })
  if (!effect) throw new Error(`Cannot compile the fade blender: ${error}`)
  return effect
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
