import { useEffect, type MutableRefObject } from 'react';
import type { ModelEntrySessions } from '@application/core/modelEntrySession';
import type { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';

export function useMissingEntrySessions(coordinator: WorkbookPersistenceCoordinator, sessions: ModelEntrySessions, locks: MutableRefObject<Set<string>>) {
  useEffect(() => coordinator.subscribeToMissingSheets((sheetId) => {
    sessions.remove(sheetId);
    locks.current.delete(sheetId);
  }), [coordinator, sessions, locks]);
}
