import {
  parseA1Address,
  parseA1Range,
  type CellAddress,
  type CellKey,
  type CellRange,
} from './cellAddress';
import {
  formulaSheetReferences,
  formatSheetReferenceToken,
  parseFormula as parseFormulaSyntax,
  replaceFormulaQualifiers,
  type FormulaParseResult,
} from './formulaSyntax';

export {
  cellKey,
  columnIndexToLabel,
  columnLabelToIndex,
  expandRange,
  isAddressWithinBounds,
  parseA1Address,
  parseA1Range,
} from './cellAddress';
export type { CellAddress, CellKey, CellRange } from './cellAddress';
export { formatSheetReferenceToken } from './formulaSyntax';
export type {
  BinaryFormula,
  FormulaErrorCode,
  FormulaExpression,
  FormulaLiteral,
  FormulaParseResult,
  FormulaReference,
  FormulaSourceSpan,
  FunctionFormula,
  GroupFormula,
  UnaryFormula,
} from './formulaSyntax';
export { evaluateFormulaCells } from './formulaEvaluator';
export type { FormulaEvaluationObserver } from './formulaEvaluator';
export {
  classifyCellValue,
  displayFormulaValue,
  formulaCollectionValues,
  formulaErrorValue,
  formulaScalarValue,
} from './formulaValue';
export type {
  FormulaDisplayResult,
  FormulaEvaluationSnapshot,
  FormulaRangeValue,
  FormulaScalarValue,
  FormulaValue,
} from './formulaValue';

export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_COLUMN_COUNT = 10;
export const DEFAULT_ROW_COUNT = 20;
export const DEFAULT_SHEET_FRAME_SIZE: SheetFrameSize = {
  width: 240,
  height: 160,
};

export type Workbook = {
  version: typeof WORKBOOK_SCHEMA_VERSION;
  sheets: Sheet[];
};

export type Sheet = {
  id: string;
  name: string;
  revision: number;
  position: WorkspacePosition;
  frameSize: SheetFrameSize;
  zIndex: number;
  columnCount: number;
  rowCount: number;
  cells: Record<CellKey, string>;
};

export type WorkspacePosition = {
  x: number;
  y: number;
};

export type SheetFrameSize = {
  width: number;
  height: number;
};

export type NamedCellReference = CellAddress & {
  sheetName?: string;
};

export type NamedRangeReference = CellRange & {
  sheetName?: string;
};

export type ValidationResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate' };

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'duplicate' | 'unknown-sheet' };

export type SheetZOrderDirection = 'up' | 'down' | 'top' | 'bottom';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid-format' | 'out-of-bounds' | 'unknown-sheet' };

export function createEmptyWorkbook(): Workbook {
  return {
    version: WORKBOOK_SCHEMA_VERSION,
    sheets: [],
  };
}

export function createSheet(input: {
  id: string;
  name: string;
  existingSheets?: Pick<Sheet, 'id' | 'name' | 'zIndex'>[];
  position?: WorkspacePosition;
  frameSize?: SheetFrameSize;
  zIndex?: number;
}): MutationResult<Sheet> {
  const validation = validateSheetName(input.name, input.existingSheets ?? []);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    value: {
      id: input.id,
      name: validation.name,
      revision: 0,
      position: input.position ?? { x: 0, y: 0 },
      frameSize: input.frameSize ?? DEFAULT_SHEET_FRAME_SIZE,
      zIndex: input.zIndex ?? nextSheetZIndex(input.existingSheets ?? []),
      columnCount: DEFAULT_COLUMN_COUNT,
      rowCount: DEFAULT_ROW_COUNT,
      cells: {},
    },
  };
}

export function moveSheetZOrder(
  workbook: Workbook,
  sheetId: string,
  direction: SheetZOrderDirection,
): MutationResult<Workbook> {
  if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  const orderedSheets = sheetsByZOrder(workbook.sheets);
  const currentIndex = orderedSheets.findIndex((sheet) => sheet.id === sheetId);
  const targetIndex =
    direction === 'top'
      ? orderedSheets.length - 1
      : direction === 'bottom'
        ? 0
        : direction === 'up'
          ? Math.min(orderedSheets.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);

  if (targetIndex === currentIndex) {
    return { ok: true, value: normalizeSheetZOrder(workbook) };
  }

  const reordered = [...orderedSheets];
  const [movedSheet] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, movedSheet);

  const nextZIndexById = new Map(reordered.map((sheet, index) => [sheet.id, index + 1]));
  return {
    ok: true,
    value: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => ({
        ...sheet,
        zIndex: nextZIndexById.get(sheet.id) ?? sheet.zIndex,
      })),
    },
  };
}

export function normalizeSheetZOrder(workbook: Workbook): Workbook {
  const orderedSheets = sheetsByZOrder(workbook.sheets);
  const nextZIndexById = new Map(orderedSheets.map((sheet, index) => [sheet.id, index + 1]));

  if (workbook.sheets.every((sheet) => sheet.zIndex === nextZIndexById.get(sheet.id))) {
    return workbook;
  }

  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet) => ({
      ...sheet,
      zIndex: nextZIndexById.get(sheet.id) ?? sheet.zIndex,
    })),
  };
}

function nextSheetZIndex(sheets: Pick<Sheet, 'zIndex'>[]): number {
  return Math.max(0, ...sheets.map((sheet) => sheet.zIndex)) + 1;
}

function sheetsByZOrder(sheets: Sheet[]): Sheet[] {
  return [...sheets].sort((first, second) => first.zIndex - second.zIndex);
}

