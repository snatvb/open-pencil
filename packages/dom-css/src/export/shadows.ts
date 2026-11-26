import type { ColorProfile, SceneNode } from '@open-pencil/scene-graph'

import type { DesignElement, DesignNode } from '../types'
import {
  blendedShadowsToCSS,
  borderWidths,
  type BlendedShadowCSS,
  type EffectFieldCSS
} from './css'
import { becomeContainingBlock } from './position'

export const SHADOW_CARRIER_ATTRIBUTE = 'data-open-pencil-shadow'

export function isShadowCarrier(node: {
  type: string
  attrs?: Readonly<Record<string, string>>
}): boolean {
  return node.type === 'element' && node.attrs?.[SHADOW_CARRIER_ATTRIBUTE] !== undefined
}

const outset = (width: number) => (width === 0 ? '0px' : `-${width}px`)

function shadowCarrier(node: SceneNode, shadow: BlendedShadowCSS): DesignElement {
  const border = borderWidths(node)
  return {
    type: 'element',
    tagName: 'div',
    attrs: { 'aria-hidden': 'true', [SHADOW_CARRIER_ATTRIBUTE]: 'drop' },
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

// `box-shadow` cannot carry a blend mode, so a blended drop shadow takes an element of its own.
export function blendedShadowCarriers(
  node: SceneNode,
  css: EffectFieldCSS,
  profile: ColorProfile
): DesignElement[] {
  return blendedShadowsToCSS(node.effects, css, profile).map((shadow) =>
    shadowCarrier(node, shadow)
  )
}

function hasShadowCarrier(node: DesignNode): boolean {
  return node.type === 'element' && node.children.some(isShadowCarrier)
}

function paintInTreeOrder(node: DesignNode): void {
  if (node.type === 'element') {
    node.inlineStyle ??= {}
    becomeContainingBlock(node.inlineStyle)
  }
}

// CSS paints positioned boxes over static ones, so what the canvas draws over a shadow is positioned too.
export function paintAboveShadowCarriers(
  children: readonly DesignNode[],
  hostCarries: boolean
): void {
  const firstHost = children.findIndex(hasShadowCarrier)
  const above = hostCarries ? children : children.slice(firstHost + 1)
  if (hostCarries || firstHost !== -1) {
    above.forEach(paintInTreeOrder)
  }
}
