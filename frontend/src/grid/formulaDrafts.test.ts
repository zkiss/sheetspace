import { describe, expect, it } from 'vitest';
import { draftForTarget, formulaDraftKey, modelPropertyDraftKey } from './formulaDrafts';

describe('formula draft identities', () => {
  it('keeps cell and model-property drafts isolated by stable IDs', () => {
    const cell = { sheetId: 'model-1', cell: { rowId: 'row-1', columnId: 'property-1' } };
    const property = { modelId: 'model-1', propertyId: 'property-1' };
    const drafts = {
      [formulaDraftKey(cell)]: { target: cell, draft: '=1' },
      [modelPropertyDraftKey(property)]: { target: property, draft: '=2', selection: { start: 1, end: 2 } },
    };

    expect(formulaDraftKey(cell)).not.toBe(modelPropertyDraftKey(property));
    expect(draftForTarget(drafts, cell)?.draft).toBe('=1');
    expect(draftForTarget(drafts, property)).toEqual({ target: property, draft: '=2', selection: { start: 1, end: 2 } });
  });

  it('does not alias target kinds or IDs containing delimiters', () => {
    const cell = { sheetId: 'property', cell: { rowId: 'model:one', columnId: 'property:two' } };
    const property = { modelId: 'model:one', propertyId: 'property:two' };
    const splitCell = { sheetId: 'a:b', cell: { rowId: 'c', columnId: 'd:e' } };
    const joinedCell = { sheetId: 'a', cell: { rowId: 'b:c', columnId: 'd:e' } };
    const drafts = {
      [formulaDraftKey(cell)]: { target: cell, draft: '=cell' },
      [formulaDraftKey(property)]: { target: property, draft: '=property' },
      [formulaDraftKey(splitCell)]: { target: splitCell, draft: '=split' },
      [formulaDraftKey(joinedCell)]: { target: joinedCell, draft: '=joined' },
    };

    expect(formulaDraftKey(cell)).not.toBe(formulaDraftKey(property));
    expect(formulaDraftKey(splitCell)).not.toBe(formulaDraftKey(joinedCell));
    expect(draftForTarget(drafts, cell)?.draft).toBe('=cell');
    expect(draftForTarget(drafts, property)?.draft).toBe('=property');
    expect(draftForTarget(drafts, splitCell)?.draft).toBe('=split');
    expect(draftForTarget(drafts, joinedCell)?.draft).toBe('=joined');
  });

  it('keeps property drafts through model list reordering because IDs do not use indices', () => {
    expect(modelPropertyDraftKey({ modelId: 'model-7', propertyId: 'total' }))
      .toBe(modelPropertyDraftKey({ modelId: 'model-7', propertyId: 'total' }));
  });
});
