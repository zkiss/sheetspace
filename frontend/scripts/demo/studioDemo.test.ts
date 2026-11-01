import { describe, expect, it } from 'vitest';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import type { Workbook } from '@workbook/core/model';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  DEMO_EXPECTATIONS,
  DEMO_SHEET_NAMES,
  EXPENSE_SUMMARY_SHEET,
  LABOUR_SUMMARY_SHEET,
  MAIN_SHEET,
  PROJECT_EXPENSES_SHEET,
  TEAM_TIME_SHEET,
  buildStudioDemoWorkbook,
  evaluateStudioDemo,
  studioDemoSummary,
  verifyStudioDemo,
} from './studioDemo';
import { FREELANCE_TIME_SHEET } from './studioDemo';
import { PROJECT_EXPENSE_MODEL, TIME_ENTRY_MODEL } from './studioDemoData';

function emptyWorkspace(): Workbook {
  return workbookWithSheets(DEMO_SHEET_NAMES.map((name, index) => sheetDocument({ id: `demo-sheet-${index}`, name })));
}

function sheetId(workbook: Workbook, name: string): string {
  const sheet = Object.values(workbook.documents).find((candidate) => candidate.name === name);
  if (!sheet) throw new Error(`Missing sheet ${name}`);
  return sheet.id;
}

function cell(snapshot: FormulaEvaluationSnapshot, workbook: Workbook, sheet: string, address: string) {
  return snapshot[sheetId(workbook, sheet)]?.[address];
}

function numberValue(snapshot: FormulaEvaluationSnapshot, workbook: Workbook, sheet: string, address: string): number {
  const value = cell(snapshot, workbook, sheet, address);
  return value?.kind === 'number' ? value.value : Number.NaN;
}

