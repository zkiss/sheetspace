import type { SheetDocument, Workbook } from '@workbook/core/model';
import { sheetsInOrder } from '@workbook/read/queries';

const MAX_Z = 2147483647;

export function insertExtractionStacking(workbook: Workbook, sourceId: string, target: SheetDocument): Workbook {
  const manifest = sheetsInOrder(workbook);
  const rank = new Map([...manifest, target].map((sheet, index) => [sheet.id, index]));
  const ordered = [...manifest].sort((a, b) => a.frame.zIndex - b.frame.zIndex);
  const targetIndex = ordered.findIndex((sheet) => sheet.id === sourceId) + 1;
  ordered.splice(targetIndex, 0, target);
  const offsets = ordered.map(() => 0);
  for (let i = 1; i < ordered.length; i++) {
    offsets[i] = offsets[i - 1]! + Number(rank.get(ordered[i - 1]!.id)! > rank.get(ordered[i]!.id)!);
  }
  const low = 1 + offsets[targetIndex]!;
  const high = MAX_Z - (offsets[offsets.length - 1]! - offsets[targetIndex]!);
  // Costs change only when a clamped original crosses its old value.
  const candidates = new Set([low, high, ordered[targetIndex - 1]!.frame.zIndex, ...ordered.flatMap((sheet, i) => i === targetIndex ? [] : [sheet.frame.zIndex + offsets[targetIndex]! - offsets[i]!])]);
  let best: number[] | undefined;
  let bestCost = Infinity;
  for (const value of [...candidates].filter((n) => n >= low && n <= high).sort((a, b) => Math.abs(a - ordered[targetIndex - 1]!.frame.zIndex) - Math.abs(b - ordered[targetIndex - 1]!.frame.zIndex) || b - a)) {
    const values = ordered.map((sheet) => sheet.frame.zIndex);
    values[targetIndex] = value;
    for (let i = targetIndex - 1; i >= 0; i--) values[i] = Math.min(values[i]!, values[i + 1]! - (offsets[i + 1]! - offsets[i]!));
    for (let i = targetIndex + 1; i < values.length; i++) values[i] = Math.max(values[i]!, values[i - 1]! + (offsets[i]! - offsets[i - 1]!));
    const cost = values.reduce((count, z, i) => count + Number(i !== targetIndex && z !== ordered[i]!.frame.zIndex), 0);
    if (cost < bestCost) { best = values; bestCost = cost; }
  }
  const documents = { ...workbook.documents };
  ordered.forEach((sheet, index) => {
    documents[sheet.id] = sheet.frame.zIndex === best![index] ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex: best![index]! } };
  });
  return { ...workbook, manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, target.id] }, documents };
}
