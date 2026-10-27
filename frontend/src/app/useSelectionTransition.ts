import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CellTarget } from '@grid/cellInteractionContracts';

export function useSelectionTransition(activeCell: CellTarget | null) {
  const previous = useRef(activeCell);
  const [transition, setTransition] = useState<{ from: CellTarget; to: CellTarget; id: number } | null>(null);
  const nextId = useRef(0);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = activeCell;
    if (!from || !activeCell || from.sheetId === activeCell.sheetId) return;
    const id = ++nextId.current;
    setTransition({ from, to: activeCell, id });
  }, [activeCell]);
  useEffect(() => {
    if (!transition) return;
    const timeout = window.setTimeout(() => setTransition(null), 400);
    return () => window.clearTimeout(timeout);
  }, [transition]);
  useLayoutEffect(() => { previous.current = activeCell; }, [activeCell]);
  return transition;
}
