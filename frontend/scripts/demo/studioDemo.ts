import { bindSheetToModel } from '@application/core/modelLifecycle';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { classifyCellValue } from '@calculation/formulaValue';
import { columnIndexToLabel } from '@workbook/core/address';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { CellAppearance, DataModel, FrameState, SheetDocument, SheetFormatOverrides, Workbook } from '@workbook/core/model';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { formatPropertyReferenceToken } from '@workbook/formula/syntax';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { cellRawContent } from '@workbook/read/queries';
import {
  EXPENSES,
  FREELANCE_TIME,
  OVERHEAD_RATE,
  PROJECTS,
  PROJECT_EXPENSE_MODEL,
  TEAM_TIME,
  TIME_ENTRY_MODEL,
  type EntryValues,
} from './studioDemoData';

export const MAIN_SHEET = 'Project Profitability';
export const LABOUR_SUMMARY_SHEET = 'Labour Summary';
export const EXPENSE_SUMMARY_SHEET = 'Expense Summary';
export const TEAM_TIME_SHEET = 'Team Time';
export const FREELANCE_TIME_SHEET = 'Freelance Time';
export const PROJECT_EXPENSES_SHEET = 'Project Expenses';

/** Creation and list order: the report first, its sources after it. */
export const DEMO_SHEET_NAMES = [
  MAIN_SHEET,
  LABOUR_SUMMARY_SHEET,
  EXPENSE_SUMMARY_SHEET,
  TEAM_TIME_SHEET,
  FREELANCE_TIME_SHEET,
  PROJECT_EXPENSES_SHEET,
] as const;

/** Figures the fixture is designed to produce, shared by the test and the initializer's verification. */
export const DEMO_EXPECTATIONS = {
  totalFees: 105200,
  totalHours: 549,
  totalLabour: 35226,
  totalExpenses: 23410,
  totalOverhead: 7045.2,
  totalCost: 65681.2,
  totalProfit: 39518.8,
  totalMargin: 39518.8 / 105200,
  overBudgetProjects: ['Online shop', 'Product launch'],
};

const NAVY = '#1f3a5f';
const TEAL = '#2f6f6a';
const TOTAL_FILL = '#e6ecf2';
const MUTED_TEXT = '#5f6b76';
const OVER_BUDGET: CellAppearance = { fillColor: '#fbe9e7', textColor: '#a12a1f' };
const UNDER_BUDGET: CellAppearance = { fillColor: '#e7f2ea', textColor: '#1f6f3f' };
const NEGATIVE_TEXT: CellAppearance = { textColor: '#a12a1f' };

const COLUMN_WIDTHS = [190, 170, 90, 100, 70, 85, 85, 85, 95, 95, 70, 110];
const SUMMARY_ROW_HEIGHT = 26;

const randomId = (): string => crypto.randomUUID();

/**
 * Populates the six empty demo sheets with models, data, formulas, presentation and layout.
 *
 * The input sheets bind to the same models the app uses, so calculated properties and
 * cross-sheet references here are ordinary product behaviour rather than special cases.
 */
export function buildStudioDemoWorkbook(base: Workbook): Workbook {
  const models = [TIME_ENTRY_MODEL, PROJECT_EXPENSE_MODEL];
  let workbook: Workbook = {
    ...base,
    dataModels: { ...base.dataModels, ...Object.fromEntries(models.map((model) => [model.id, model])) },
  };
  workbook = buildBoundSheet(workbook, TEAM_TIME_SHEET, TIME_ENTRY_MODEL, TEAM_TIME);
  workbook = buildBoundSheet(workbook, FREELANCE_TIME_SHEET, TIME_ENTRY_MODEL, FREELANCE_TIME);
  workbook = buildBoundSheet(workbook, PROJECT_EXPENSES_SHEET, PROJECT_EXPENSE_MODEL, EXPENSES);
  workbook = buildLabourSummary(workbook);
  workbook = buildExpenseSummary(workbook);
  workbook = buildMainSheet(workbook);
  workbook = prepareFormulas(workbook, [LABOUR_SUMMARY_SHEET, EXPENSE_SUMMARY_SHEET, MAIN_SHEET]);
  workbook = decorateMainSheet(workbook, evaluateStudioDemo(workbook));
  return applyFrames(workbook);
}

