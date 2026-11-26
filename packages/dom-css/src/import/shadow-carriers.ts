import type { Effect } from '@open-pencil/scene-graph'
import { blendModeFromCSS, parseCSSShadows } from '@open-pencil/scene-graph/css'
import { blurRadiusForSigma } from '@open-pencil/scene-graph/geometry'

import { isShadowCarrier } from '../export/shadows'
import type { DesignDocument, DesignElement, DesignNode } from '../types'
import { mergedStyle, pickStyle } from './css-values'

export type CarriedShadows = Map<DesignElement, Effect[]>

/**
 * CSS shadows as the layer's effects, each blurred as the browser blurs it: CSS blurs a shadow
 * by half its blur length, which the canvas draws from the radius that gives that sigma.
 */
export function cssShadows(value: string | undefined): Effect[] {
  // Imported HTML is read as sRGB, as its colors are written for the web.
  return parseCSSShadows(value, 'srgb').map((effect) => ({
    ...effect,
    radius: blurRadiusForSigma(effect.radius / 2)
  }))
}

function carriedShadows(carrier: DesignElement): Effect[] {
  const style = mergedStyle(carrier)
  const blendMode = blendModeFromCSS(pickStyle(style, 'mix-blend-mode') ?? 'normal')
  return cssShadows(pickStyle(style, 'box-shadow')).map((effect) =>
    blendMode ? { ...effect, blendMode } : effect
  )
}

export function foldShadowCarriers(document: DesignDocument): {
  document: DesignDocument
  carried: CarriedShadows
} {
  const carried: CarriedShadows = new Map()
  const fold = (node: DesignNode): DesignNode => {
    if (node.type === 'text') {
      return node
    }
    const carriers = node.children.filter(
      (child): child is DesignElement => child.type === 'element' && isShadowCarrier(child)
    )
    const children = node.children.filter((child) => !isShadowCarrier(child)).map(fold)
    const unchanged =
      carriers.length === 0 && children.every((child, index) => child === node.children[index])
    if (unchanged) {
      return node
    }
    const folded: DesignElement = { ...node, children }
    if (carriers.length > 0) {
      carried.set(folded, carriers.flatMap(carriedShadows))
    }
    return folded
  }
  return { document: { ...document, children: document.children.map(fold) }, carried }
}
