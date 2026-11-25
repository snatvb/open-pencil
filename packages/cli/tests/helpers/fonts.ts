const DIRECTORY_HEADER = 12
const TABLE_RECORD = 16
const WINDOWS = { platform: 3, encoding: 1, language: 0x409 }
const MAC_ROMAN = { platform: 1, encoding: 0, language: 0 }

export interface FontTable {
  tag: string
  data: Uint8Array
}

export type NameRecords = Partial<Record<1 | 2 | 16 | 17, string>>

function padded(length: number): number {
  return Math.ceil(length / 4) * 4
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let c = 0; c < 4; c++) {
    view.setUint8(offset + c, tag.charCodeAt(c))
  }
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4))
}

export function sfnt(tables: readonly FontTable[], base = 0): Uint8Array {
  const directorySize = DIRECTORY_HEADER + tables.length * TABLE_RECORD
  const size = tables.reduce((total, { data }) => total + padded(data.length), directorySize)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tables.length)
  let offset = directorySize
  tables.forEach(({ tag, data }, index) => {
    const record = DIRECTORY_HEADER + index * TABLE_RECORD
    writeTag(view, record, tag)
    view.setUint32(record + 8, base + offset)
    view.setUint32(record + 12, data.length)
    bytes.set(data, offset)
    offset += padded(data.length)
  })
  return bytes
}

function utf16(text: string): Uint8Array {
  const view = new DataView(new ArrayBuffer(text.length * 2))
  Array.from(text).forEach((character, index) => view.setUint16(index * 2, character.charCodeAt(0)))
  return new Uint8Array(view.buffer)
}

export function nameTable(records: NameRecords): Uint8Array {
  const entries = Object.entries(records).map(([id, text]) => ({ id: Number(id), text }))
  const strings = [
    ...entries.map(({ id, text }) => ({ ...WINDOWS, id, data: utf16(text) })),
    ...entries
      .filter(({ id }) => id === 1)
      .map(({ id, text }) => ({ ...MAC_ROMAN, id, data: new TextEncoder().encode(text) }))
  ].toSorted((a, b) => a.platform - b.platform || a.id - b.id)
  const stringsOffset = 6 + strings.length * 12
  const size = strings.reduce((total, { data }) => total + data.length, stringsOffset)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint16(2, strings.length)
  view.setUint16(4, stringsOffset)
  let offset = 0
  strings.forEach(({ platform, encoding, language, id, data }, index) => {
    const record = 6 + index * 12
    for (const [position, value] of [
      platform,
      encoding,
      language,
      id,
      data.length,
      offset
    ].entries()) {
      view.setUint16(record + position * 2, value)
    }
    bytes.set(data, stringsOffset + offset)
    offset += data.length
  })
  return bytes
}

export function os2Table(weight: number, italic: boolean, widthClass = 5): Uint8Array {
  const bytes = new Uint8Array(78)
  const view = new DataView(bytes.buffer)
  view.setUint16(4, weight)
  view.setUint16(6, widthClass)
  view.setUint16(62, italic ? 1 : 0x40)
  return bytes
}

export function namedFont(names: NameRecords, weight = 400, italic = false): Uint8Array {
  return sfnt([
    { tag: 'OS/2', data: os2Table(weight, italic) },
    { tag: 'name', data: nameTable(names) }
  ])
}

export function fontTables(font: Uint8Array): FontTable[] {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  return Array.from({ length: view.getUint16(4) }, (_, index) => {
    const record = DIRECTORY_HEADER + index * TABLE_RECORD
    const offset = view.getUint32(record + 8)
    return {
      tag: tagAt(font, record),
      data: font.subarray(offset, offset + view.getUint32(record + 12))
    }
  })
}

export function renamedFont(font: Uint8Array, names: NameRecords): Uint8Array {
  return sfnt(
    fontTables(font).map((table) =>
      table.tag === 'name' ? { tag: 'name', data: nameTable(names) } : table
    )
  )
}

export function fontCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const headerSize = padded(12 + fonts.length * 4)
  const faces: Uint8Array[] = []
  let offset = headerSize
  const offsets = fonts.map((font) => {
    const face = sfnt(fontTables(font), offset)
    faces.push(face)
    const start = offset
    offset += face.length
    return start
  })
  const bytes = new Uint8Array(offset)
  const view = new DataView(bytes.buffer)
  writeTag(view, 0, 'ttcf')
  view.setUint32(4, 0x00010000)
  view.setUint32(8, fonts.length)
  offsets.forEach((start, index) => {
    view.setUint32(12 + index * 4, start)
    bytes.set(faces[index], start)
  })
  return bytes
}
