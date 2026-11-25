import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { chunk, groupBy, uniqBy } from 'es-toolkit/array'

import type { FamilyFace, HostFontFamily } from '@open-pencil/core/text'
import {
  namesWeight,
  namesWidth,
  parseFontStyle,
  styleSpelling
} from '@open-pencil/scene-graph/font-style'

import { readFaceData, readFontFileFaces, type InstalledFace } from '#cli/fonts/sfnt'

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc'])
const FILES_READ_AT_ONCE = 32

type FamilyIndex = Map<string, InstalledFace[]>

export interface InstalledFontsOptions {
  folders: () => readonly string[]
  onIndexed?: (families: HostFontFamily[]) => void
}

function familyKey(family: string): string {
  return family.toLowerCase()
}

async function fontFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true }).catch(() => [])
  return entries
    .filter((entry) => FONT_EXTENSIONS.has(extname(entry).toLowerCase()))
    .map((entry) => join(folder, entry))
}

function readableFaces(path: string): Promise<InstalledFace[]> {
  return readFontFileFaces(path).catch(() => [])
}

function namesStyle(face: InstalledFace, wanted: string): boolean {
  return (
    styleSpelling(face.style) === wanted ||
    face.instances.some((instance) => styleSpelling(instance.name) === wanted)
  )
}

function namedWeight(weight: number): number {
  const hundreds = Math.ceil(weight / 100 - 0.5)
  return Math.min(Math.max(hundreds, 1), 9) * 100
}

function axisCovers(face: InstalledFace, weight: number): boolean {
  return face.weightAxis !== null && face.weightAxis.min <= weight && weight <= face.weightAxis.max
}

function faceOfWeight(
  faces: readonly InstalledFace[],
  weight: number,
  italic: boolean
): InstalledFace | undefined {
  const sameSlant = faces.filter((face) => face.italic === italic)
  return (
    sameSlant.find((face) => namedWeight(face.weight) === weight) ??
    sameSlant.find((face) => axisCovers(face, weight))
  )
}

function hasNormalWidth(face: InstalledFace): boolean {
  return face.normalWidth && !namesWidth(face.style)
}

export function chooseInstalledFace(
  faces: readonly InstalledFace[],
  style: string
): InstalledFace | undefined {
  const wanted = styleSpelling(style)
  const named = faces.find((face) => namesStyle(face, wanted))
  if (named || !namesWeight(style)) {
    return named
  }
  const { weight, italic } = parseFontStyle(style)
  return (
    faceOfWeight(faces.filter(hasNormalWidth), weight, italic) ??
    faceOfWeight(faces, weight, italic)
  )
}

function listedFaces(face: InstalledFace): FamilyFace[] {
  const instances = face.instances.map(({ name, weight }) => ({
    style: name,
    weight,
    italic: face.italic
  }))
  return [...instances, { style: face.style, weight: face.weight, italic: face.italic }]
}

function hostFamilies(index: FamilyIndex): HostFontFamily[] {
  return [...index.values()].map((faces) => ({
    family: faces[0].family,
    faces: uniqBy(faces.flatMap(listedFaces), (face) => styleSpelling(face.style))
  }))
}

export class InstalledFonts {
  private index: Promise<FamilyIndex> | null = null

  constructor(private readonly options: InstalledFontsOptions) {}

  async load(family: string, style: string): Promise<ArrayBuffer | null> {
    const faces = (await this.familyIndex()).get(familyKey(family)) ?? []
    const face = chooseInstalledFace(faces, style)
    return face ? readFaceData(face) : null
  }

  private familyIndex(): Promise<FamilyIndex> {
    this.index ??= this.scan()
    return this.index
  }

  private async scan(): Promise<FamilyIndex> {
    const files = (await Promise.all(this.options.folders().map(fontFiles))).flat()
    const batches: InstalledFace[][] = []
    for (const batch of chunk(files, FILES_READ_AT_ONCE)) {
      batches.push((await Promise.all(batch.map(readableFaces))).flat())
    }
    const faces = batches.flat()
    const index: FamilyIndex = new Map(
      Object.entries(groupBy(faces, (face) => familyKey(face.family)))
    )
    this.options.onIndexed?.(hostFamilies(index))
    return index
  }
}