export function evaluateStudioDemo(workbook: Workbook): FormulaEvaluationSnapshot {
  return new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
}

export type DemoSummaryRow = {
  project: string;
  fee: number;
  totalCost: number;
  profit: number;
  margin: number;
  status: string;
};

/** Reads the main sheet's results the way a reader would: by its visible A1 addresses. */
export function studioDemoSummary(workbook: Workbook): DemoSummaryRow[] {
  const main = requireSheet(workbook, MAIN_SHEET);
  const snapshot = evaluateStudioDemo(workbook);
  return PROJECTS.map((project, index) => {
    const row = index + 5;
    return {
      project: project.name,
      fee: numberAt(workbook, snapshot, main.id, `C${row}`),
      totalCost: numberAt(workbook, snapshot, main.id, `I${row}`),
      profit: numberAt(workbook, snapshot, main.id, `J${row}`),
      margin: numberAt(workbook, snapshot, main.id, `K${row}`),
      status: textAt(snapshot, main.id, `L${row}`),
    };
  });
}

/** Returns every way the saved workbook fails to match the intended demo; empty means healthy. */
export function verifyStudioDemo(workbook: Workbook): string[] {
  const missing = DEMO_SHEET_NAMES.filter((name) => findSheet(workbook, name) === undefined);
  if (missing.length > 0) return missing.map((name) => `missing sheet ${name}`);

  const problems: string[] = [];
  const snapshot = evaluateStudioDemo(workbook);
  for (const [sheetId, cells] of Object.entries(snapshot)) {
    const name = workbook.documents[sheetId]?.name ?? sheetId;
    for (const [key, value] of Object.entries(cells)) {
      if (value.kind === 'error') problems.push(`${name}!${key} is ${value.error}`);
    }
  }

  const main = requireSheet(workbook, MAIN_SHEET);
  const expectedTotals: readonly (readonly [string, number])[] = [
    ['C11', DEMO_EXPECTATIONS.totalFees],
    ['E11', DEMO_EXPECTATIONS.totalHours],
    ['F11', DEMO_EXPECTATIONS.totalLabour],
    ['G11', DEMO_EXPECTATIONS.totalExpenses],
    ['H11', DEMO_EXPECTATIONS.totalOverhead],
    ['I11', DEMO_EXPECTATIONS.totalCost],
    ['J11', DEMO_EXPECTATIONS.totalProfit],
    ['K11', DEMO_EXPECTATIONS.totalMargin],
  ];
  for (const [key, expected] of expectedTotals) {
    const actual = numberAt(workbook, snapshot, main.id, key);
    if (!closeTo(actual, expected)) problems.push(`${MAIN_SHEET}!${key} is ${actual}, expected ${expected}`);
  }
  for (const row of studioDemoSummary(workbook)) {
    const expected = DEMO_EXPECTATIONS.overBudgetProjects.includes(row.project) ? 'Over budget' : 'Under budget';
    if (row.status !== expected) problems.push(`${row.project} is ${row.status}, expected ${expected}`);
  }
  return problems;
}

function buildBoundSheet(workbook: Workbook, name: string, model: DataModel, entries: readonly EntryValues[]): Workbook {
  const sheet = requireSheet(workbook, name);
  const columns = model.columns.map(randomId);
  const rows = entries.map(randomId);
  const cells: Record<string, string> = {};
  entries.forEach((entry, rowIndex) => {
    model.columns.forEach((column, columnIndex) => {
      if (column.kind !== 'manual') return;
      const value = entry[column.name];
      if (value === undefined) throw new Error(`${name} row ${rowIndex + 1} has no value for ${column.name}.`);
      const raw = cellText(value);
      if (raw !== '') cells[cellIdentityKey({ rowId: rows[rowIndex]!, columnId: columns[columnIndex]! })] = raw;
    });
  });
  const structured = replaceSheet(workbook, {
    ...sheet,
    content: { kind: 'tabular', rows, columns, cells },
    presentation: { rowHeights: {}, columnWidths: {} },
    columnNames: undefined,
    modelId: undefined,
    modelColumnBindings: undefined,
    modelFormulaBindings: undefined,
  });
  const bound = bindSheetToModel(structured, sheet.id, model.id, randomId);
  if (!bound.ok) throw new Error(`Could not bind ${name} to ${model.name}: ${bound.reason}`);
  return bound.value;
}

