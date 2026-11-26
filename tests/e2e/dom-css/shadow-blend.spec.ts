import type { Page } from '@playwright/test'
import { fromUint8Array } from 'js-base64'

import { renderNodesToHTML } from '@open-pencil/core/io/formats/html'
import { SceneGraph, type BlendMode } from '@open-pencil/scene-graph'

import { expect, test } from '../fixtures'

const BACKDROP = { r: 0.2, g: 0.6, b: 1, a: 1 }
const SHADOW = { r: 1, g: 0.5, b: 0, a: 1 }

function sharpShadowOver(blendMode: BlendMode): { graph: SceneGraph; frameId: string } {
  const graph = new SceneGraph()
  const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 120,
    height: 60,
    fills: [{ type: 'SOLID', color: BACKDROP, opacity: 1, visible: true }]
  })
  graph.createNode('RECTANGLE', frame.id, {
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    effects: [
      {
        type: 'DROP_SHADOW',
        radius: 0,
        spread: 0,
        offset: { x: 50, y: 0 },
        color: SHADOW,
        visible: true,
        blendMode
      }
    ]
  })
  return { graph, frameId: frame.id }
}

const NEIGHBOUR = { r: 0.2, g: 0.8, b: 0.2, a: 1 }

function shadowUnderLaterSibling(): { graph: SceneGraph; frameId: string } {
  const graph = new SceneGraph()
  const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 120,
    height: 60,
    layoutMode: 'HORIZONTAL',
    paddingLeft: 10,
    paddingTop: 10,
    fills: [{ type: 'SOLID', color: BACKDROP, opacity: 1, visible: true }]
  })
  graph.createNode('RECTANGLE', frame.id, {
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    effects: [
      {
        type: 'DROP_SHADOW',
        radius: 0,
        spread: 0,
        offset: { x: 50, y: 0 },
        color: SHADOW,
        visible: true,
        blendMode: 'MULTIPLY'
      }
    ]
  })
  graph.createNode('RECTANGLE', frame.id, {
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: NEIGHBOUR, opacity: 1, visible: true }]
  })
  return { graph, frameId: frame.id }
}

async function pixelOf(
  page: Page,
  { graph, frameId }: { graph: SceneGraph; frameId: string }
): Promise<number[]> {
  const { html } = await renderNodesToHTML(graph, [frameId], { html: 'fragment' })
  await page.setContent(`<body style="margin: 0">${html}</body>`)
  const shot = await page.screenshot({ clip: { x: 80, y: 30, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const copy = document.createElement('canvas')
    copy.width = image.width
    copy.height = image.height
    const context = copy.getContext('2d')
    if (!context) {
      throw new Error('No 2D context')
    }
    context.drawImage(image, 0, 0)
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
    return [red, green, blue]
  }, fromUint8Array(shot))
}

const byte = (channel: number) => Math.round(channel * 255)

test.describe('blended shadows in DOM/CSS export, as the canvas blends them', () => {
  test('a multiply shadow darkens the backdrop instead of covering it', async ({ page }) => {
    const multiplied = [
      byte(BACKDROP.r * SHADOW.r),
      byte(BACKDROP.g * SHADOW.g),
      byte(BACKDROP.b * SHADOW.b)
    ]
    const pixel = await pixelOf(page, sharpShadowOver('MULTIPLY'))
    pixel.forEach((channel, index) => {
      expect(Math.abs(channel - (multiplied[index] ?? 0))).toBeLessThanOrEqual(2)
    })
  })

  test('a normal shadow still covers the backdrop', async ({ page }) => {
    const pixel = await pixelOf(page, sharpShadowOver('NORMAL'))
    expect(pixel).toEqual([byte(SHADOW.r), byte(SHADOW.g), byte(SHADOW.b)])
  })

  test('a later sibling paints over the blended shadow', async ({ page }) => {
    const pixel = await pixelOf(page, shadowUnderLaterSibling())
    expect(pixel).toEqual([byte(NEIGHBOUR.r), byte(NEIGHBOUR.g), byte(NEIGHBOUR.b)])
  })
})
