import { describe, expect, it } from 'vitest';
import { visibleExtractionCoverage } from './extractionPaintCoverage';
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
  Object.defineProperty(source.querySelector('.sheet-frame-body')!, 'offsetWidth', { value: 300, configurable: true });
  const range = { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 0, columnIndex: 1 } };
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 10, columnCount: 10 });
  element(source, '', rect(40, 26, 76, 26.4), 'A1', 'first');
  element(source, '', rect(116, 26, 76, 26.4), 'B1', 'second');
  element(target, '', rect(40, 26, 76, 26.4), 'A1', 'first');
  const last = element(target, '', rect(116, 26, 76, 26.4), 'B1', 'second');
  return { surface, source, target, range, last, sheet };
}

describe('committed extraction paint coverage', () => {
  it('checks only visible cells of a large selection and retires a selection scrolled out of view', () => {
    const { surface, source, target } = setup();
    source.querySelectorAll('[data-cell-key]').forEach((cell) => cell.remove());
    target.querySelectorAll('[data-cell-key]').forEach((cell) => cell.remove());
    const body = source.querySelector<HTMLElement>('.sheet-frame-body')!;
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
    const { surface, source, target, range, last, sheet } = setup();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
    last.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    target.append(last);
    last.textContent = 'wrong';
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    last.textContent = 'second';
    last.getBoundingClientRect = () => rect(125, 26, 76, 26.4);
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
  });

  it('does not infer offscreen or readiness from missing source cells or missing geometry', () => {
    const { surface, source, target, range, sheet } = setup();
    source.querySelector('[data-cell-key="B1"]')?.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    source.querySelector('.sheet-grid-corner')?.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('unknown');
  });

  it('distinguishes unmeasured zero rectangles from explicitly hidden surfaces', () => {
    for (const selector of ['surface', '.sheet-frame-body', '.sheet-grid-corner']) {
      const { surface, source, target, range, sheet } = setup();
      document.body.append(surface);
      const hidden = selector === 'surface' ? surface : source.querySelector(selector)!;
      hidden.getBoundingClientRect = () => rect(0, 0, 0, 0);
      expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('unknown');
      (hidden as HTMLElement).style.display = 'none';
      expect(visibleExtractionCoverage(surface, source, target, range, sheet), selector).toBe('empty');
      surface.remove();
    }
  });

  it('requires only the fragments visible through both the surface and the scroll aperture', () => {
    const { surface, source, target, range, last, sheet } = setup();
    const body = source.querySelector<HTMLElement>('.sheet-frame-body')!;
    Object.defineProperty(body, 'clientWidth', { value: 116, configurable: true });
    last.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
    Object.defineProperty(body, 'clientWidth', { value: 300 });
    surface.getBoundingClientRect = () => rect(40, 26, 76, 26.4);
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
    surface.getBoundingClientRect = () => rect(40, 26, 77, 26.4);
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    surface.getBoundingClientRect = () => rect(400, 400, 100, 100);
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('empty');
  });

  it('rejects invisible target cells and target clipping of a visible source fragment', () => {
    const { surface, source, target, range, sheet } = setup();
    const cell = target.querySelector<HTMLElement>('[data-cell-key="A1"]')!;
    cell.style.opacity = '0';
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    cell.style.opacity = '1';
    const body = target.querySelector<HTMLElement>('.sheet-frame-body')!;
    Object.defineProperty(body, 'clientWidth', { value: 100 });
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
  });

  it('requires a missing middle fragment even when both ends are present', () => {
    const { surface, source, target, range, sheet } = setup();
    range.end.columnIndex = 2;
    element(source, '', rect(192, 26, 76, 26.4), 'C1', 'third');
    element(target, '', rect(192, 26, 76, 26.4), 'C1', 'third');
    target.querySelector('[data-cell-key="B1"]')?.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    element(target, '', rect(116, 26, 76, 26.4), 'B1', 'second');
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
  });

  it('maps custom axis sizes through fractional scale and scroll before clipping', () => {
    const { surface, source, target } = setup();
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 3,
      presentation: { rowHeights: { 's:row:1': 40 }, columnWidths: { 's:column:1': 100 } } });
    const range = { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 0, columnIndex: 1 } };
    surface.getBoundingClientRect = () => rect(50, 32.5, 125, 50);
    for (const frame of [source, target]) {
      const body = frame.querySelector<HTMLElement>('.sheet-frame-body')!;
      body.getBoundingClientRect = () => rect(0, 0, 375, 375);
      Object.defineProperty(body, 'offsetWidth', { value: 300, configurable: true });
      body.scrollLeft = 10;
      frame.querySelector('.sheet-grid-corner')!.getBoundingClientRect = () => rect(0, 0, 50, 32.5);
      frame.querySelectorAll('[data-cell-key]').forEach((cell) => cell.remove());
      element(frame, '', rect(37.5, 32.5, 125, 50), 'A1', 'first');
      element(frame, '', rect(162.5, 32.5, 95, 50), 'B1', 'second');
    }
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
    target.querySelector('[data-cell-key="B1"]')?.remove();
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('waiting');
    surface.getBoundingClientRect = () => rect(50, 32.5, 112.5, 50);
    expect(visibleExtractionCoverage(surface, source, target, range, sheet)).toBe('covered');
  });
});
