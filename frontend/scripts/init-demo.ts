import {
  decodeSheetDocument,
  decodeWorkbookBundle,
  encodeWorkbookBundle,
  type SheetDocumentResponse,
  type WorkbookBundleResponse,
} from '@infrastructure/persistence/workbookApi';
import type { Workbook } from '@workbook/core/model';
import {
  DEMO_EXPECTATIONS,
  DEMO_SHEET_NAMES,
  buildStudioDemoWorkbook,
  studioDemoSummary,
  verifyStudioDemo,
} from './demo/studioDemo';

const DEFAULT_BASE_URL = 'http://localhost:8080';

type ProcessLike = {
  argv?: string[];
  env?: Record<string, string | undefined>;
  exitCode?: number;
};

const processLike = (globalThis as { process?: ProcessLike }).process;

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not initialise the studio demo: ${message}`);
  if (processLike) processLike.exitCode = 1;
});

async function main(): Promise<void> {
  const baseUrl = requestedBaseUrl();
  const initial = await loadBundle(baseUrl);
  if (initial.manifest.sheetIds.length > 0) {
    throw new Error(
      `the workspace already has ${initial.manifest.sheetIds.length} sheet(s); ` +
        'the studio demo only initialises an empty workspace',
    );
  }

  const createdSheetIds: string[] = [];
  let saved: Workbook;
  try {
    for (const name of DEMO_SHEET_NAMES) createdSheetIds.push(await createSheet(baseUrl, name));

    // Reload so the lifecycle write carries the exact current content the server expects.
    const before = await loadBundle(baseUrl);
    const after = buildStudioDemoWorkbook(before);
    saved = await saveModelLifecycle(baseUrl, before, after);
  } catch (error) {
    await removeSheets(baseUrl, createdSheetIds);
    throw error;
  }

  const problems = verifyStudioDemo(saved);
  if (problems.length > 0) {
    throw new Error(`the demo was saved but does not match expectations:\n  ${problems.join('\n  ')}`);
  }

  printSummary(saved);
}

function requestedBaseUrl(): string {
  const argument = processLike?.argv?.find((value) => /^https?:\/\//.test(value));
  const environment = processLike?.env?.SHEETSPACE_URL?.trim();
  return (argument ?? environment ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function loadBundle(baseUrl: string): Promise<Workbook> {
  return decodeWorkbookBundle(await requestJson<WorkbookBundleResponse>(baseUrl, '/api/workbook/bundle'));
}

async function createSheet(baseUrl: string, name: string): Promise<string> {
  const document = await requestJson<SheetDocumentResponse>(baseUrl, '/api/sheets', {
    method: 'POST',
    body: JSON.stringify({ name, position: { x: 0, y: 0 } }),
  });
  return decodeSheetDocument(document).id;
}

async function removeSheets(baseUrl: string, sheetIds: readonly string[]): Promise<void> {
  if (sheetIds.length === 0) return;
  try {
    const current = await loadBundle(baseUrl);
    for (const sheetId of sheetIds) {
      const sheet = current.documents[sheetId];
      if (!sheet) continue;
      await requestJson(baseUrl, `/api/sheets/${encodeURIComponent(sheetId)}`, {
        method: 'DELETE',
        headers: { 'If-Match': String(sheet.revision) },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not roll back the sheets created before the failure: ${message}`);
  }
}

async function saveModelLifecycle(baseUrl: string, before: Workbook, after: Workbook): Promise<Workbook> {
  const response = await requestJson<WorkbookBundleResponse>(baseUrl, '/api/workbook/model-lifecycle', {
    method: 'PUT',
    body: JSON.stringify({ before: encodeWorkbookBundle(before), after: encodeWorkbookBundle(after) }),
  });
  return decodeWorkbookBundle(response);
}

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const code = (payload as { error?: unknown } | undefined)?.error;
    const detail = typeof code === 'string' ? code : `HTTP ${response.status}`;
    throw new Error(`${init.method ?? 'GET'} ${path} failed: ${detail}`);
  }
  return payload as T;
}

function printSummary(workbook: Workbook): void {
  const rows = studioDemoSummary(workbook);
  const money = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 });
  const totalFee = rows.reduce((sum, row) => sum + row.fee, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const totalProfit = rows.reduce((sum, row) => sum + row.profit, 0);

  const lines = [
    ['Project', 'Fee', 'Total cost', 'Profit', 'Margin', 'Status'],
    ...rows.map((row) => [
      row.project,
      money.format(row.fee),
      money.format(row.totalCost),
      money.format(row.profit),
      percent.format(row.margin),
      row.status,
    ]),
    ['Total', money.format(totalFee), money.format(totalCost), money.format(totalProfit), percent.format(totalProfit / totalFee), ''],
  ];
  const widths = lines[0]!.map((_, index) => Math.max(...lines.map((line) => line[index]!.length)));
  const formatLine = (line: readonly string[]) =>
    line.map((cell, index) => (index === line.length - 1 ? cell : cell.padEnd(widths[index]!))).join('  ').trimEnd();

  console.log('Studio demo created.\n');
  for (const [index, line] of lines.entries()) {
    console.log(formatLine(line));
    if (index === 0) console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  }
  console.log(`\nHours logged: ${DEMO_EXPECTATIONS.totalHours}`);
  console.log(`Sheets: ${DEMO_SHEET_NAMES.join(', ')}`);
}
