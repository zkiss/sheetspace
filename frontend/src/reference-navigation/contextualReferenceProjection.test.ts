import { describe, expect, it } from 'vitest';
import { contextualReferences, projectReferenceGeometry } from '@reference-navigation/contextualReferenceProjection';
import { inspectFormula } from '@reference-navigation/formulaInspection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const viewport = { scrollLeft: 0, scrollTop: 0, size: { width: 400, height: 300 }, mounted: true } as const;
function fixture() {
  const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '1', B2: '2' } });
  const formula = sheetDocument({ id: 'formula', name: 'Formula' });
  const workbook = workbookWithSheets([formula, source]);
  const inspection = inspectFormula('=@source!A[1] + @source!B[2]:A[1]', workbook, formula)!;
  const frames = [
    { ...formula, ...formula.frame },
    { ...source, ...source.frame, position: { x: 100, y: 50 }, size: { width: 500, height: 400 }, visualScale: 2, zIndex: 1 },
  ].map(({ id, name, position, size, visualScale, zIndex }) => ({ id, name, position, size, visualScale, zIndex }));
  return { source, formula, workbook, inspection, frames };
}

describe('contextual reference projection', () => {
  it('shares stable identity but assigns distinct colours to repeated tokens', () => {
    const { inspection } = fixture();
    const repeated = contextualReferences([inspection.references[0]!, inspection.references[0]!]);
    expect(repeated).toHaveLength(2);
    expect(repeated[0]!.identity).toEqual(repeated[1]!.identity);
    expect(repeated[0]!.color).not.toBe(repeated[1]!.color);
  });

  it('shares identity but distinguishes ranges written with reversed endpoints', () => {
    const { formula, workbook, inspection } = fixture();
    const reversed = inspectFormula('=@source!A[1]:B[2]', workbook, formula)!;
    const references = contextualReferences([inspection.references[1]!, reversed.references[0]!]);
    expect(references[0]!.identity).toEqual(references[1]!.identity);
    expect(references[0]!.color).not.toBe(references[1]!.color);
  });

  it('colours unresolved tokens but not broken references', () => {
    const { inspection } = fixture();
    const unresolved = {
      ...inspection.references[0]!,
      target: { kind: 'cell' as const, sheetId: 'source' },
      navigable: false,
    };
    const broken = { ...inspection.references[0]!, broken: true };

    expect(contextualReferences([unresolved, broken])).toEqual([
      { reference: unresolved, identity: undefined, color: 'hsl(0.000 78% 34%)' },
      { reference: broken, identity: inspection.references[0]!.target.kind === 'cell' ? { kind: 'cell', sheetId: 'source', ...inspection.references[0]!.target.identity! } : undefined, color: undefined },
    ]);
  });

  it('projects normalized range extents through variable axes, scroll, scale, and workspace pan and zoom', () => {
    const { source, workbook, inspection, frames } = fixture();
    const changed = { ...source, presentation: { ...source.presentation, columnWidths: { [source.content.columns[0]!]: 60, [source.content.columns[1]!]: 140 }, rowHeights: { [source.content.rows[0]!]: 30, [source.content.rows[1]!]: 70 } } };
    const result = projectReferenceGeometry({ reference: inspection.references[1]!, workbook: { ...workbook, documents: { ...workbook.documents, source: changed } }, frames, gridViewports: { source: { ...viewport, scrollLeft: 20, scrollTop: 10 } }, workspaceViewport: { x: 10, y: 20, scale: 0.5 }, surfaceSize: { width: 900, height: 700 } });
    expect(result).toEqual({ kind: 'visible', rect: { left: 101, top: 104.4, right: 281, bottom: 194.4 } });
  });

  it('uses a durable frame projection during live movement and resize rather than persisted sheet frame values', () => {
    const { workbook, inspection, frames } = fixture();
    const moved = frames.map((frame) => frame.id === 'source' ? { ...frame, position: { x: 300, y: 200 }, size: { width: 600, height: 500 } } : frame);
    const result = projectReferenceGeometry({ reference: inspection.references[0]!, workbook, frames: moved, gridViewports: { source: viewport }, workspaceViewport: { x: 0, y: 0, scale: 1 }, surfaceSize: { width: 1200, height: 900 } });
    expect(result).toEqual({ kind: 'visible', rect: { left: 382, top: 318.8, right: 534, bottom: 371.6 } });
  });

  it('falls back rather than anchoring a clipped cell, unmounted overview, broken, or occluded target', () => {
    const { workbook, inspection, frames } = fixture();
    const base = { reference: inspection.references[0]!, workbook, frames, workspaceViewport: { x: 0, y: 0, scale: 1 }, surfaceSize: { width: 900, height: 700 } };
    expect(projectReferenceGeometry({ ...base, gridViewports: { source: { ...viewport, scrollLeft: 1000 } } })).toEqual({ kind: 'offscreen', target: { x: -1742, y: 195.2 } });
    expect(projectReferenceGeometry({ ...base, gridViewports: { source: { ...viewport, scrollLeft: 50 } } })).toEqual({ kind: 'unavailable', reason: 'clipped' });
    expect(projectReferenceGeometry({ ...base, reference: inspection.references[1]!, gridViewports: { source: { ...viewport, scrollLeft: 50 } } })).toMatchObject({ kind: 'visible', rect: { left: 182 } });
    expect(projectReferenceGeometry({ ...base, gridViewports: { source: { ...viewport, renderingMode: 'overview' } } })).toEqual({ kind: 'overview', rect: { left: 100, top: 50, right: 900, bottom: 700 } });
    expect(projectReferenceGeometry({ ...base, gridViewports: { source: { ...viewport, mounted: false } } })).toEqual({ kind: 'unavailable', reason: 'unmounted' });
    expect(projectReferenceGeometry({ ...base, reference: { ...inspection.references[0]!, broken: true, navigable: false }, gridViewports: { source: viewport } })).toEqual({ kind: 'unavailable', reason: 'broken' });
    const covered = [...frames, { id: 'cover', name: 'Cover', position: { x: 100, y: 50 }, size: { width: 600, height: 500 }, visualScale: 1, zIndex: 2 }];
    expect(projectReferenceGeometry({ ...base, frames: covered, gridViewports: { source: viewport } })).toEqual({ kind: 'unavailable', reason: 'occluded' });
  });

  it('rejects every unavailable projection prerequisite instead of fabricating a target anchor', () => {
    const { workbook, inspection, frames } = fixture();
    const base = { reference: inspection.references[0]!, workbook, frames, gridViewports: { source: viewport }, workspaceViewport: { x: 0, y: 0, scale: 1 }, surfaceSize: { width: 900, height: 700 } };

    expect(projectReferenceGeometry({ ...base, reference: { ...base.reference, navigable: false } })).toEqual({ kind: 'unavailable', reason: 'broken' });
    expect(projectReferenceGeometry({ ...base, workbook: { ...workbook, documents: {} } })).toEqual({ kind: 'unavailable', reason: 'unmounted' });
    expect(projectReferenceGeometry({ ...base, frames: frames.filter((frame) => frame.id !== 'source') })).toEqual({ kind: 'unavailable', reason: 'unmounted' });
    expect(projectReferenceGeometry({ ...base, gridViewports: {} })).toEqual({ kind: 'unavailable', reason: 'unmounted' });
    expect(projectReferenceGeometry({ ...base, gridViewports: { source: { ...viewport, size: { width: 48, height: 300 } } } })).toEqual({ kind: 'unavailable', reason: 'clipped' });
    expect(projectReferenceGeometry({ ...base, surfaceSize: { width: 200, height: 700 } })).toEqual({ kind: 'unavailable', reason: 'clipped' });
    expect(projectReferenceGeometry({ ...base, reference: { ...base.reference, target: { kind: 'cell', sheetId: 'source', identity: { rowId: 'missing', columnId: 'missing' } } } })).toEqual({ kind: 'unavailable', reason: 'broken' });
  });
});
