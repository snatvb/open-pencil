import { open, readFile, type FileHandle } from 'node:fs/promises'

import { compact, uniq } from 'es-toolkit/array'

import {
  fontAxes,
  fontFaceName,
  fontLegacyFamilyName,
  fontTableView,
  namedInstances
} from '@open-pencil/core/text'
import { parseFontStyle } from '@open-pencil/scene-graph/font-style'

const OFFSET_TABLE_SIZE = 12
const TABLE_RECORD_SIZE = 16
const COLLECTION_HEADER_SIZE = 12
const COLLECTION_TAG = 'ttcf'
const NAMING_TABLES = ['name', 'OS/2', 'fvar']
const NAMING_TABLE_LIMIT = 1 << 20
const OUTLINE_TABLES = ['glyf', 'CFF ', 'CFF2']
const UNSUPPORTED_OUTLINE_TABLE = 'hvgl'
const OS2_WEIGHT_CLASS = 4
const OS2_WIDTH_CLASS = 6
const OS2_FS_SELECTION = 62
const OS2_NORMAL_WIDTH = 5
const FS_SELECTION_ITALIC = 1
const FS_SELECTION_OBLIQUE = 1 << 9

export interface WeightRange {
  min: number
  max: number
}

export interface NamedFaceInstance {
  name: string
  weight: number
}

export interface InstalledFace {
  path: string
  directoryOffset: number
  family: string
  familyNames: string[]
  drawable: boolean
  style: string
  weight: number
  italic: boolean
  normalWidth: boolean
  weightAxis: WeightRange | null
  instances: NamedFaceInstance[]
}

interface FaceTraits {
  weight: number
  italic: boolean
  normalWidth: boolean
}

interface FontFile {
  handle: FileHandle
  size: number
}

interface TableRecord {
  tag: string
  offset: number
  length: number
}

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )
}

async function readAt(file: FontFile, position: number, length: number): Promise<DataView> {
  if (position + length > file.size) {
    throw new RangeError(`Font data at byte ${position} runs past the end of the file`)
  }
  const bytes = new Uint8Array(length)
  const { bytesRead } = await file.handle.read(bytes, 0, length, position)
  if (bytesRead < length) {
    throw new RangeError(`Font file ends before byte ${position + length}`)
  }
  return new DataView(bytes.buffer)
}

async function faceDirectoryOffsets(file: FontFile): Promise<number[]> {
  const header = await readAt(file, 0, COLLECTION_HEADER_SIZE)
  if (tagAt(header, 0) !== COLLECTION_TAG) {
    return [0]
  }
  const count = header.getUint32(8)
  const offsets = await readAt(file, COLLECTION_HEADER_SIZE, count * 4)
  return uniq(Array.from({ length: count }, (_, index) => offsets.getUint32(index * 4)))
}

async function tableRecords(file: FontFile, directoryOffset: number): Promise<TableRecord[]> {
  const header = await readAt(file, directoryOffset, OFFSET_TABLE_SIZE)
  const count = header.getUint16(4)
  const records = await readAt(file, directoryOffset + OFFSET_TABLE_SIZE, count * TABLE_RECORD_SIZE)
  return Array.from({ length: count }, (_, index) => {
    const record = index * TABLE_RECORD_SIZE
    return {
      tag: tagAt(records, record),
      offset: records.getUint32(record + 8),
      length: records.getUint32(record + 12)
    }
  })
}

function sfntOf(tables: ReadonlyArray<{ tag: string; data: Uint8Array }>): ArrayBuffer {
  const directorySize = OFFSET_TABLE_SIZE + tables.length * TABLE_RECORD_SIZE
  const size = tables.reduce((total, { data }) => total + data.length, directorySize)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tables.length)
  let offset = directorySize
  tables.forEach(({ tag, data }, index) => {
    const record = OFFSET_TABLE_SIZE + index * TABLE_RECORD_SIZE
    for (let c = 0; c < 4; c++) {
      view.setUint8(record + c, tag.charCodeAt(c))
    }
    view.setUint32(record + 8, offset)
    view.setUint32(record + 12, data.length)
    bytes.set(data, offset)
    offset += data.length
  })
  return bytes.buffer
}

