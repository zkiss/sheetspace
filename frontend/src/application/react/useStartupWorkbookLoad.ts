import { useEffect, useRef, useState } from 'react';
import { workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { StartupLoadState } from '@application/core/state';
import { Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';

export function useStartupWorkbookLoad({
  initialWorkbook,
  markSaved,
  resolvedApiClient,
  setWorkbook,
}: {
  initialWorkbook?: Workbook;
  markSaved: () => void;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: SetWorkbook;
}) {
  const [startupLoad, setStartupLoad] = useState<StartupLoadState>(
    initialWorkbook ? { status: 'loaded' } : { status: 'loading' },
  );
  const loading = useRef(!initialWorkbook);

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

        setWorkbook(loadedWorkbook, { kind: 'structure' });
        loading.current = false;
        setStartupLoad({ status: 'loaded' });
        markSaved();
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }

        const message = cause instanceof Error ? cause.message : 'Workbook could not be loaded.';
        loading.current = false;
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
    isStartupLoading: () => loading.current,
    retryStartupLoad: () => { if (!initialWorkbook) { loading.current = true; setStartupLoad({ status: 'loading' }); } },
    startupLoad,
  };
}
