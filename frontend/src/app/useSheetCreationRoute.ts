import { useCallback, useEffect, useRef } from 'react';

/**
 * Creation belongs to the canvas workspace. While a transient sheet
 * presentation is active, restore it before the caller places and opens the
 * creation dialog so the sheet that is visible and the sheet that will receive
 * the selection stay the same.
 */
export function useSheetCreationRoute({
  ensureCanvas,
  openCreationDialog,
  presentationActive,
}: {
  ensureCanvas: () => Promise<'settled' | 'cancelled'>;
  openCreationDialog: () => void;
  presentationActive: boolean;
}) {
  const latest = useRef({ ensureCanvas, openCreationDialog, presentationActive });
  latest.current = { ensureCanvas, openCreationDialog, presentationActive };
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return useCallback(() => {
    if (pending.current) return;
    const current = latest.current;
    if (!current.presentationActive) { current.openCreationDialog(); return; }
    const operation = current.ensureCanvas().then((result) => {
      if (result === 'settled' && mounted.current) latest.current.openCreationDialog();
    }).finally(() => {
      if (pending.current === operation) pending.current = null;
    });
    pending.current = operation;
  }, []);
}
