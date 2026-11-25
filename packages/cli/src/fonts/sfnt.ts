import { open, readFile, type FileHandle } from 'node:fs/promises'

import { fontAxes, fontFaceName, fontTableView, namedInstances } from '@open-pencil/core/text'
import { parseFontStyle } from '@open-pencil/scene-graph/font-style'

const OFFSET_TABLE_SIZE = 12
const TABLE_RECORD_SIZE = 16
const COLLECTION_HEADER_SIZE = 12
const COLLECTION_TAG = 'ttcf'
const NAMING_TABLES = new Set(['name', 'OS/2', 'fvar'])
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

async function readAt(handle: FileHandle, position: number, length: number): Promise<DataView> {
  const bytes = new Uint8Array(length)
  const { bytesRead } = await handle.read(bytes, 0, length, position)
  if (bytesRead < length) {
    throw new RangeError(`Font file ends before byte ${position + length}`)
  }
  return new DataView(bytes.buffer)
}

async function faceDirectoryOffsets(handle: FileHandle): Promise<number[]> {
  const header = await readAt(handle, 0, COLLECTION_HEADER_SIZE)
  if (tagAt(header, 0) !== COLLECTION_TAG) {
    return [0]
  }
  const count = header.getUint32(8)
  const offsets = await readAt(handle, COLLECTION_HEADER_SIZE, count * 4)
  return Array.from({ length: count }, (_, index) => offsets.getUint32(index * 4))
}

async function tableRecords(handle: FileHandle, directoryOffset: number): Promise<TableRecord[]> {
  const header = await readAt(handle, directoryOffset, OFFSET_TABLE_SIZE)
  const count = header.getUint16(4)
  const records = await readAt(
    handle,
    directoryOffset + OFFSET_TABLE_SIZE,
    count * TABLE_RECORD_SIZE
  )
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

async function namingTables(handle: FileHandle, directoryOffset: number): Promise<ArrayBuffer> {
  const records = await tableRecords(handle, directoryOffset)
  const wanted = records.filter((record) => NAMING_TABLES.has(record.tag))
  const tables = await Promise.all(
    wanted.map(async ({ tag, offset, length }) => {
      const view = await readAt(handle, offset, length)
      return { tag, data: new Uint8Array(view.buffer) }
    })
  )
  return sfntOf(tables)
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
  handle: FileHandle,
  path: string,
  directoryOffset: number
): Promise<InstalledFace | null> {
  const tables = await namingTables(handle, directoryOffset)
  const names = fontFaceName(tables)
  if (!names) {
    return null
  }
  const traits = faceTraits(tables, names.style)
  return {
    path,
    directoryOffset,
    family: names.family,
    style: names.style,
    ...traits,
    weightAxis: weightAxis(tables),
    instances: instanceFaces(tables, traits.weight)
  }
}

export async function readFontFileFaces(path: string): Promise<InstalledFace[]> {
  const handle = await open(path)
  try {
    const offsets = await faceDirectoryOffsets(handle)
    const faces = await Promise.all(offsets.map((offset) => readFace(handle, path, offset)))
    return faces.filter((face) => face !== null)
  } finally {
    await handle.close()
  }
}

export async function readFaceData(face: InstalledFace): Promise<ArrayBuffer> {
  const file = await readFile(face.path)
  const bytes = new Uint8Array(file.byteLength)
  bytes.set(file)
  if (face.directoryOffset === 0) {
    return bytes.buffer
  }
  const view = new DataView(bytes.buffer)
  // CanvasKit reads only a collection's first face; table offsets are absolute, so only the directory moves.
  const tableCount = view.getUint16(face.directoryOffset + 4)
  const directorySize = OFFSET_TABLE_SIZE + tableCount * TABLE_RECORD_SIZE
  bytes.copyWithin(0, face.directoryOffset, face.directoryOffset + directorySize)
  return bytes.buffer
}