function namingTableRecords(records: readonly TableRecord[]): TableRecord[] {
  const firstOfEachTag = NAMING_TABLES.map((tag) => records.find((record) => record.tag === tag))
  return compact(firstOfEachTag).filter(({ length }) => length <= NAMING_TABLE_LIMIT)
}

async function namingTables(file: FontFile, records: readonly TableRecord[]): Promise<ArrayBuffer> {
  const tables: Array<{ tag: string; data: Uint8Array }> = []
  for (const { tag, offset, length } of namingTableRecords(records)) {
    const view = await readAt(file, offset, length)
    tables.push({ tag, data: new Uint8Array(view.buffer) })
  }
  return sfntOf(tables)
}

function hasDrawableOutlines(records: readonly TableRecord[]): boolean {
  const tags = new Set(records.map(({ tag }) => tag))
  return OUTLINE_TABLES.some((tag) => tags.has(tag)) || !tags.has(UNSUPPORTED_OUTLINE_TABLE)
}

function faceTraits(tables: ArrayBuffer, style: string): FaceTraits {
  const os2 = fontTableView(tables, 'OS/2')
  if (!os2 || os2.byteLength < OS2_FS_SELECTION + 2) {
    return { ...parseFontStyle(style), normalWidth: true }
  }
  const selection = os2.getUint16(OS2_FS_SELECTION)
  return {
    weight: os2.getUint16(OS2_WEIGHT_CLASS),
    italic: (selection & (FS_SELECTION_ITALIC | FS_SELECTION_OBLIQUE)) !== 0,
    normalWidth: os2.getUint16(OS2_WIDTH_CLASS) === OS2_NORMAL_WIDTH
  }
}

function weightAxis(tables: ArrayBuffer): WeightRange | null {
  const axis = fontAxes(tables)?.find(({ tag }) => tag === 'wght')
  return axis ? { min: axis.min, max: axis.max } : null
}

function instanceFaces(tables: ArrayBuffer, weight: number): NamedFaceInstance[] {
  return namedInstances(tables).map(({ name, variations }) => ({
    name,
    weight: variations.find(({ axis }) => axis === 'wght')?.value ?? weight
  }))
}

async function readFace(
  file: FontFile,
  path: string,
  directoryOffset: number
): Promise<InstalledFace | null> {
  const records = await tableRecords(file, directoryOffset)
  const tables = await namingTables(file, records)
  const names = fontFaceName(tables)
  if (!names) {
    return null
  }
  const traits = faceTraits(tables, names.style)
  return {
    path,
    directoryOffset,
    family: names.family,
    familyNames: uniq(compact([names.family, fontLegacyFamilyName(tables)])),
    drawable: hasDrawableOutlines(records),
    style: names.style,
    ...traits,
    weightAxis: weightAxis(tables),
    instances: instanceFaces(tables, traits.weight)
  }
}

export async function readFontFileFaces(path: string): Promise<InstalledFace[]> {
  const handle = await open(path)
  try {
    const file = { handle, size: (await handle.stat()).size }
    const faces: InstalledFace[] = []
    const offsets = await faceDirectoryOffsets(file).catch(() => [])
    for (const offset of offsets) {
      const face = await readFace(file, path, offset).catch(() => null)
      if (face) {
        faces.push(face)
      }
    }
    return faces
  } finally {
    await handle.close()
  }
}

function moveDirectoryToFront(bytes: Uint8Array, directoryOffset: number): void {
  const tableCount = new DataView(bytes.buffer).getUint16(directoryOffset + 4)
  const directoryEnd = directoryOffset + OFFSET_TABLE_SIZE + tableCount * TABLE_RECORD_SIZE
  if (directoryEnd > bytes.byteLength) {
    throw new RangeError('Font collection changed since it was scanned')
  }
  bytes.copyWithin(0, directoryOffset, directoryEnd)
}

export async function readFaceData(face: InstalledFace): Promise<ArrayBuffer> {
  const file = await readFile(face.path)
  if (file.byteLength < face.directoryOffset + OFFSET_TABLE_SIZE) {
    throw new RangeError('Font file changed since it was scanned')
  }
  const bytes = new Uint8Array(file.byteLength)
  bytes.set(file)
  if (face.directoryOffset > 0) {
    // CanvasKit reads only the first face of a collection.
    moveDirectoryToFront(bytes, face.directoryOffset)
  }
  return bytes.buffer
}
