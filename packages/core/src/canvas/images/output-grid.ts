import type { Shader } from '@open-pencil/canvaskit'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { getWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import Matrix, { type Mat3 } from '@open-pencil/scene-graph/matrix'

import { compiledProgram } from '#core/canvas/renderer/shaders'
import type { SkiaRenderer } from '#core/canvas/renderer/skia'
import { defineShader, type Float3 } from '#core/canvas/sksl'

import outputGridSource from './output-grid.sksl?raw'

interface OutputGridUniforms {
  outputFromLocalX: Float3
  outputFromLocalY: Float3
  localFromOutputX: Float3
  localFromOutputY: Float3
}

const OUTPUT_GRID = defineShader<OutputGridUniforms>('output pixel grid', outputGridSource)

function affineRows(matrix: Mat3): [Float3, Float3] {
  return [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[3], matrix[4], matrix[5]]
  ]
}

/** Figma's export takes one image sample per output pixel, so supersampling must not blend two. */
export function sampledOncePerOutputPixel(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph,
  image: Shader
): Shader | null {
  const output = r.images.supersampledOutput
  if (!output) {
    return null
  }
  const outputFromLocal = Matrix.multiply(output.outputFromWorld, getWorldMatrix(node, graph))
  const localFromOutput = Matrix.invert(outputFromLocal)
  if (!localFromOutput) {
    return null
  }
  const [outputFromLocalX, outputFromLocalY] = affineRows(outputFromLocal)
  const [localFromOutputX, localFromOutputY] = affineRows(localFromOutput)
  const program = compiledProgram(r.ck, r.shaders, OUTPUT_GRID)
  return program.effect.makeShaderWithChildren(
    program.uniforms({ outputFromLocalX, outputFromLocalY, localFromOutputX, localFromOutputY }),
    [image]
  )
}
