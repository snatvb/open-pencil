import type { Path } from 'canvaskit-wasm'

import type { SceneNode, VectorNetwork, VectorSegment } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { unitePaths } from '#core/canvas/shapes'
import { getStrokeCapEntity, getStrokeJoinEntity } from '#core/canvas/strokes'
import { addStrokeRunToPath, strokeRuns } from '#core/vector'

type Stroke = SceneNode['strokes'][0]

function regionsPerSegment(network: VectorNetwork): number[] {
  const counts = network.segments.map(() => 0)
  for (const region of network.regions) {
    for (const index of new Set(region.loops.flat())) {
      counts[index]++
    }
  }
  return counts
}

function strokedRuns(
  r: SkiaRenderer,
  network: VectorNetwork,
  segments: VectorSegment[],
  options: Parameters<Path['makeStroked']>[0]
): Path[] {
  return strokeRuns(segments).flatMap((run) => {
    const builder = new r.ck.PathBuilder()
    addStrokeRunToPath(builder, run, segments, network.vertices)
    const centerline = builder.detachAndDelete()
    const outline = centerline.makeStroked(options)
    centerline.delete()
    return outline ? [outline] : []
  })
}

// Figma strokes a segment that several regions share at its own weight, even on a stroke taking a side.
export function regionStrokeOutlines(
  r: SkiaRenderer,
  node: SceneNode,
  network: VectorNetwork,
  stroke: Stroke,
  sided: boolean
): Path[] {
  const counts = regionsPerSegment(network)
  const options = (width: number) => ({
    width,
    miter_limit: node.strokeMiterLimit,
    cap: getStrokeCapEntity(r, stroke.cap ?? 'NONE'),
    join: getStrokeJoinEntity(r, stroke.join ?? 'MITER')
  })
  const bounding = (test: (regions: number) => boolean) =>
    network.segments.filter((_, index) => test(counts[index]))
  const outlines = sided
    ? [
        ...strokedRuns(
          r,
          network,
          bounding((regions) => regions === 1),
          options(stroke.weight * 2)
        ),
        ...strokedRuns(
          r,
          network,
          bounding((regions) => regions > 1),
          options(stroke.weight)
        )
      ]
    : strokedRuns(
        r,
        network,
        bounding((regions) => regions > 0),
        options(stroke.weight)
      )
  if (outlines.length <= 1) {
    return outlines
  }
  const united = unitePaths(r, outlines)
  if (!united) {
    return outlines
  }
  for (const outline of outlines) {
    outline.delete()
  }
  return [united]
}
