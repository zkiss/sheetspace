import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('axis flight styles', () => {
  it('matches real axis motion and scales from the top left', () => {
    const styles = fs.readFileSync('src/grid/SheetGrid.css', 'utf8');
    expect(styles).toMatch(/animation:\s*axis-gather-flight 220ms ease-out both/);
    expect(styles).toMatch(/transform-origin:\s*top left/);
    expect(styles).toContain('translate(var(--flight-to-x), var(--flight-to-y)) scale(var(--flight-scale-x), var(--flight-scale-y))');
  });
});
