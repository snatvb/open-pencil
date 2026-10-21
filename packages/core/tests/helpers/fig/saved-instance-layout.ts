import { deflateSync } from 'fflate'

import { exportFigFile, parseFigFile, populateAllFigPages } from '@open-pencil/core/io/formats/fig'
import { compressFigDataSync, parseFigBuffer } from '@open-pencil/fig'
import {
  derivedSymbolDataOf,
  type DerivedSymbolOverride
} from '@open-pencil/fig/instance-overrides'
import {
  getCompiledSchema,
  getSchemaBytes,
  initCodec,
  type NodeChange
} from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'

export interface SavedBounds {
  x?: number
  width?: number
}

export interface SavedInstance {
  width: number
  layers: Record<string, SavedBounds>
}

export const HUG_ROW = {
  layoutMode: 'HORIZONTAL',
  primaryAxisSizing: 'HUG',
  counterAxisSizing: 'HUG',
  itemSpacing: 10,
  paddingLeft: 10,
  paddingRight: 10,
  paddingTop: 10,
  paddingBottom: 10
} as const

export const ROW_SAVED_WITH_WIDER_LEAD: SavedInstance = {
  width: 80,
  layers: { Lead: { width: 30 }, Tail: { x: 50 } }
}

export function rowComponent(
  graph: SceneGraph,
  parentId: string,
  name: string,
  dotWidth: number
): SceneNode {
  const row = graph.createNode('COMPONENT', parentId, {
    ...HUG_ROW,
    name,
    width: 50 + dotWidth,
    height: 40
  })
  const lead = graph.createNode('FRAME', row.id, {
    name: 'Lead',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    x: 10,
    y: 10,
    width: dotWidth,
    height: 20
  })
  graph.createNode('RECTANGLE', lead.id, { name: 'Dot', width: dotWidth, height: 20 })
  graph.createNode('FRAME', row.id, {
    name: 'Tail',
    x: 20 + dotWidth,
    y: 10,
    width: 20,
    height: 20
  })
  return row
}

function targetName(records: NodeChange[], entry: DerivedSymbolOverride): string {
  const target = entry.guidPath?.guids?.at(-1)
  const id = target ? guidToString(target) : ''
  return records.find((record) => record.guid && guidToString(record.guid) === id)?.name ?? ''
}

function saveBounds(entry: DerivedSymbolOverride, bounds: SavedBounds): void {
  if (bounds.width !== undefined && entry.size) {
    entry.size = { ...entry.size, x: bounds.width }
  }
  if (bounds.x !== undefined && entry.transform) {
    entry.transform = { ...entry.transform, m02: bounds.x }
  }
}

function saveInstanceLayout(
  records: NodeChange[],
  instance: NodeChange,
  saved: SavedInstance
): void {
  if (instance.size) {
    instance.size = { ...instance.size, x: saved.width }
  }
  for (const entry of derivedSymbolDataOf(instance)) {
    const bounds = saved.layers[targetName(records, entry)]
    if (bounds) {
      saveBounds(entry, bounds)
    }
  }
}

export async function archiveWithSavedLayout(
  source: SceneGraph,
  instances: Record<string, SavedInstance>
): Promise<Uint8Array> {
  await initCodec()
  const parsed = parseFigBuffer((await exportFigFile(source)).slice().buffer as ArrayBuffer)
  const records = parsed.nodeChanges
  for (const record of records) {
    const saved = instances[record.name ?? '']
    if (saved) {
      saveInstanceLayout(records, record, saved)
    }
  }
  const kiwi = getCompiledSchema().encodeMessage({
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges: records
  })
  const thumbnail = parsed.thumbnailPNG
  if (!thumbnail) {
    throw new Error('Missing thumbnail')
  }
  return compressFigDataSync(
    deflateSync(getSchemaBytes()),
    kiwi,
    thumbnail,
    parsed.metaJSON ?? '{}',
    []
  )
}

export async function openLaidOut(bytes: Uint8Array): Promise<SceneGraph> {
  const graph = await parseFigFile(bytes.slice().buffer as ArrayBuffer)
  populateAllFigPages(graph)
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph))
  return graph
}
