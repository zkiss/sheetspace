import { useCallback, useRef, useState } from 'react';
import type { SaveStatus } from './appTypes';
import { DEFAULT_SHEET_FRAME_SIZE, sheetsInOrder, validateSheetName, type SheetDocument, type Workbook, type WorkspacePosition } from './workbook';
import { workbookApi, type WorkbookApi } from './workbookApi';
import type { SetWorkbook } from './workbookCalculation';

/** A view-only frame shown while the server creates its SheetDocument. */
export type CreatingSheetFrame = {
  kind: 'creating';
  operationKey: string;
  name: string;
  position: WorkspacePosition;
  size: typeof DEFAULT_SHEET_FRAME_SIZE;
  zIndex: number;
};

export function useSheetCreationOperations({
  autosaveEnabled,
  currentWorkbook,
  resolvedApiClient,
  setWorkbook,
}: {
  autosaveEnabled: boolean;
  currentWorkbook: () => Workbook;
  resolvedApiClient: Partial<WorkbookApi>;
  setWorkbook: SetWorkbook;
}) {
  const [creatingFrames, setCreatingFrames] = useState<CreatingSheetFrame[]>([]);
  const [failed, setFailed] = useState(false);
  const reservedNames = useRef(new Set<string>());
  const creatingFramesRef = useRef(creatingFrames);
  creatingFramesRef.current = creatingFrames;

  const createSheet = useCallback((name: string, position: WorkspacePosition) => {
    const workbook = currentWorkbook();
    const validation = validateSheetName(name, sheetsInOrder(workbook));
    if (!validation.ok) return validation;
    if (reservedNames.current.has(validation.name)) return { ok: false as const, reason: 'duplicate' as const };

    const operationKey = crypto.randomUUID();
    reservedNames.current.add(validation.name);
    const zIndex = Math.max(0, ...sheetsInOrder(workbook).map((sheet) => sheet.frame.zIndex), ...creatingFramesRef.current.map((frame) => frame.zIndex)) + 1;
    const creatingFrame: CreatingSheetFrame = {
      kind: 'creating', operationKey, name: validation.name, position,
      size: DEFAULT_SHEET_FRAME_SIZE, zIndex,
    };
    creatingFramesRef.current = [...creatingFramesRef.current, creatingFrame];
    setCreatingFrames((frames) => [...frames, creatingFrame]);
    setFailed(false);

    if (autosaveEnabled) {
      const request = resolvedApiClient.createSheet ?? workbookApi.createSheet;
      void request({ name: validation.name, position }).then((sheet: SheetDocument) => {
        const removeFrame = (frames: CreatingSheetFrame[]) => frames.filter((frame) => frame.operationKey !== operationKey);
        creatingFramesRef.current = removeFrame(creatingFramesRef.current);
        setCreatingFrames(removeFrame);
        reservedNames.current.delete(validation.name);
        setWorkbook((current) => {
          if (current.documents[sheet.id]) return current;
          return {
            ...current,
            manifest: { ...current.manifest, sheetIds: [...current.manifest.sheetIds, sheet.id] },
            documents: { ...current.documents, [sheet.id]: sheet },
          };
        }, { kind: 'structure' });
      }).catch(() => {
        creatingFramesRef.current = creatingFramesRef.current.filter((frame) => frame.operationKey !== operationKey);
        setCreatingFrames((frames) => frames.filter((frame) => frame.operationKey !== operationKey));
        reservedNames.current.delete(validation.name);
        setFailed(true);
      });
    }
    return validation;
  }, [autosaveEnabled, currentWorkbook, resolvedApiClient, setWorkbook]);

  const saveStatus: SaveStatus = failed ? 'failed' : creatingFrames.length > 0 ? 'saving' : 'saved';
  return { createSheet, creatingFrames, saveStatus };
}
