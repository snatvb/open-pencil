import { uniqBy } from 'es-toolkit'

import { NORMAL_FONT_WIDTH, parseFontStyle } from '@open-pencil/scene-graph'

/** One face a font family has: a weight, upright or italic. */
export interface FamilyFace {
  weight: number
  italic: boolean
}

/** The faces named by a family's style names, such as "Bold Italic" or "SemiBold". */
export function facesFromStyles(styles: readonly string[]): FamilyFace[] {
  return uniqBy(
    styles.map((style) => {
      const { weight, italic } = parseFontStyle(style)
      return { weight, italic }
    }),
    (face) => `${face.weight}${face.italic ? 'i' : ''}`
  )
}

export function hasFamilyFace(faces: readonly FamilyFace[], weight: number, italic: boolean) {
  return faces.some((face) => face.weight === weight && face.italic === italic)
}

/**
 * The face a text takes in a family, as Figma picks it when the family changes: the same weight
 * and slant where the family has it, otherwise the nearest weight with the same slant, or the
 * nearest weight at all in a family without that slant. Equally near weights take the lighter.
 */
export function nearestFamilyFace(
  faces: readonly FamilyFace[],
  weight: number,
  italic: boolean
): FamilyFace | null {
  const sameSlant = faces.filter((face) => face.italic === italic)
  const candidates = sameSlant.length > 0 ? sameSlant : faces
  let nearest: FamilyFace | null = null
  for (const face of candidates) {
    const distance = Math.abs(face.weight - weight)
    const best = nearest ? Math.abs(nearest.weight - weight) : Infinity
    if (distance < best || (distance === best && nearest && face.weight < nearest.weight))
      nearest = face
  }
  return nearest
}

export function styleAtWidth(
  styles: readonly string[],
  style: string,
  weight: number
): string | null {
  const { italic, width } = parseFontStyle(style)
  if (width === NORMAL_FONT_WIDTH) {
    return null
  }
  return (
    styles.find((candidate) => {
      const face = parseFontStyle(candidate)
      return face.weight === weight && face.italic === italic && face.width === width
    }) ?? null
  )
}
