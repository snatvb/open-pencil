import type { CanvasKit } from '@open-pencil/canvaskit'
import type { Fill } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

export const LEFT_COLOUR = [250, 245, 230] as const
export const RIGHT_COLOUR = [40, 90, 200] as const

const KNUTH_MULTIPLICATIVE_HASH = 2654435761

export interface TestImage {
  width: number
  height: number
  pixels: Uint8Array<ArrayBuffer>
}

export function rgbaInfo(ck: CanvasKit, width: number, height: number) {
  return {
    width,
    height,
    alphaType: ck.AlphaType.Unpremul,
    colorType: ck.ColorType.RGBA_8888,
    colorSpace: ck.ColorSpace.SRGB
  }
}

export function twoColourImage(size: number): TestImage {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels.set([...(x < size / 2 ? LEFT_COLOUR : RIGHT_COLOUR), 255], (y * size + x) * 4)
    }
  }
  return { width: size, height: size, pixels }
}

export function stripesImage(size: number): TestImage {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels.set([...(x % 2 === 0 ? LEFT_COLOUR : RIGHT_COLOUR), 255], (y * size + x) * 4)
    }
  }
  return { width: size, height: size, pixels }
}

/** The source pixels whose square holds `centre`: two at an edge between them, where rounding picks. */
function nearestSources(centre: number, count: number): number[] {
  const source = Math.floor(centre)
  const onEdge = Number.isInteger(centre) && source > 0
  return onEdge ? [source - 1, Math.min(source, count - 1)] : [Math.min(source, count - 1)]
}

export function pixelsNotNearestAtCentres(
  output: Uint8Array,
  image: TestImage,
  width: number,
  height: number
): number {
  let wrong = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const columns = nearestSources(((x + 0.5) * image.width) / width, image.width)
      const rows = nearestSources(((y + 0.5) * image.height) / height, image.height)
      const matches = rows.some((row) =>
        columns.some((column) => {
          const from = (row * image.width + column) * 4
          return [0, 1, 2, 3].every(
            (channel) => output[at + channel] === image.pixels[from + channel]
          )
        })
      )
      wrong += matches ? 0 : 1
    }
  }
  return wrong
}

export function noiseImage(width: number, height: number): TestImage {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index++) {
    pixels[index] = index % 4 === 3 ? 255 : Math.imul(index + 1, KNUTH_MULTIPLICATIVE_HASH) >>> 24
  }
  return { width, height, pixels }
}

export function encodeImage(ck: CanvasKit, image: TestImage): Uint8Array {
  const decoded = expectDefined(
    ck.MakeImage(rgbaInfo(ck, image.width, image.height), image.pixels, image.width * 4),
    'test image'
  )
  try {
    return expectDefined(decoded.encodeToBytes(ck.ImageFormat.PNG, 100), 'test PNG')
  } finally {
    decoded.delete()
  }
}

export function imageFill(imageHash: string, fill: Partial<Fill> = {}): Fill {
  return {
    type: 'IMAGE',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true,
    imageHash,
    imageScaleMode: 'FILL',
    ...fill
  }
}

function colourKey(pixels: Uint8Array, offset: number): number {
  return (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]
}

export function shareOfImageColours(output: Uint8Array, image: TestImage): number {
  const colours = new Set<number>()
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    colours.add(colourKey(image.pixels, offset))
  }
  let opaque = 0
  let matching = 0
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] !== 255) {
      continue
    }
    opaque++
    matching += colours.has(colourKey(output, offset)) ? 1 : 0
  }
  return opaque === 0 ? 0 : matching / opaque
}
