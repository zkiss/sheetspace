import type { CSSProperties } from 'react';

/** Pick the higher-contrast black/white foreground for a six-digit sRGB colour. */
export function colourSymbolForeground(colour: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(colour.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  // Contrast ratios cross at sqrt(1.05 * 0.05) - 0.05.
  return luminance > Math.sqrt(0.0525) - 0.05 ? '#000000' : '#ffffff';
}

export function ColourPurposeSwatch({ colour, purpose }: { colour: string; purpose: 'text' | 'fill' }) {
  return <span aria-hidden="true" className="colour-picker-trigger-swatch" style={{
    '--colour-swatch': colour,
    color: colourSymbolForeground(colour),
  } as CSSProperties}>
    <svg viewBox="0 0 16 16" data-colour-purpose={purpose}>
      {purpose === 'text'
        ? <text x="8" y="13" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="700">A</text>
        : <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <g transform="rotate(-40 6.5 7.5)">
            <path d="M3.5 5.5v6c0 1.8 6 1.8 6 0v-6M4 5V3.5a2.5 2.5 0 0 1 5 0V5" />
            <ellipse cx="6.5" cy="5.5" rx="3" ry="1.2" />
          </g>
          <path d="M10 4.8c2 0 3 1 3 3v1" />
          <path d="M13 10c-.5 1-1.5 2-1.5 3a1.5 1.5 0 0 0 3 0c0-1-1-2-1.5-3Z" fill="currentColor" stroke="none" />
        </g>}
    </svg>
  </span>;
}
