import { describe, expect, it } from 'vitest';
import { projectGridAxes } from './gridAxisProjection';
import { TabularContent } from '@workbook/core/model';

describe('projectGridAxes', () => {
  it('places creating rows and columns between durable entries without changing tabular content', () => {
    const content: TabularContent = {
      kind: 'tabular',
      rows: ['row-1', 'row-2'],
      columns: ['column-1', 'column-2'],
      cells: {},
    };

    const projection = projectGridAxes(content, {
      rows: [{ kind: 'creating', operationId: 'row-request', boundary: 1 }],
      columns: [{ kind: 'creating', operationId: 'column-request', boundary: 1 }],
    });

    expect(projection.rows).toEqual([
      { kind: 'saved', id: 'row-1', durableIndex: 0 },
      { kind: 'creating', operationId: 'row-request', boundary: 1 },
      { kind: 'saved', id: 'row-2', durableIndex: 1 },
    ]);
    expect(projection.columns).toEqual([
      { kind: 'saved', id: 'column-1', durableIndex: 0 },
      { kind: 'creating', operationId: 'column-request', boundary: 1 },
      { kind: 'saved', id: 'column-2', durableIndex: 1 },
    ]);
    expect(content.rows).toEqual(['row-1', 'row-2']);
    expect(content.columns).toEqual(['column-1', 'column-2']);
  });
});
