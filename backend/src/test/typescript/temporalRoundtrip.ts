import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { decodeWorkbookBundle } from '../../../../frontend/src/infrastructure/persistence/workbookApi';
import { calculationProjection } from '../../../../frontend/src/workbook/read/calculationProjection';
import { evaluateStoredFormulaCells } from '../../../../frontend/src/calculation/formulaEvaluator';
import { classifyCellValue } from '../../../../frontend/src/calculation/formulaValue';
import { freezeCalculatedColumns } from '../../../../frontend/src/application/core/modelLifecycle';
import { cellRawContent } from '../../../../frontend/src/workbook/read/queries';

const workbook = decodeWorkbookBundle(JSON.parse(readFileSync(0, 'utf8')));
const sheet = Object.values(workbook.documents)[0]!;
const snapshot = evaluateStoredFormulaCells(calculationProjection(workbook), workbook);
const values = snapshot[sheet.id]!;
deepStrictEqual(classifyCellValue(cellRawContent(sheet, 'A1')!), { kind: 'date', value: '2024-02-29' });
deepStrictEqual(classifyCellValue(cellRawContent(sheet, 'B1')!), { kind: 'datetime', value: '2024-02-29 00:00:00.120000000' });
deepStrictEqual(classifyCellValue(cellRawContent(sheet, 'C1')!), { kind: 'text', value: '2024-02-29' });
deepStrictEqual(values.D1, { kind: 'datetime', value: '2024-02-29 00:00:00.120000000', display: '2024-02-29 00:00:00.120000000' });

const model = { id: 'model', name: 'Model', columns: [{ id: 'result', name: 'Result', kind: 'calculated', type: 'string', formula: '=1' }] } as const;
const boundSheet = { ...sheet, modelId: model.id, modelColumnBindings: { result: sheet.content.columns[3]! } };
const frozen = freezeCalculatedColumns({ ...workbook, dataModels: { [model.id]: model } }, boundSheet, snapshot);
deepStrictEqual(classifyCellValue(cellRawContent(frozen, 'D1')!), { kind: 'datetime', value: '2024-02-29 00:00:00.120000000' });
