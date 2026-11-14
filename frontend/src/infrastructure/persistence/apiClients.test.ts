import { expect, it } from 'vitest';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { workbookWithSheets } from '@test-support/workbookFactories';

it('returns the current persisted workbook on an admission retry', async () => {
  const before = workbookWithSheets([]);
  const first = { ...before, dataModels: {} };
  const later = { ...first, manifest: { ...first.manifest, name: 'Later' } };
  const client = persistedWorkbookClient(before);

  const admitted = await client.admitModelLifecycle('first', before, first);
  await client.admitModelLifecycle('later', first, later);
  const retry = await client.admitModelLifecycle('first', before, first);

  expect(retry).toEqual({ ...admitted, alreadyCommitted: true, workbook: later });
});
