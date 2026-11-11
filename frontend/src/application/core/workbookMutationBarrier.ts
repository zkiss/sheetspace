type Predecessor = { operationId: string; status: string };

export class WorkbookMutationBarrier {
  private owner: object | undefined;

  get held() { return this.owner !== undefined; }

  async run<T>(options: {
    hasUnsettled: () => boolean;
    snapshot: () => readonly Predecessor[];
    waitFor: (operationId: string) => Promise<Predecessor>;
    execute: () => Promise<T>;
  }): Promise<T> {
    if (this.owner) throw new Error('A workbook transition is already pending.');
    const owner = {};
    this.owner = owner;
    try {
      if (options.hasUnsettled()) throw new Error('Resolve pending sheet and axis creation or workbook transitions before continuing.');
      for (const entry of options.snapshot()) {
        const settled = entry.status === 'queued' || entry.status === 'running' ? await options.waitFor(entry.operationId) : entry;
        if (settled.status === 'failed' || settled.status === 'blocked') throw new Error('Resolve failed saves before continuing.');
      }
      return await options.execute();
    } finally {
      if (this.owner === owner) this.owner = undefined;
    }
  }
}
