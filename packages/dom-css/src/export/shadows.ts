import type { ColorProfile, SceneNode } from '@open-pencil/scene-graph'

import type { DesignElement } from '../types'
import {
  blendedShadowsToCSS,
  borderWidths,
  type BlendedShadowCSS,
  type EffectFieldCSS
} from './css'

const outset = (width: number) => (width === 0 ? '0px' : `-${width}px`)

function shadowCarrier(node: SceneNode, shadow: BlendedShadowCSS): DesignElement {
  const border = borderWidths(node)
  return {
    type: 'element',
    tagName: 'div',
    attrs: { 'aria-hidden': 'true' },
    children: [],
    inlineStyle: {
      position: 'absolute',
      top: outset(border.top),
      right: outset(border.right),
      bottom: outset(border.bottom),
      left: outset(border.left),
      'border-radius': 'inherit',
      'box-shadow': shadow.boxShadow,
      'mix-blend-mode': shadow.blend,
      'pointer-events': 'none'
    }
  }
}

export function blendedShadowCarriers(
  node: SceneNode,
  css: EffectFieldCSS,
  profile: ColorProfile
): DesignElement[] {
  return blendedShadowsToCSS(node.effects, css, profile).map((shadow) =>
    shadowCarrier(node, shadow)
  )
}
