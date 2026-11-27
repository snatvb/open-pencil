import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import type { CanvasKit } from '@open-pencil/canvaskit'
import { withOffscreenRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { fontManager } from '@open-pencil/core/text'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { svgDataURL } from '@open-pencil/scene-graph/images'
import { repoPath } from '@open-pencil/test-support/paths'

export type RGB = [number, number, number]

export interface Raster {
  width: number
  data: number[]
}

export function pixel(raster: Raster, x: number, y: number): RGB {
  const offset = (y * raster.width + x) * 4
  return [raster.data[offset], raster.data[offset + 1], raster.data[offset + 2]]
}

function decodedRaster(ck: CanvasKit, png: Uint8Array): Raster {
  const image = ck.MakeImageFromEncoded(png)
  if (!image) {
    throw new Error('canvas render does not decode')
  }
  try {
    const pixels = image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
    if (!(pixels instanceof Uint8Array)) {
      throw new TypeError('no 8-bit canvas pixels')
    }
    return { width: image.width(), data: Array.from(pixels) }
  } finally {
    image.delete()
  }
}

export async function canvasRaster(
  graph: SceneGraph,
  pageId: string,
  frameId: string,
  interStyle: string
): Promise<Raster> {
  const ck = await getCanvasKit()
  const inter = readFileSync(repoPath('packages/core/assets/InterVariable.ttf'))
  await fontManager.markLoaded('Inter', interStyle, new Uint8Array(inter).buffer)
  const raster = await withOffscreenRenderer(ck, async (renderer) => {
    const png = renderNodesToImage(ck, renderer, graph, pageId, [frameId], {
      scale: 1,
      format: 'PNG'
    })
    if (!png) {
      throw new Error('no canvas render')
    }
    return decodedRaster(ck, png)
  })
  if (!raster) {
    throw new Error('no offscreen renderer')
  }
  return raster
}

export async function browserRaster(page: Page, svg: string): Promise<Raster> {
  return page.evaluate(async (url) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('no 2D context')
    }
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, data: Array.from(data) }
  }, svgDataURL(svg))
}
