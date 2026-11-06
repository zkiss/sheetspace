import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

describe('complete workbook reservations', () => {
  it('waits for every preceding sheet and blocks all successors including new membership', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const predecessor = deferred<void>();
    const admission = deferred<void>();
    const events: string[] = [];
    const first = coordinator.serialize(['other'], async () => { await predecessor.promise; events.push('predecessor'); });
    const atomic = coordinator.serializeWorkbook(async () => { events.push('capture'); await admission.promise; events.push('adopt'); });
    const next = coordinator.serialize(['new-sheet'], async () => { events.push('successor'); });
    expect(events).toEqual([]);
    predecessor.resolve();
    await first;
    await Promise.resolve();
    expect(events).toEqual(['predecessor', 'capture']);
    admission.resolve();
    await Promise.all([atomic, next]);
    expect(events).toEqual(['predecessor', 'capture', 'adopt', 'successor']);
  });

  it('serializes workbook reservations and releases them after failures', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const held = deferred<void>();
    const second = vi.fn();
    const first = coordinator.serializeWorkbook(async () => { await held.promise; throw new Error('failed'); });
    const next = coordinator.serializeWorkbook(async () => { second(); });
    expect(second).not.toHaveBeenCalled();
    held.resolve();
    await expect(first).rejects.toThrow('failed');
    await next;
    await coordinator.serializeWorkbook(async () => { second(); });
    expect(second).toHaveBeenCalledTimes(2);
  });
});
