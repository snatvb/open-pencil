import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { promiseTimeout } from '@vueuse/core'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { recentFileCoverEntry, shownHomeCardCover } from '@/app/recent-files/thumbnails'
import {
  coverFromShownTiles,
  type CoverDocument,
  forgetOpenedFigCover,
  refreshOpenedFigCover
} from '@/app/tabs/open/cover'

const SHORT_LIMIT_MS = 500
const PROMPT_MS = 200

describe('recent file cover cache entry', () => {
  test('is one entry however the path spells its separators', async () => {
    const backslashed = await recentFileCoverEntry('C:\\Designs\\board.fig')
    const slashed = await recentFileCoverEntry('C:/Designs/board.fig')
    const redundant = await recentFileCoverEntry('C:/Designs/./board.fig')

    expect(slashed).toEqual(backslashed)
    expect(redundant).toEqual(backslashed)
    expect(await recentFileCoverEntry('C:/Designs/other.fig')).not.toEqual(backslashed)
  })
})

let ck: Awaited<ReturnType<typeof getCanvasKit>>
const cleanups: Array<() => void> = []

beforeAll(async () => {
  ck = await getCanvasKit()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

function squaresGraph() {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  for (let index = 0; index < 6; index++) {
    graph.createNode('RECTANGLE', page.id, { x: index * 120, y: 0, width: 100, height: 100 })
  }
  return { graph, pageId: page.id }
}

function canvasRenderer(pageId: string) {
  const surface = expectDefined(ck.MakeSurface(800, 400), 'surface')
  const made = new SkiaRenderer(ck, surface)
  made.pageId = pageId
  made.viewportWidth = 800
  made.viewportHeight = 400
  made.dpr = 1
  made.zoom = 1
  made.navigationPhase = 'idle'
  made.fontsLoaded = true
  cleanups.push(() => made.destroy())
  return made
}

function drawTiles(renderer: SkiaRenderer, graph: SceneGraph) {
  for (let frame = 0; frame < 60; frame++) {
    const result = renderer.tiledScene.renderFrame(
      renderer,
      renderer.surface.getCanvas(),
      graph,
      1,
      0
    )
    renderer.tiledSceneCovered = result.covered
    if (result.covered && !result.pending) {
      break
    }
  }
}

function openedDocument({ drawn }: { drawn: boolean }) {
  const { graph, pageId } = squaresGraph()
  const shown = canvasRenderer(pageId)
  if (drawn) {
    drawTiles(shown, graph)
  }
  let unsaved = false
  const document: CoverDocument = {
    graph,
    renderer: shown,
    canvasRenderers: [shown],
    hasUnsavedChanges: () => unsaved,
    state: { currentPageId: pageId, sceneVersion: 1 }
  }
  return {
    document,
    renderer: shown,
    pageId,
    edit: () => {
      graph.updateNode(expectDefined(graph.getChildren(pageId)[0], 'square').id, { x: 900 })
      unsaved = true
    }
  }
}

async function timed<T>(run: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now()
  const result = await run()
  return { result, ms: performance.now() - started }
}

describe('cover from the shown canvas', () => {
  test('reads the tiles of whichever canvas renderer drew the page', () => {
    const { graph, pageId } = squaresGraph()
    const overlays = canvasRenderer(pageId)
    const scene = canvasRenderer(pageId)
    drawTiles(scene, graph)
    const state = { sceneVersion: 1 }

    expect(shownHomeCardCover({ graph, canvasRenderers: [overlays], state })).toBeNull()
    expect(shownHomeCardCover({ graph, canvasRenderers: [overlays, scene], state })).not.toBeNull()
  })

  test('composes the cover from tiles that hold the page', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: true })

    expect(await coverFromShownTiles(document, renderer, pageId)).toBeInstanceOf(Uint8Array)
  })

  test('gives the cover once the tiles come to hold the page while it waits', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: false })
    setTimeout(() => drawTiles(renderer, document.graph), 300)

    expect(await coverFromShownTiles(document, renderer, pageId)).toBeInstanceOf(Uint8Array)
  })

  test('gives none when the tiles do not hold the page in time', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: false })

    const { result, ms } = await timed(() =>
      coverFromShownTiles(document, renderer, pageId, SHORT_LIMIT_MS)
    )

    expect(result).toBeNull()
    expect(ms).toBeGreaterThanOrEqual(SHORT_LIMIT_MS - 50)
    expect(ms).toBeLessThan(SHORT_LIMIT_MS * 2)
  })

  test('gives none at once while the document has unsaved changes', async () => {
    const { document, renderer, pageId, edit } = openedDocument({ drawn: true })
    edit()

    const { result, ms } = await timed(() => coverFromShownTiles(document, renderer, pageId))

    expect(result).toBeNull()
    expect(ms).toBeLessThan(PROMPT_MS)
  })

  test('gives none once the document is edited while it waits', async () => {
    const { document, renderer, pageId, edit } = openedDocument({ drawn: false })
    setTimeout(edit, 300)

    const { result, ms } = await timed(() => coverFromShownTiles(document, renderer, pageId))

    expect(result).toBeNull()
    expect(ms).toBeLessThan(1000)
  })

  test('gives none at once when no canvas presents sRGB', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: true })
    renderer.presentationColorSpace = 'display-p3'

    const { result, ms } = await timed(() => coverFromShownTiles(document, renderer, pageId))

    expect(result).toBeNull()
    expect(ms).toBeLessThan(PROMPT_MS)
  })

  test('ends when the tab closes while it waits', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: false })
    setTimeout(() => forgetOpenedFigCover(document), 300)

    const { result, ms } = await timed(() => coverFromShownTiles(document, renderer, pageId))

    expect(result).toBeNull()
    expect(ms).toBeLessThan(1000)
  })

  test('gives none when the canvas left the page', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: true })
    document.state.currentPageId = 'other-page'

    expect(await coverFromShownTiles(document, renderer, pageId)).toBeNull()
  })

  test('gives none when the renderer is destroyed', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: true })
    renderer.destroy()

    expect(await coverFromShownTiles(document, renderer, pageId)).toBeNull()
  })

  test('gives none when another renderer replaced the one it waited on', async () => {
    const { document, renderer, pageId } = openedDocument({ drawn: true })
    const replacement = canvasRenderer(pageId)
    drawTiles(replacement, document.graph)
    document.renderer = replacement
    document.canvasRenderers = [replacement]

    expect(await coverFromShownTiles(document, renderer, pageId)).toBeNull()
  })
})

