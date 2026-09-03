/** Stable graph identity shared by dependency analysis and evaluation. */
export function sheetCellNodeId(sheetId: string, key: string): string {
  return `${sheetId}\u0000${key}`;
}
