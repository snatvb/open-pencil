import type { Path } from 'canvaskit-wasm'

import type { SceneNode, VectorNetwork } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { unitePaths } from '#core/canvas/shapes'
import { getStrokeCapEntity, getStrokeJoinEntity } from '#core/canvas/strokes'
import { addStrokeRunToPath, strokeRuns } from '#core/vector'

type Stroke = SceneNode['strokes'][0]
type Partners = Map<number, Map<number, number>>
type FillTest = (x: number, y: number) => boolean

const GAP_PROBE_DISTANCE = 0.25

function regionsPerSegment(network: VectorNetwork): number[] {
  const counts = network.segments.map(() => 0)
  for (const region of network.regions) {
    for (const index of new Set(region.loops.flat())) {
      counts[index]++
    }
  }
  return counts
}

function leavingDirection(network: VectorNetwork, segmentIndex: number, vertex: number): Vector {
  const segment = network.segments[segmentIndex]
  const forward = segment.start === vertex
  const handle = forward ? segment.tangentStart : segment.tangentEnd
  if (handle.x !== 0 || handle.y !== 0) {
    return handle
  }
  const from = network.vertices[vertex]
  const to = network.vertices[forward ? segment.end : segment.start]
  return { x: to.x - from.x, y: to.y - from.y }
}

function regionSegmentsByVertex(network: VectorNetwork, counts: number[]): Map<number, number[]> {
  const byVertex = new Map<number, number[]>()
  const meet = (vertex: number, index: number) => {
    const list = byVertex.get(vertex)
    if (list) {
      list.push(index)
    } else {
      byVertex.set(vertex, [index])
    }
  }
  for (const [index, segment] of network.segments.entries()) {
    if (counts[index] === 0 || segment.start === segment.end) {
      continue
    }
    meet(segment.start, index)
    meet(segment.end, index)
  }
  return byVertex
}

function pairAcrossUnfilledGaps(
  network: VectorNetwork,
  vertex: number,
  meeting: number[],
  isFilled: FillTest
): Map<number, number> {
  const ends = meeting
    .map((segment) => {
      const direction = leavingDirection(network, segment, vertex)
      return {
        segment,
        angle: Math.atan2(direction.y, direction.x),
        reach: Math.hypot(direction.x, direction.y)
      }
    })
    .sort((a, b) => a.angle - b.angle)
  const origin = network.vertices[vertex]
  const partners = new Map<number, number>()
  for (const [index, end] of ends.entries()) {
    const next = ends[(index + 1) % ends.length]
    if (partners.has(end.segment) || partners.has(next.segment)) {
      continue
    }
    const sweep = (next.angle - end.angle + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
    const middle = end.angle + sweep / 2
    const distance = Math.min(GAP_PROBE_DISTANCE, end.reach / 2, next.reach / 2)
    const gapFilled = isFilled(
      origin.x + Math.cos(middle) * distance,
      origin.y + Math.sin(middle) * distance
    )
    if (!gapFilled) {
      partners.set(end.segment, next.segment)
      partners.set(next.segment, end.segment)
    }
  }
  return partners
}

function outlinePartners(network: VectorNetwork, counts: number[], isFilled: FillTest): Partners {
  const partners: Partners = new Map()
  for (const [vertex, meeting] of regionSegmentsByVertex(network, counts)) {
    if (meeting.length === 2) {
      partners.set(
        vertex,
        new Map([
          [meeting[0], meeting[1]],
          [meeting[1], meeting[0]]
        ])
      )
    } else if (meeting.length > 2) {
      partners.set(vertex, pairAcrossUnfilledGaps(network, vertex, meeting, isFilled))
    }
  }
  return partners
}

function strokedSegments(
  r: SkiaRenderer,
  network: VectorNetwork,
  members: number[],
  partners: Partners,
  options: Parameters<Path['makeStroked']>[0]
): Path | null {
  if (members.length === 0) {
    return null
  }
  const local = new Map(members.map((segment, index) => [segment, index]))
  const segments = members.map((index) => network.segments[index])
  const runs = strokeRuns(segments, (vertex, from) => {
    const partner = partners.get(vertex)?.get(members[from])
    return partner === undefined ? undefined : local.get(partner)
  })
  const builder = new r.ck.PathBuilder()
  for (const run of runs) {
    addStrokeRunToPath(builder, run, segments, network.vertices)
  }
  const centerline = builder.detachAndDelete()
  const outline = centerline.makeStroked(options)
  centerline.delete()
  return outline
}

function united(r: SkiaRenderer, outlines: Path[]): Path | null {
  const path = unitePaths(r, outlines)
  for (const outline of outlines) {
    outline.delete()
  }
  return path
}

// Figma strokes a segment several regions share at its own weight, even on a stroke taking a side.
export function regionStrokeOutline(
  r: SkiaRenderer,
  node: SceneNode,
  network: VectorNetwork,
  fills: Path[],
  stroke: Stroke,
  sided: boolean
): Path | null {
  const counts = regionsPerSegment(network)
  const partners = outlinePartners(network, counts, (x, y) =>
    fills.some((fill) => fill.contains(x, y))
  )
  const options = (width: number) => ({
    width,
    miter_limit: node.strokeMiterLimit,
    cap: getStrokeCapEntity(r, 'NONE'),
    join: getStrokeJoinEntity(r, stroke.join ?? 'MITER')
  })
  const indexes = network.segments.map((_, index) => index)
  const bounding = indexes.filter((index) => counts[index] > 0)
  const ownedByOne = indexes.filter((index) => counts[index] === 1)
  const anyShared = ownedByOne.length < bounding.length
  const plain = !sided || anyShared ? bounding : []
  const doubled = sided ? ownedByOne : []
  const outlines = [
    strokedSegments(r, network, plain, partners, options(stroke.weight)),
    strokedSegments(r, network, doubled, partners, options(stroke.weight * 2))
  ].filter((outline) => outline !== null)
  return outlines.length > 1 ? united(r, outlines) : (outlines[0] ?? null)
}
