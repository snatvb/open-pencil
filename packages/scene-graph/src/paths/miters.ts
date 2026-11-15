import type { Vector } from '../primitives'
import type { StrokeJoin, VectorNetwork, VectorSegment } from '../types'
import { leavingDirection, segmentsByVertex } from './network'

/**
 * How far past half the stroke the sharpest mitered corner reaches, as a multiple: a corner of
 * angle θ mitres out to 1/sin(θ/2), unless that passes the miter limit and it bevels instead.
 * Any two segment ends at a vertex can be a corner: a region's loop, a region stroke, or an open
 * chain can turn between any pair of them at a junction, not only between neighbours.
 */
export function miterRatio(
  network: VectorNetwork,
  join: StrokeJoin | undefined,
  limit = 4
): number {
  let ratio = 1
  for (const [vertex, indices] of segmentsByVertex(network.segments)) {
    if ((network.vertices[vertex].strokeJoin ?? join ?? 'MITER') !== 'MITER') {
      continue
    }
    const miter = sharpestMiterAt(network, vertex, indices, limit)
    ratio = Math.max(ratio, miter)
  }
  return ratio
}

function sharpestMiterAt(
  network: VectorNetwork,
  vertex: number,
  indices: number[],
  limit: number
): number {
  if (indices.length === 2 && !indices.some((index) => isSelfLoop(network.segments[index]))) {
    const miter = miterOf(
      leavingDirection(network, indices[0], vertex),
      leavingDirection(network, indices[1], vertex)
    )
    return miter <= limit ? miter : 1
  }
  const ends = endDirections(network, vertex, indices)
  let sharpest = 1
  for (let first = 0; first < ends.length; first++) {
    for (let second = first + 1; second < ends.length; second++) {
      const miter = miterOf(ends[first], ends[second])
      if (miter <= limit) {
        sharpest = Math.max(sharpest, miter)
      }
    }
  }
  return sharpest
}

function isSelfLoop(segment: VectorSegment): boolean {
  return segment.start === segment.end
}

function endDirections(network: VectorNetwork, vertex: number, indices: number[]): Vector[] {
  const ends: Vector[] = []
  for (const index of indices) {
    ends.push(leavingDirection(network, index, vertex))
    const segment = network.segments[index]
    if (isSelfLoop(segment)) {
      ends.push(selfLoopClosingDirection(segment))
    }
  }
  return ends.filter((direction) => direction.x !== 0 || direction.y !== 0)
}

function selfLoopClosingDirection(segment: VectorSegment): Vector {
  const { tangentEnd, tangentStart } = segment
  return tangentEnd.x !== 0 || tangentEnd.y !== 0 ? tangentEnd : tangentStart
}

function miterOf(a: Vector, b: Vector): number {
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)
  if (lengths === 0) {
    return 1
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / lengths)))
  return 1 / Math.sin(angle / 2)
}