function buildLabourSummary(workbook: Workbook): Workbook {
  const headers = ['Project', 'Hours', 'Billable Hours', 'Labour Cost'];
  const cells: Record<string, string> = {};
  headers.forEach((header, index) => { cells[`${columnIndexToLabel(index)}1`] = header; });
  PROJECTS.forEach((project, index) => {
    const row = index + 2;
    cells[`A${row}`] = project.name;
    cells[`B${row}`] = `=${sumTimeSheets('Hours', row)}`;
    cells[`C${row}`] = `=${sumTimeSheets('Billable Hours', row)}`;
    cells[`D${row}`] = `=${sumTimeSheets('Labour Cost', row)}`;
  });
  return buildOrdinarySheet(workbook, LABOUR_SUMMARY_SHEET, headers, PROJECTS.length + 1, cells);
}

function buildExpenseSummary(workbook: Workbook): Workbook {
  const headers = ['Project', 'Expenses', 'Items'];
  const cells: Record<string, string> = {};
  headers.forEach((header, index) => { cells[`${columnIndexToLabel(index)}1`] = header; });
  PROJECTS.forEach((project, index) => {
    const row = index + 2;
    cells[`A${row}`] = project.name;
    cells[`B${row}`] = `=${sumIf(PROJECT_EXPENSES_SHEET, 'Project', EXPENSES.length, `@A[${row}]`, 'Amount')}`;
    cells[`C${row}`] = `=${countIf(PROJECT_EXPENSES_SHEET, 'Project', EXPENSES.length, `@A[${row}]`)}`;
  });
  return buildOrdinarySheet(workbook, EXPENSE_SUMMARY_SHEET, headers, PROJECTS.length + 1, cells);
}

function buildMainSheet(workbook: Workbook): Workbook {
  const headers = ['Project', 'Client', 'Fee', 'Cost Budget', 'Hours', 'Labour', 'Expenses', 'Overhead', 'Total Cost', 'Profit', 'Margin', 'Budget Status'];
  const cells: Record<string, string> = {
    A1: 'Studio profitability',
    A2: 'Overhead rate',
    B2: String(OVERHEAD_RATE),
    A11: 'Total',
    A13: 'Inputs: Team Time, Freelance Time, Project Expenses',
  };
  headers.forEach((header, index) => { cells[`${columnIndexToLabel(index)}4`] = header; });
  PROJECTS.forEach((project, index) => {
    const row = index + 5;
    const summaryRow = index + 2;
    cells[`A${row}`] = project.name;
    cells[`B${row}`] = project.client;
    cells[`C${row}`] = String(project.fee);
    cells[`D${row}`] = String(project.costBudget);
    cells[`E${row}`] = `=@'${LABOUR_SUMMARY_SHEET}'!Hours[${summaryRow}]`;
    cells[`F${row}`] = `=@'${LABOUR_SUMMARY_SHEET}'!${formatPropertyReferenceToken('Labour Cost')}[${summaryRow}]`;
    cells[`G${row}`] = `=@'${EXPENSE_SUMMARY_SHEET}'!Expenses[${summaryRow}]`;
    cells[`H${row}`] = `=@F[${row}]*@$B[$2]`;
    cells[`I${row}`] = `=@F[${row}]+@G[${row}]+@H[${row}]`;
    cells[`J${row}`] = `=@C[${row}]-@I[${row}]`;
    cells[`K${row}`] = `=IF(@C[${row}]=0, 0, @J[${row}]/@C[${row}])`;
    cells[`L${row}`] = `=IF(@I[${row}]<=@D[${row}], "Under budget", "Over budget")`;
  });
  for (const column of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
    cells[`${column}11`] = `=SUM(@${column}[5]:${column}[10])`;
  }
  cells.K11 = '=IF(@C[11]=0, 0, @J[11]/@C[11])';
  return buildOrdinarySheet(workbook, MAIN_SHEET, headers, 13, cells);
}

