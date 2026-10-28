import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CellTarget } from '@grid/cellInteractionContracts';

export function useSelectionTransition(activeCell: CellTarget | null) {
  const previous = useRef(activeCell);
  const [transition, setTransition] = useState<{ from: CellTarget; to: CellTarget; id: number } | null>(null);
  const nextId = useRef(0);
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (preference?.matches) setTransition(null); };
    preference?.addEventListener?.('change', onChange);
    return () => preference?.removeEventListener?.('change', onChange);
  }, []);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = activeCell;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setTransition(null);
      return;
    }
    if (!from || !activeCell || from.sheetId === activeCell.sheetId) return;
    const id = ++nextId.current;
    setTransition({ from, to: activeCell, id });
  }, [activeCell]);
  useEffect(() => {
    if (!transition) return;
    const timeout = window.setTimeout(() => setTransition(null), 400);
    return () => window.clearTimeout(timeout);
  }, [transition]);
  return transition;
}
