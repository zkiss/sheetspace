import { describe, expect, it } from 'vitest';
import changeSetContract from '../../test-fixtures/change-set-contract.json';
import type { DurableChangeSetRequest } from './userActions';

describe('change-set wire contract', () => {
  it('matches every field of a frontend durable change set', () => {
    const expected = {
      version: 1,
      scope: 'sheet',
      clientActionId: '90000000-0000-0000-0000-000000000001',
      sheetId: '00000000-0000-0000-0000-000000000001',
      expectedRevision: {
        sheetId: '00000000-0000-0000-0000-000000000001',
        revision: 4,
      },
      operations: [{
        kind: 'set-cell-content',
        cell: {
          rowId: '10000000-0000-0000-0000-000000000001',
          columnId: '11000000-0000-0000-0000-000000000001',
        },
        raw: '42',
      }],
    } satisfies DurableChangeSetRequest;

    expect(changeSetContract).toEqual(expected);
  });
});