function decorateMainSheet(workbook: Workbook, snapshot: FormulaEvaluationSnapshot): Workbook {
  const sheet = requireSheet(workbook, MAIN_SHEET);
  const { rows, columns } = sheet.content;
  const key = (rowIndex: number, columnIndex: number) => cellIdentityKey({ rowId: rows[rowIndex]!, columnId: columns[columnIndex]! });
  const cells: Record<string, CellAppearance> = {
    [key(0, 0)]: { textColor: '#ffffff', fontWeight: 'bold' },
    [key(1, 0)]: { fontWeight: 'bold' },
    [key(1, 1)]: { numberFormat: { kind: 'percent', precision: 0 }, fontWeight: 'bold' },
    [key(12, 0)]: { textColor: MUTED_TEXT },
  };
  PROJECTS.forEach((_, index) => {
    const row = index + 5;
    const status = textAt(snapshot, sheet.id, `L${row}`);
    cells[key(index + 4, 11)] = status === 'Over budget' ? OVER_BUDGET : UNDER_BUDGET;
    if (numberAt(workbook, snapshot, sheet.id, `J${row}`) < 0) {
      cells[key(index + 4, 9)] = NEGATIVE_TEXT;
      cells[key(index + 4, 10)] = NEGATIVE_TEXT;
    }
  });
  const formats: SheetFormatOverrides = {
    rows: {
      [rows[0]!]: { fillColor: NAVY, textColor: '#ffffff', fontWeight: 'bold' },
      [rows[3]!]: { fillColor: TEAL, textColor: '#ffffff', fontWeight: 'bold', horizontalAlignment: 'center' },
      [rows[10]!]: { fillColor: TOTAL_FILL, fontWeight: 'bold' },
    },
    columns: Object.fromEntries([
      [columns[2]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[3]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[4]!, { numberFormat: { kind: 'number', precision: 1 } }],
      [columns[5]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[6]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[7]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[8]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[9]!, { numberFormat: { kind: 'number', precision: 0 } }],
      [columns[10]!, { numberFormat: { kind: 'percent', precision: 1 } }],
    ]),
    cells,
  };
  const rowHeights: Record<string, number> = {
    [rows[0]!]: 38,
    [rows[1]!]: 24,
    [rows[2]!]: 16,
    [rows[3]!]: 30,
    [rows[10]!]: 28,
    [rows[11]!]: 16,
    [rows[12]!]: 22,
  };
  for (let index = 4; index < 10; index += 1) rowHeights[rows[index]!] = SUMMARY_ROW_HEIGHT;
  const columnWidths = Object.fromEntries(columns.map((id, index) => [id, COLUMN_WIDTHS[index]!]));
  return replaceSheet(workbook, { ...sheet, presentation: { rowHeights, columnWidths, formatOverrides: formats } });
}

function buildOrdinarySheet(
  workbook: Workbook,
  name: string,
  columnNames: readonly string[],
  rowCount: number,
  cellsByAddress: Readonly<Record<string, string>>,
): Workbook {
  const sheet = requireSheet(workbook, name);
  const columns = columnNames.map(randomId);
  const rows = Array.from({ length: rowCount }, randomId);
  const content: SheetDocument['content'] = { kind: 'tabular', rows, columns, cells: {} };
  for (const [address, raw] of Object.entries(cellsByAddress)) {
    const identity = cellIdentityAt(content, address);
    if (!identity) throw new Error(`${name}!${address} is outside the demo sheet.`);
    content.cells[cellIdentityKey(identity)] = raw;
  }
  return replaceSheet(workbook, {
    ...sheet,
    content,
    columnNames: Object.fromEntries(columns.map((id, index) => [id, columnNames[index]!])),
    presentation: { rowHeights: {}, columnWidths: {} },
    modelId: undefined,
    modelColumnBindings: undefined,
    modelFormulaBindings: undefined,
  });
}

