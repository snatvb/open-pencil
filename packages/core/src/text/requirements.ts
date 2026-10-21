import {
  distinctFontFace,
  runFontName,
  weightToStyle,
  type FontName,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { shownCharacters } from '#core/text/case'
import { cjkFallbackScriptForLanguage, type FontFallbackScript } from '#core/text/fallbacks'

export interface TextFontFace {
  family: string
  style: string
  postScriptName?: string
}

export type FontKey = [family: string, style: string, postScriptName?: string]

function textFontFace(
  family: string,
  weight: number,
  italic: boolean,
  fontName: FontName | null
): TextFontFace {
  const distinct = distinctFontFace(fontName, family, weight, italic)
  if (!distinct) {
    return { family, style: weightToStyle(weight, italic) }
  }
  return distinct.postScriptName
    ? { family, style: distinct.style, postScriptName: distinct.postScriptName }
    : { family, style: distinct.style }
}

export function collectNodeFontFaces(node: SceneNode): TextFontFace[] {
  if (node.type !== 'TEXT') return []
  const family = node.fontFamily || DEFAULT_FONT_FAMILY
  const faces = new Map<string, TextFontFace>()
  const add = (face: TextFontFace) => {
    faces.set(`${face.family}\u0000${face.style}`, face)
  }
  add(textFontFace(family, node.fontWeight || 400, node.italic, node.fontName))
  for (const run of node.styleRuns) {
    add(
      textFontFace(
        run.style.fontFamily ?? family,
        run.style.fontWeight ?? node.fontWeight,
        run.style.italic ?? node.italic,
        runFontName(node, run.style)
      )
    )
  }
  return [...faces.values()]
}

function fontKeyOf({ family, style, postScriptName }: TextFontFace): FontKey {
  return postScriptName ? [family, style, postScriptName] : [family, style]
}

export function collectGraphFontKeys(graph: SceneGraph, nodeIds: readonly string[]): FontKey[] {
  const fontKeys = new Map<string, FontKey>()
  const collect = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    if (node.type === 'TEXT') {
      for (const face of collectNodeFontFaces(node)) {
        fontKeys.set(`${face.family}\u0000${face.style}`, fontKeyOf(face))
      }
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return [...fontKeys.values()]
}

function fallbackScriptForCharacter(
  character: string,
  language?: string | null
): FontFallbackScript | null {
  if (/\p{Script=Arabic}/u.test(character)) return 'arabic'
  if (/\p{Script=Hangul}/u.test(character)) return 'cjk-kr'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)) return 'cjk-jp'
  if (/\p{Script=Han}/u.test(character)) return cjkFallbackScriptForLanguage(language) ?? 'cjk-sc'
  return null
}

function textLanguageAt(node: SceneNode, index: number): string | null {
  const run = node.styleRuns.find((item) => index >= item.start && index < item.start + item.length)
  return run?.style.textLanguage ?? node.textLanguage
}

export interface GraphFontRequirements {
  characters: string
  nodes: SceneNode[]
  scripts: FontFallbackScript[]
}

export function collectGraphFontRequirements(
  graph: SceneGraph,
  nodeIds: readonly string[]
): GraphFontRequirements {
  const characters = new Set<string>()
  const nodes: SceneNode[] = []
  const scripts = new Set<FontFallbackScript>()
  const collect = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    nodes.push(node)
    if (node.type === 'TEXT') {
      for (const { character, sourceIndex } of shownCharacters(node)) {
        characters.add(character)
        const script = fallbackScriptForCharacter(character, textLanguageAt(node, sourceIndex))
        if (script) scripts.add(script)
      }
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return { characters: Array.from(characters).join(''), nodes, scripts: Array.from(scripts) }
}