describe('cover jobs', () => {
  test('a tab opening a file whose closed tab still waited gets its own cover job', async () => {
    const path = 'C:/Designs/reopened.fig'
    const closing = openedDocument({ drawn: false })
    closing.document.renderer = null
    refreshOpenedFigCover(path, closing.document)
    forgetOpenedFigCover(closing.document)

    const reopened = openedDocument({ drawn: false })
    reopened.document.renderer = null
    let read = false
    const { graph } = reopened.document
    Object.defineProperty(reopened.document, 'graph', {
      get: () => {
        read = true
        return graph
      }
    })
    refreshOpenedFigCover(path, reopened.document)
    cleanups.push(() => forgetOpenedFigCover(reopened.document))
    await promiseTimeout(50)

    expect(read).toBe(true)
  })

  test('a second request for a file whose tab is still open is skipped', async () => {
    const running = openedDocument({ drawn: false })
    running.document.renderer = null
    refreshOpenedFigCover('C:/Designs/shown.fig', running.document)
    cleanups.push(() => forgetOpenedFigCover(running.document))

    const again = openedDocument({ drawn: false })
    let read = false
    const { graph } = again.document
    Object.defineProperty(again.document, 'graph', {
      get: () => {
        read = true
        return graph
      }
    })
    refreshOpenedFigCover('C:\\Designs\\shown.fig', again.document)
    await promiseTimeout(50)

    expect(read).toBe(false)
  })
})