/** Prepared once every sheet, row, column and name exists, exactly as a committed edit would be. */
function prepareFormulas(workbook: Workbook, sheetNames: readonly string[]): Workbook {
  const documents = { ...workbook.documents };
  for (const name of sheetNames) {
    const sheet = requireSheet(workbook, name);
    const cells = { ...sheet.content.cells };
    for (const [key, raw] of Object.entries(cells)) {
      if (raw.startsWith('=')) cells[key] = prepareUserFormula(raw, workbook, sheet.id);
    }
    documents[sheet.id] = { ...sheet, content: { ...sheet.content, cells } };
  }
  return { ...workbook, documents };
}

function applyFrames(workbook: Workbook): Workbook {
  const frames: Readonly<Record<string, FrameState>> = {
    [MAIN_SHEET]: { position: { x: 1, y: 1 }, size: { width: 1320, height: 520 }, visualScale: 1, zIndex: 2 },
    [LABOUR_SUMMARY_SHEET]: { position: { x: -440, y: -300 }, size: { width: 400, height: 260 }, visualScale: 0.55, zIndex: 1 },
    [EXPENSE_SUMMARY_SHEET]: { position: { x: -20, y: -300 }, size: { width: 340, height: 260 }, visualScale: 0.55, zIndex: 1 },
    [TEAM_TIME_SHEET]: { position: { x: 1, y: 561 }, size: { width: 600, height: 460 }, visualScale: 0.7, zIndex: 1 },
    [FREELANCE_TIME_SHEET]: { position: { x: 640, y: 560 }, size: { width: 560, height: 320 }, visualScale: 0.7, zIndex: 1 },
    [PROJECT_EXPENSES_SHEET]: { position: { x: 1240, y: 560 }, size: { width: 520, height: 360 }, visualScale: 0.7, zIndex: 1 },
  };
  let next = workbook;
  for (const [name, frame] of Object.entries(frames)) next = replaceSheet(next, { ...requireSheet(next, name), frame });
  return next;
}

function sumTimeSheets(columnName: string, criterionRow: number): string {
  return [
    sumIf(TEAM_TIME_SHEET, 'Project', TEAM_TIME.length, `@A[${criterionRow}]`, columnName),
    sumIf(FREELANCE_TIME_SHEET, 'Project', FREELANCE_TIME.length, `@A[${criterionRow}]`, columnName),
  ].join(' + ');
}

function sumIf(sheetName: string, rangeColumn: string, rowCount: number, criterion: string, sumColumn = rangeColumn): string {
  const range = (columnName: string) => `@'${sheetName}'!${formatPropertyReferenceToken(columnName)}[1]:${formatPropertyReferenceToken(columnName)}[${rowCount}]`;
  return `SUMIF(${range(rangeColumn)}, ${criterion}, ${range(sumColumn)})`;
}

function countIf(sheetName: string, rangeColumn: string, rowCount: number, criterion: string): string {
  const token = formatPropertyReferenceToken(rangeColumn);
  return `COUNTIF(@'${sheetName}'!${token}[1]:${token}[${rowCount}], ${criterion})`;
}

function cellText(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
}

function findSheet(workbook: Workbook, name: string): SheetDocument | undefined {
  return Object.values(workbook.documents).find((sheet) => sheet.name === name);
}

function requireSheet(workbook: Workbook, name: string): SheetDocument {
  const sheet = findSheet(workbook, name);
  if (!sheet) throw new Error(`The demo needs a sheet named ${JSON.stringify(name)}.`);
  return sheet;
}

function replaceSheet(workbook: Workbook, sheet: SheetDocument): Workbook {
  return { ...workbook, documents: { ...workbook.documents, [sheet.id]: sheet } };
}

function numberAt(workbook: Workbook, snapshot: FormulaEvaluationSnapshot, sheetId: string, key: string): number {
  const value = snapshot[sheetId]?.[key];
  if (value) return value.kind === 'number' ? value.value : Number.NaN;
  const sheet = workbook.documents[sheetId];
  const literal = sheet ? classifyCellValue(cellRawContent(sheet, key) ?? '') : { kind: 'blank' as const };
  return literal.kind === 'number' ? literal.value : Number.NaN;
}

function textAt(snapshot: FormulaEvaluationSnapshot, sheetId: string, key: string): string {
  const value = snapshot[sheetId]?.[key];
  return value?.kind === 'text' ? value.value : '';
}

function closeTo(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) < 0.005;
}

