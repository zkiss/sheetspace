import { useCallback, useRef, useState } from 'react';
import type { SaveStatus } from '@application/core/state';
import type { CreatingSheetFrame } from '@application/core/sheetCreationState';
import { clampSheetVisualScale, DEFAULT_SHEET_FRAME_SIZE, type SheetDocument, type Workbook, type WorkspacePosition } from '@workbook/core/model';
import { sheetsInOrder } from '@workbook/read/queries';
import { validateSheetName } from '@workbook/mutations/operations';
import { workbookApi, WorkbookApiError, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { SheetCreationReceipt } from '@infrastructure/persistence/sheetCreationReceipt';
import { bindCustomFunctionsForSheet } from '@calculation/customFunctions';
import { emptySheetPresentation } from '@workbook/core/axisSizePolicy';
import type { SetWorkbook } from '@calculation/workbookCalculation';

export function useSheetCreationOperations({
  autosaveEnabled,
  beforeCreate,
  currentWorkbook,
  resolvedApiClient,
  settleCreation,
  setWorkbook,
}: {
  autosaveEnabled: boolean;
  beforeCreate?: () => Promise<void> | undefined;
  currentWorkbook: () => Workbook;
  resolvedApiClient: Partial<WorkbookApi>;
  settleCreation: (baseline: Workbook, request: CreatingSheetFrame, receipt: SheetCreationReceipt) => Promise<SheetDocument | undefined>;
  setWorkbook: SetWorkbook;
}) {
  const [creatingFrames, setCreatingFrames] = useState<CreatingSheetFrame[]>([]);
  const [failures, setFailures] = useState<Set<string>>(() => new Set());
  const reservedNames = useRef(new Set<string>());
  const latestCreation = useRef<string | null>(null);
  const creatingFramesRef = useRef(creatingFrames);
  creatingFramesRef.current = creatingFrames;

  const createSheet = useCallback((name: string, position: WorkspacePosition, viewportScale = 1, onCreated?: (sheet: SheetDocument) => void) => {
    const workbook = currentWorkbook();
    const validation = validateSheetName(name, sheetsInOrder(workbook));
    if (!validation.ok) return validation;
    if (reservedNames.current.has(validation.name)) return { ok: false as const, reason: 'duplicate' as const };

    const operationKey = crypto.randomUUID();
    latestCreation.current = operationKey;
    reservedNames.current.add(validation.name);
    const zIndex = Math.max(0, ...sheetsInOrder(workbook).map((sheet) => sheet.frame.zIndex), ...creatingFramesRef.current.map((frame) => frame.zIndex)) + 1;
    const visualScale = clampSheetVisualScale(1 / viewportScale);
    if (!autosaveEnabled) {
      const id = crypto.randomUUID();
      const sheet: SheetDocument = {
        id, name: validation.name, revision: 0,
        frame: { position, size: DEFAULT_SHEET_FRAME_SIZE, visualScale, zIndex },
        presentation: emptySheetPresentation(),
        content: { kind: 'tabular', rows: Array.from({ length: 20 }, () => crypto.randomUUID()), columns: Array.from({ length: 10 }, () => crypto.randomUUID()), cells: {} },
      };
      const admitted = { ...workbook, manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, id] }, documents: { ...workbook.documents, [id]: sheet } };
      setWorkbook(bindCustomFunctionsForSheet(admitted, id), { kind: 'structure' });
      reservedNames.current.delete(validation.name);
      onCreated?.(sheet);
      return validation;
    }
    const creatingFrame: CreatingSheetFrame = {
      kind: 'creating', operationKey, name: validation.name, position,
      size: DEFAULT_SHEET_FRAME_SIZE, visualScale, zIndex,
    };
    creatingFramesRef.current = [...creatingFramesRef.current, creatingFrame];
    setCreatingFrames((frames) => [...frames, creatingFrame]);
    setFailures((previous) => { const next = new Set(previous); next.delete(validation.name); return next; });

    if (autosaveEnabled) {
      const request = resolvedApiClient.createSheet ?? workbookApi.createSheet;
      let dispatched = false;
      const run = async () => {
        const wait = beforeCreate?.();
        if (wait) await wait;
        const baseline = currentWorkbook();
        dispatched = true;
        const receipt = await request({ name: validation.name, position, visualScale, zIndex });
        const sheet = await settleCreation(baseline, creatingFrame, receipt);
        if (!sheet) throw new Error('Unresolved sheet creation.');
        const removeFrame = (frames: CreatingSheetFrame[]) => frames.filter((frame) => frame.operationKey !== operationKey);
        creatingFramesRef.current = removeFrame(creatingFramesRef.current);
        setCreatingFrames(removeFrame);
        reservedNames.current.delete(validation.name);
        if (latestCreation.current === operationKey) onCreated?.(sheet);
      };
      void run().catch((error: unknown) => {
        const rejected = !dispatched || (error instanceof WorkbookApiError && error.status === 400 && ['sheet-name-required', 'sheet-name-duplicate', 'invalid-sheet-position', 'invalid-sheet-frame-size', 'invalid-sheet-visual-scale', 'invalid-sheet-z-index'].includes(error.code ?? ''));
        if (rejected) {
          creatingFramesRef.current = creatingFramesRef.current.filter((frame) => frame.operationKey !== operationKey);
          setCreatingFrames((frames) => frames.filter((frame) => frame.operationKey !== operationKey));
          reservedNames.current.delete(validation.name);
        }
        setFailures((previous) => new Set(previous).add(validation.name));
      });
    }
    return validation;
  }, [autosaveEnabled, beforeCreate, currentWorkbook, resolvedApiClient, settleCreation, setWorkbook]);

  const saveStatus: SaveStatus = failures.size > 0 ? 'failed' : creatingFrames.length > 0 ? 'saving' : 'saved';
  return { createSheet, creatingFrames, hasPendingCreations: () => creatingFramesRef.current.length > 0, saveStatus };
}
