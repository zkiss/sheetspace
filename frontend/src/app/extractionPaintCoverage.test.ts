import { describe, expect, it } from 'vitest';
import { extractionPaintCoverage, sourceApertureOutsideSurface, visibleExtractionCoverage } from './extractionPaintCoverage';
import { sheetDocument } from '@test-support/workbookFactories';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function element(parent: Element, className: string, bounds: DOMRect, key?: string, text = '') {
  const result = document.createElement('div');
  result.className = className;
  if (key) result.dataset.cellKey = key;
  result.textContent = text;
  result.getBoundingClientRect = () => bounds;
  parent.append(result);
  return result;
}

function setup() {
  const surface = document.createElement('div');
  surface.getBoundingClientRect = () => rect(0, 0, 500, 500);
  const source = element(surface, 'source', rect(0, 0, 300, 300));
  const target = element(surface, 'target', rect(0, 0, 300, 300));
  for (const frame of [source, target]) {
    element(frame, 'sheet-frame-body', rect(0, 0, 300, 300));
    element(frame, 'sheet-grid-corner', rect(0, 0, 40, 26));
  }
  const range = { start: { rowIndex: 1, columnIndex: 1 }, end: { rowIndex: 1, columnIndex: 2 } };
  element(source, '', rect(40, 26, 80, 26), 'B2', 'first');
  element(source, '', rect(120, 26, 80, 26), 'C2', 'second');
  element(target, '', rect(40, 26, 80, 26), 'A1', 'first');
  const last = element(target, '', rect(120, 26, 80, 26), 'B1', 'second');
  return { surface, source, target, range, last };
}

describe('committed extraction paint coverage', () => {
  it('checks only visible cells of a large selection and retires a selection scrolled out of view', () => {
    const { surface, source, target } = setup();
    source.querySelectorAll('[data-cell-key]').forEach((cell) => cell.remove());
    target.querySelectorAll('[data-cell-key]').forEach((cell) => cell.remove());
    const body = source.querySelector<HTMLElement>('.sheet-frame-body')!;
    Object.defineProperty(body, 'offsetWidth', { value: 300 });
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 200, columnCount: 200 });
    const range = { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 199, columnIndex: 199 } };
    surface.getBoundingClientRect = () => rect(40, 26, 76, 26.4);
    element(source, '', rect(40, 26, 76, 26.4), 'A1', 'value');
    const targetCell = element(target, '', rect(40, 26, 76, 26.4), 'A1', 'value');
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
    targetCell.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    target.append(targetCell);
    targetCell.textContent = 'incorrect';
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    targetCell.textContent = 'value';
    source.querySelector('[data-cell-key="A1"]')?.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    body.scrollTop = 100;
    const firstOnly = { start: range.start, end: range.start };
    expect(visibleExtractionCoverage(surface, source, target, firstOnly, sheet)).toBe('empty');
    surface.getBoundingClientRect = () => rect(0, 0, 0, 0);
    expect(visibleExtractionCoverage(surface, source, target, firstOnly, sheet)).toBe('unknown');
  });
  it('requires every visible mapped cell with matching text and geometry', () => {
    const { surface, source, target, range, last } = setup();
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(true);
    last.remove();
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(false);
    target.append(last);
    last.textContent = 'wrong';
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(false);
    last.textContent = 'second';
    last.getBoundingClientRect = () => rect(125, 26, 80, 26);
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(false);
  });

  it('does not infer offscreen or readiness from missing source cells or an unmeasured surface', () => {
    const { surface, source, target, range } = setup();
    source.querySelector('[data-cell-key="C2"]')?.remove();
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(false);
    surface.getBoundingClientRect = () => rect(0, 0, 0, 0);
    expect(extractionPaintCoverage(surface, source, target, range)).toBe(false);
  });

  it('recognizes a clipped source aperture without treating unknown or partially visible geometry as empty', () => {
    const { surface, source } = setup();
    expect(sourceApertureOutsideSurface(surface, source)).toBe(false);
    surface.getBoundingClientRect = () => rect(400, 400, 100, 100);
    expect(sourceApertureOutsideSurface(surface, source)).toBe(true);
    surface.getBoundingClientRect = () => rect(250, 250, 100, 100);
    expect(sourceApertureOutsideSurface(surface, source)).toBe(false);
    surface.getBoundingClientRect = () => rect(400, 400, 0, 0);
    expect(sourceApertureOutsideSurface(surface, source)).toBe(false);
  });
});
