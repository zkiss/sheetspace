import { Dispatch, SetStateAction, useCallback, useRef, useState } from 'react';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import type { SaveStatus } from './appTypes';
import type { Workbook } from './workbook';

type EditQueueTask = {
  key: string;
  run: () => Promise<Workbook>;
};

type EditQueue = {
  running: EditQueueTask | null;
  queued: EditQueueTask | null;
};

export function useEditQueue({
  autosaveEnabled,
  resolvedApiClient,
  setWorkbook,
  workbook,
}: {
  autosaveEnabled: boolean;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
  workbook: Workbook;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const editQueues = useRef(new Map<string, EditQueue>());
  const failedEditKeys = useRef(new Set<string>());

  const getApiMethod = useCallback(
    <K extends keyof WorkbookApi>(method: K): WorkbookApi[K] => resolvedApiClient[method] ?? workbookApi[method],
    [resolvedApiClient],
  );

  const hasPendingEdits = useCallback(() => {
    for (const queue of editQueues.current.values()) {
      if (queue.running || queue.queued) {
        return true;
      }
    }

    return false;
  }, []);

  const refreshSaveStatus = useCallback(() => {
    if (failedEditKeys.current.size > 0) {
      setSaveStatus('failed');
      return;
    }

    setSaveStatus(hasPendingEdits() ? 'saving' : 'saved');
  }, [hasPendingEdits]);

  const mergeSheetRevisions = useCallback(
    (savedWorkbook: Workbook) => {
      setWorkbook((currentWorkbook) => ({
        ...currentWorkbook,
        sheets: currentWorkbook.sheets.map((sheet) => {
          const savedSheet = savedWorkbook.sheets.find((candidate) => candidate.id === sheet.id);
          return savedSheet ? { ...sheet, revision: Math.max(sheet.revision, savedSheet.revision) } : sheet;
        }),
      }));
    },
    [setWorkbook],
  );

  const startEditTask = useCallback(
    (queue: EditQueue, task: EditQueueTask) => {
      queue.running = task;
      task
        .run()
        .then((savedWorkbook) => {
          mergeSheetRevisions(savedWorkbook);
        })
        .catch(() => {
          if (!queue.queued) {
            failedEditKeys.current.add(task.key);
          }
        })
        .finally(() => {
          const nextTask = queue.queued;
          queue.running = null;
          queue.queued = null;

          if (nextTask) {
            startEditTask(queue, nextTask);
            return;
          }

          editQueues.current.delete(task.key);
          refreshSaveStatus();
        });
    },
    [mergeSheetRevisions, refreshSaveStatus],
  );

  const enqueueEdit = useCallback(
    (key: string, run: () => Promise<Workbook>) => {
      if (!autosaveEnabled) {
        return;
      }

      const task = {
        key,
        run,
      };
      failedEditKeys.current.delete(key);

      const queue = editQueues.current.get(key) ?? { running: null, queued: null };
      editQueues.current.set(key, queue);

      if (queue.running) {
        queue.queued = task;
        refreshSaveStatus();
        return;
      }

      startEditTask(queue, task);
      refreshSaveStatus();
    },
    [autosaveEnabled, refreshSaveStatus, startEditTask],
  );

  const currentSheetRevision = useCallback(
    (sheetId: string) => workbook.sheets.find((sheet) => sheet.id === sheetId)?.revision,
    [workbook.sheets],
  );

  const runRevisionedEdit = useCallback(
    (sheetId: string, save: (revision: number | undefined) => Promise<Workbook>) => {
      const loadWorkbook = resolvedApiClient.loadWorkbook ?? workbookApi.loadWorkbook;
      const startingRevision = currentSheetRevision(sheetId);

      return save(startingRevision).catch(async (cause: unknown) => {
        if (!(cause instanceof WorkbookApiError) || cause.status !== 409 || cause.code !== 'sheet-revision-conflict') {
          throw cause;
        }

        const latestWorkbook = await loadWorkbook();
        const latestRevision = latestWorkbook.sheets.find((sheet) => sheet.id === sheetId)?.revision;
        mergeSheetRevisions(latestWorkbook);
        return save(latestRevision);
      });
    },
    [currentSheetRevision, mergeSheetRevisions, resolvedApiClient],
  );

  const markSaved = useCallback(() => {
    setSaveStatus('saved');
  }, []);

  return {
    enqueueEdit,
    getApiMethod,
    markSaved,
    runRevisionedEdit,
    saveStatus,
  };
}
