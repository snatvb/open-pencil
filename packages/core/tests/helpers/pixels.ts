import type { CanvasKit, Image } from '@open-pencil/canvaskit'
import { expectDefined } from '@open-pencil/test-support/assert'

export function unpremultipliedPixels(ck: CanvasKit, image: Image) {
  return expectDefined(
    image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB
    }),
    'pixels'
  )
}
