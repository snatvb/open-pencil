import type { SceneNode } from '@open-pencil/scene-graph'

/** Turns read from a file's transform carry float noise, such as 90.0000025 for a quarter. */
const TURN_TOLERANCE_DEGREES = 0.01

export type Turn = 'none' | 'half' | 'quarter' | 'oblique'

function nearMultipleOf(degrees: number, step: number): boolean {
  const rest = Math.abs(degrees % step)
  return Math.min(rest, step - rest) < TURN_TOLERANCE_DEGREES
}

export function turnOf(node: Pick<SceneNode, 'rotation'>): Turn {
  if (nearMultipleOf(node.rotation, 360)) {
    return 'none'
  }
  if (nearMultipleOf(node.rotation, 180)) {
    return 'half'
  }
  if (nearMultipleOf(node.rotation, 90)) {
    return 'quarter'
  }
  return 'oblique'
}

export function isTurned(node: Pick<SceneNode, 'rotation'>): boolean {
  return turnOf(node) !== 'none'
}

export function keepsOwnAxes(node: Pick<SceneNode, 'rotation'>): boolean {
  const turn = turnOf(node)
  return turn === 'none' || turn === 'half'
}

export function ownAxisAlong(
  node: Pick<SceneNode, 'rotation'>,
  axis: 'width' | 'height'
): 'width' | 'height' | null {
  const turn = turnOf(node)
  if (turn === 'oblique') {
    return null
  }
  if (turn === 'quarter') {
    return axis === 'width' ? 'height' : 'width'
  }
  return axis
}
