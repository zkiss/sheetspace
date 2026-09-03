export const FLOATING_OVERLAY_Z_INDEX = 10_000;

const DEFAULT_ROOT_FONT_SIZE_PX = 16;

export function cssRemFromPixels(pixels: number) {
  return `${pixels / DEFAULT_ROOT_FONT_SIZE_PX}rem`;
}
