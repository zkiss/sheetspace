import type { SheetDocument, SheetFormatOverrides } from '@workbook/core/model';

export const BUILT_IN_COLOURS = ['#1f2933', '#52636b', '#2f747e', '#23855d', '#3267a8', '#73459a', '#b4456b', '#c85b27', '#c99c00', '#d84b4b'] as const;

export function sheetCustomColours(sheet: SheetDocument | undefined) {
  return customColoursForOverrides(sheet?.presentation.formatOverrides);
}

/** Sheet-level derivation; callers memoize this independently from selection data. */
export function customColoursForOverrides(overrides: SheetFormatOverrides | undefined) {
  const seen = new Set<string>();
  for (const group of [overrides?.rows, overrides?.columns, overrides?.cells]) {
    for (const override of Object.values(group ?? {})) {
      for (const colour of [override.textColor, override.fillColor]) {
        const normalized = colour?.toLowerCase();
        if (normalized?.startsWith('#') && !BUILT_IN_COLOURS.includes(normalized as typeof BUILT_IN_COLOURS[number])) seen.add(normalized);
      }
    }
  }
  return [...seen].sort(comparePaletteOrder);
}

function comparePaletteOrder(first: string, second: string) {
  const hue = (colour: string) => {
    const value = Number.parseInt(colour.slice(1), 16);
    const red = (value >> 16) / 255;
    const green = ((value >> 8) & 255) / 255;
    const blue = (value & 255) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max === min) return 361;
    return 60 * ((max === red ? (green - blue) / (max - min) : max === green ? 2 + (blue - red) / (max - min) : 4 + (red - green) / (max - min)) + 6) % 360;
  };
  return hue(first) - hue(second) || first.localeCompare(second);
}
