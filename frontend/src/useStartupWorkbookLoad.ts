import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { workbookApi, type WorkbookApi } from './workbookApi';
import type { StartupLoadState } from './appTypes';
import type { Workbook } from './workbook';

export function useStartupWorkbookLoad({
  initialWorkbook,
  markSaved,
  resolvedApiClient,
  setWorkbook,
}: {
  initialWorkbook?: Workbook;
  markSaved: () => void;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
}) {
  const [startupLoad, setStartupLoad] = useState<StartupLoadState>(
    initialWorkbook ? { status: 'loaded' } : { status: 'loading' },
  );

  useEffect(() => {
    if (initialWorkbook || startupLoad.status !== 'loading') {
      return;
    }

    let active = true;

    const loadWorkbook = resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook;

    loadWorkbook()
      .then((loadedWorkbook) => {
        if (!active) {
          return;
        }

        setWorkbook(loadedWorkbook);
        setStartupLoad({ status: 'loaded' });
        markSaved();
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }

        const message = cause instanceof Error ? cause.message : 'Workbook could not be loaded.';
        setStartupLoad({
          status: 'error',
          message,
        });
      });

    return () => {
      active = false;
    };
  }, [resolvedApiClient, initialWorkbook, markSaved, setWorkbook, startupLoad.status]);

  return {
    retryStartupLoad: () => setStartupLoad({ status: 'loading' }),
    startupLoad,
  };
}
