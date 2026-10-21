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

  it('keeps property drafts through model list reordering because IDs do not use indices', () => {
    expect(modelPropertyDraftKey({ modelId: 'model-7', propertyId: 'total' }))
      .toBe(modelPropertyDraftKey({ modelId: 'model-7', propertyId: 'total' }));
  });
});
