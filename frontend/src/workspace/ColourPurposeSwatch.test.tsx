import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { colourSymbolForeground, ColourPurposeSwatch } from './ColourPurposeSwatch';

describe('colour purpose contrast', () => {
  it.each([
    ['#000000', '#ffffff'], ['#ffffff', '#000000'],
    ['#1f2933', '#ffffff'], ['#52636b', '#ffffff'],
    ['#2f747e', '#ffffff'], ['#23855d', '#000000'],
    ['#3267a8', '#ffffff'], ['#73459a', '#ffffff'],
    ['#b4456b', '#ffffff'], ['#c85b27', '#000000'],
    ['#c99c00', '#000000'], ['#d84b4b', '#000000'],
    ['#123456', '#ffffff'], ['#abcdef', '#000000'],
    ['#ff0000', '#000000'], ['#00ff00', '#000000'], ['#0000ff', '#ffffff'],
    ['#ABCDEF', '#000000'], ['#1F2933', '#ffffff'],
  ])('uses %s with a %s symbol', (background, foreground) => {
    expect(colourSymbolForeground(background)).toBe(foreground);
  });

  it('renders distinct decorative text and pouring-can symbols on identical backgrounds', () => {
    const { container } = render(<>
      <ColourPurposeSwatch colour="#000000" purpose="text" />
      <ColourPurposeSwatch colour="#000000" purpose="fill" />
    </>);
    const swatches = container.querySelectorAll('.colour-picker-trigger-swatch');
    for (const swatch of swatches) {
      expect(swatch).toHaveAttribute('aria-hidden', 'true');
      expect(swatch).toHaveStyle('--colour-swatch: #000000; color: #ffffff');
      expect(swatch.querySelectorAll('button, [tabindex]')).toHaveLength(0);
    }
    expect(swatches[0].querySelector('text')).toHaveTextContent('A');
    expect(swatches[1].querySelector('text')).toBeNull();
    expect(swatches[1].querySelector('ellipse')).toBeInTheDocument();
    expect(swatches[1].querySelector('g[transform]')).toHaveAttribute('transform', 'rotate(-40 6.5 7.5)');
    expect(swatches[1].querySelector('path[fill="currentColor"]')).toBeInTheDocument();
    for (const svg of container.querySelectorAll('svg')) expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
  });
});
