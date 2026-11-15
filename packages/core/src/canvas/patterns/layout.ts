import type { Fill } from '@open-pencil/scene-graph'

export function patternTileKey(sourceId: string, fill: Fill): string {
  const spacing = fill.patternSpacing ?? { x: 0, y: 0 }
  return [
    sourceId,
    fill.scale ?? 1,
    spacing.x,
    spacing.y,
    fill.patternTileType ?? 'RECTANGULAR',
    fill.horizontalAlignment ?? 'START',
    fill.verticalAlignment ?? 'START'
  ].join(':')
}