export function validateSheetName(
  name: string,
  existingSheets: Pick<Sheet, 'id' | 'name'>[],
  currentSheetId?: string,
): ValidationResult {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const duplicate = existingSheets.some(
    (sheet) => sheet.id !== currentSheetId && sheet.name === trimmedName,
  );
  if (duplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  return { ok: true, name: trimmedName };
}

export function renameSheet(workbook: Workbook, sheetId: string, nextName: string): MutationResult<Workbook> {
  const validation = validateSheetName(nextName, workbook.sheets, sheetId);
  if (!validation.ok) {
    return validation;
  }

  if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return {
    ok: true,
    value: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) =>
        sheet.id === sheetId ? { ...sheet, name: validation.name } : sheet,
      ),
    },
  };
}

export function commitCellRawContent(
  workbook: Workbook,
  sheetId: string,
  key: CellKey,
  raw: string,
): Workbook {
  const canonicalRaw = formulaRawForStorage(raw, workbook);
  let changed = false;
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.id !== sheetId) {
      return sheet;
    }

    const existingCell = sheet.cells[key];
    if (raw.length === 0) {
      if (existingCell === undefined) {
        return sheet;
      }

      changed = true;
      const cells = { ...sheet.cells };
      delete cells[key];

      return {
        ...sheet,
        cells,
      };
    }

    if (existingCell === canonicalRaw) {
      return sheet;
    }

    changed = true;
    const cells = { ...sheet.cells };
    cells[key] = canonicalRaw;

    return {
      ...sheet,
      cells,
    };
  });

  return changed ? { ...workbook, sheets } : workbook;
}

export function findSheetByName(workbook: Workbook, sheetName: string): ParseResult<Sheet> {
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return { ok: true, value: sheet };
}

export function appendRow(sheet: Sheet): Sheet {
  return {
    ...sheet,
    rowCount: sheet.rowCount + 1,
  };
}

export function appendColumn(sheet: Sheet): Sheet {
  return {
    ...sheet,
    columnCount: sheet.columnCount + 1,
  };
}

export function parseNamedA1Address(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedCellReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const address = parseA1Address(reference.value.reference, sheet.value);
  if (!address.ok) {
    return address;
  }

  return {
    ok: true,
    value: {
      ...address.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function parseNamedA1Range(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedRangeReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const range = parseA1Range(reference.value.reference, sheet.value);
  if (!range.ok) {
    return range;
  }

  return {
    ok: true,
    value: {
      ...range.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function parseFormula(
  raw: string,
  _workbook: Workbook,
  _defaultSheet?: Sheet,
): FormulaParseResult {
  return parseFormulaSyntax(raw);
}

function resolveReferenceSheet(
  sheetName: string | undefined,
  workbook: Workbook,
  defaultSheet: Sheet | undefined,
): ParseResult<Sheet> {
  if (!sheetName) {
    if (!defaultSheet) {
      return { ok: false, reason: 'unknown-sheet' };
    }
    return { ok: true, value: defaultSheet };
  }

  return findSheetByName(workbook, sheetName);
}

export function formulaRawForStorage(raw: string, workbook: Workbook): string {
  return replaceFormulaQualifiers(raw, (sheetReference) => {
    if (sheetReference === '#REF') {
      return sheetReference;
    }
    return workbook.sheets.find(
      (candidate) => candidate.name === sheetReference || candidate.id === sheetReference,
    )?.id ?? '#REF';
  });
}

export function formulaRawForDisplay(raw: string, workbook: Workbook): string {
  return replaceFormulaQualifiers(raw, (sheetId) => {
    const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
    return sheet ? formatSheetReferenceToken(sheet.name) : '#REF';
  });
}

export function formulaSheetReferenceIds(raw: string): string[] {
  return formulaSheetReferences(raw).filter((sheetId) => sheetId !== '#REF');
}

export function remapFormulaSheetIds(raw: string, remaps: ReadonlyMap<string, string>): string {
  return replaceFormulaQualifiers(raw, (sheetId) => remaps.get(sheetId) ?? sheetId);
}

export function remapWorkbookFormulaSheetId(workbook: Workbook, fromSheetId: string, toSheetId: string): Workbook {
  const remaps = new Map([[fromSheetId, toSheetId]]);
  let changed = false;
  const sheets = workbook.sheets.map((sheet) => {
    let sheetChanged = false;
    const cells = Object.fromEntries(
      Object.entries(sheet.cells).map(([key, content]) => {
        const remapped = remapFormulaSheetIds(content, remaps);
        sheetChanged ||= remapped !== content;
        return [key, remapped];
      }),
    );
    changed ||= sheetChanged;
    return sheetChanged ? { ...sheet, cells } : sheet;
  });
  return changed ? { ...workbook, sheets } : workbook;
}

function splitSheetReference(
  input: string,
): ParseResult<{ sheetName?: string; reference: string }> {
  const trimmedInput = input.trim();
  if (trimmedInput.startsWith("'")) {
    const closingQuoteIndex = trimmedInput.indexOf("'!");
    if (closingQuoteIndex <= 1) {
      return { ok: false, reason: 'invalid-format' };
    }

    return {
      ok: true,
      value: {
        sheetName: trimmedInput.slice(1, closingQuoteIndex),
        reference: trimmedInput.slice(closingQuoteIndex + 2),
      },
    };
  }

  const separatorIndex = trimmedInput.indexOf('!');
  if (separatorIndex === -1) {
    return { ok: true, value: { reference: trimmedInput } };
  }

  if (separatorIndex === 0 || separatorIndex === trimmedInput.length - 1) {
    return { ok: false, reason: 'invalid-format' };
  }

  return {
    ok: true,
    value: {
      sheetName: trimmedInput.slice(0, separatorIndex).trim(),
      reference: trimmedInput.slice(separatorIndex + 1),
    },
  };
}
