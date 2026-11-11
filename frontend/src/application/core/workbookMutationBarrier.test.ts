import { describe, expect, it, vi } from 'vitest';
import { WorkbookMutationBarrier } from './workbookMutationBarrier';

describe('workbook mutation barrier', () => {
  it('excludes another owner until the predecessor and operation finish', async () => {
    const barrier = new WorkbookMutationBarrier();
    let release!: (entry: { operationId: string; status: string }) => void;
    const waitFor = vi.fn(() => new Promise<{ operationId: string; status: string }>((resolve) => { release = resolve; }));
    const execute = vi.fn(async () => 'done');
    const options = { hasUnsettled: () => false, snapshot: () => [{ operationId: 'a', status: 'running' }], waitFor, execute };
    const first = barrier.run(options);
    expect(barrier.held).toBe(true);
    await expect(barrier.run(options)).rejects.toThrow('already pending');
    expect(barrier.held).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    release({ operationId: 'a', status: 'saved' });
    await expect(first).resolves.toBe('done');
    expect(barrier.held).toBe(false);
  });

  it.each(['failed', 'blocked'])('rejects a %s predecessor without executing and releases', async (status) => {
    const barrier = new WorkbookMutationBarrier();
    const execute = vi.fn(async () => undefined);
    await expect(barrier.run({ hasUnsettled: () => false, snapshot: () => [{ operationId: 'a', status }], waitFor: vi.fn(), execute })).rejects.toThrow('failed saves');
    expect(execute).not.toHaveBeenCalled();
    expect(barrier.held).toBe(false);
  });

  it('releases on unsettled work and execution exceptions', async () => {
    const barrier = new WorkbookMutationBarrier();
    const options = { hasUnsettled: () => true, snapshot: () => [], waitFor: vi.fn(), execute: vi.fn(async () => { throw new Error('failure'); }) };
    await expect(barrier.run(options)).rejects.toThrow('pending sheet and axis creation');
    await expect(barrier.run({ ...options, hasUnsettled: () => false })).rejects.toThrow('failure');
    expect(barrier.held).toBe(false);
  });
});