describe('studio demo workbook', () => {
  it('fills the six sheets and verifies cleanly', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());

    expect(Object.values(workbook.documents).map((sheet) => sheet.name)).toEqual([...DEMO_SHEET_NAMES]);
    expect(verifyStudioDemo(workbook)).toEqual([]);
  });

  it('binds both time sheets to one model with declaration-owned calculated columns', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());

    for (const name of [TEAM_TIME_SHEET, FREELANCE_TIME_SHEET]) {
      const sheet = workbook.documents[sheetId(workbook, name)]!;
      expect(sheet.modelId).toBe(TIME_ENTRY_MODEL.id);
      expect(Object.keys(sheet.modelColumnBindings ?? {})).toHaveLength(TIME_ENTRY_MODEL.columns.length);
      expect(Object.keys(sheet.modelFormulaBindings ?? {})).toEqual([
        '10000000-0000-4000-8000-000000000107',
        '10000000-0000-4000-8000-000000000108',
      ]);
    }
    const expenses = workbook.documents[sheetId(workbook, PROJECT_EXPENSES_SHEET)]!;
    expect(expenses.modelId).toBe(PROJECT_EXPENSE_MODEL.id);
    expect(expenses.content.rows).toHaveLength(15);
  });

  it('calculates labour cost and billable hours for every time entry', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const snapshot = evaluateStudioDemo(workbook);

    expect(cell(snapshot, workbook, TEAM_TIME_SHEET, 'G1')).toMatchObject({ kind: 'number', value: 620 });
    expect(cell(snapshot, workbook, TEAM_TIME_SHEET, 'H1')).toMatchObject({ kind: 'number', value: 10 });
    expect(cell(snapshot, workbook, FREELANCE_TIME_SHEET, 'G4')).toMatchObject({ kind: 'number', value: 384 });
    expect(cell(snapshot, workbook, FREELANCE_TIME_SHEET, 'H4')).toMatchObject({ kind: 'number', value: 0 });
    expect(cell(snapshot, workbook, PROJECT_EXPENSES_SHEET, 'F1')).toMatchObject({ kind: 'number', value: 1200 });
    expect(cell(snapshot, workbook, PROJECT_EXPENSES_SHEET, 'F12')).toMatchObject({ kind: 'number', value: 1140 });
  });

  it('sums both time sheets and the expense sheet per project', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const snapshot = evaluateStudioDemo(workbook);

    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'B2')).toMatchObject({ kind: 'number', value: 84 });
    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'C2')).toMatchObject({ kind: 'number', value: 84 });
    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'D2')).toMatchObject({ kind: 'number', value: 5188 });
    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'B3')).toMatchObject({ kind: 'number', value: 140 });
    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'C3')).toMatchObject({ kind: 'number', value: 132 });
    expect(cell(snapshot, workbook, LABOUR_SUMMARY_SHEET, 'D3')).toMatchObject({ kind: 'number', value: 9860 });

    expect(cell(snapshot, workbook, EXPENSE_SUMMARY_SHEET, 'B2')).toMatchObject({ kind: 'number', value: 2000 });
    expect(cell(snapshot, workbook, EXPENSE_SUMMARY_SHEET, 'C2')).toMatchObject({ kind: 'number', value: 3 });
    expect(cell(snapshot, workbook, EXPENSE_SUMMARY_SHEET, 'B5')).toMatchObject({ kind: 'number', value: 14340 });
    expect(cell(snapshot, workbook, EXPENSE_SUMMARY_SHEET, 'C5')).toMatchObject({ kind: 'number', value: 3 });
  });

  it('reports project profit, margin and budget status on the main sheet', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const snapshot = evaluateStudioDemo(workbook);
    const numbers = (address: string) => numberValue(snapshot, workbook, MAIN_SHEET, address);
    const text = (address: string) => cell(snapshot, workbook, MAIN_SHEET, address);

    expect(numbers('E5')).toBeCloseTo(84, 9);
    expect(numbers('F5')).toBeCloseTo(5188, 9);
    expect(numbers('G5')).toBeCloseTo(2000, 9);
    expect(numbers('H5')).toBeCloseTo(1037.6, 9);
    expect(numbers('I5')).toBeCloseTo(8225.6, 9);
    expect(numbers('J5')).toBeCloseTo(9774.4, 9);
    expect(numbers('K5')).toBeCloseTo(9774.4 / 18000, 12);
    expect(text('L5')).toMatchObject({ kind: 'text', value: 'Under budget' });

    expect(numbers('I8')).toBeCloseTo(25020, 9);
    expect(numbers('J8')).toBeCloseTo(-1020, 9);
    expect(text('L8')).toMatchObject({ kind: 'text', value: 'Over budget' });
    expect(text('L6')).toMatchObject({ kind: 'text', value: 'Over budget' });

    expect(numbers('C11')).toBeCloseTo(DEMO_EXPECTATIONS.totalFees, 9);
    expect(numbers('E11')).toBeCloseTo(DEMO_EXPECTATIONS.totalHours, 9);
    expect(numbers('F11')).toBeCloseTo(DEMO_EXPECTATIONS.totalLabour, 9);
    expect(numbers('G11')).toBeCloseTo(DEMO_EXPECTATIONS.totalExpenses, 9);
    expect(numbers('H11')).toBeCloseTo(DEMO_EXPECTATIONS.totalOverhead, 9);
    expect(numbers('I11')).toBeCloseTo(DEMO_EXPECTATIONS.totalCost, 9);
    expect(numbers('J11')).toBeCloseTo(DEMO_EXPECTATIONS.totalProfit, 9);
    expect(numbers('K11')).toBeCloseTo(DEMO_EXPECTATIONS.totalMargin, 12);
  });

  it('summarises each project for the initializer output', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const summary = studioDemoSummary(workbook);
    const expected = [
      { project: 'Brand refresh', fee: 18000, totalCost: 8225.6, profit: 9774.4, margin: 9774.4 / 18000, status: 'Under budget' },
      { project: 'Online shop', fee: 32000, totalCost: 14852, profit: 17148, margin: 17148 / 32000, status: 'Over budget' },
      { project: 'Annual report', fee: 14500, totalCost: 9442.8, profit: 5057.2, margin: 5057.2 / 14500, status: 'Under budget' },
      { project: 'Product launch', fee: 24000, totalCost: 25020, profit: -1020, margin: -1020 / 24000, status: 'Over budget' },
      { project: 'Packaging refresh', fee: 9500, totalCost: 4881.6, profit: 4618.4, margin: 4618.4 / 9500, status: 'Under budget' },
      { project: 'Website audit', fee: 7200, totalCost: 3259.2, profit: 3940.8, margin: 3940.8 / 7200, status: 'Under budget' },
    ];

    expect(summary.map(({ project, fee, status }) => ({ project, fee, status })))
      .toEqual(expected.map(({ project, fee, status }) => ({ project, fee, status })));
    summary.forEach((row, index) => {
      const want = expected[index]!;
      expect(row.totalCost).toBeCloseTo(want.totalCost, 9);
      expect(row.profit).toBeCloseTo(want.profit, 9);
      expect(row.margin).toBeCloseTo(want.margin, 12);
    });
  });

  it('formats the main sheet and leaves the helper sheets plain', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const main = workbook.documents[sheetId(workbook, MAIN_SHEET)]!;
    const labour = workbook.documents[sheetId(workbook, LABOUR_SUMMARY_SHEET)]!;
    const expenses = workbook.documents[sheetId(workbook, EXPENSE_SUMMARY_SHEET)]!;

    expect(Object.keys(main.presentation.columnWidths)).toHaveLength(main.content.columns.length);
    expect(Object.keys(main.presentation.formatOverrides?.rows ?? {})).toHaveLength(3);
    expect(Object.keys(main.presentation.formatOverrides?.columns ?? {})).toHaveLength(9);
    expect(Object.keys(main.presentation.formatOverrides?.cells ?? {}).length).toBeGreaterThan(10);

    for (const helper of [labour, expenses]) {
      expect(helper.presentation.columnWidths).toEqual({});
      expect(helper.presentation.formatOverrides).toBeUndefined();
    }
  });

  it('lays the report out large with smaller, unformatted helper frames', () => {
    const workbook = buildStudioDemoWorkbook(emptyWorkspace());
    const main = workbook.documents[sheetId(workbook, MAIN_SHEET)]!;
    const labour = workbook.documents[sheetId(workbook, LABOUR_SUMMARY_SHEET)]!;
    const expenses = workbook.documents[sheetId(workbook, EXPENSE_SUMMARY_SHEET)]!;

    expect(main.frame.visualScale).toBe(1);
    expect(main.frame.size.width).toBeGreaterThan(1000);
    for (const helper of [labour, expenses]) {
      expect(helper.frame.visualScale).toBeLessThan(1);
      expect(helper.frame.position.y).toBeLessThan(main.frame.position.y);
    }
    expect(labour.frame.zIndex).toBe(1);
    expect(main.frame.zIndex).toBe(2);
  });
});
