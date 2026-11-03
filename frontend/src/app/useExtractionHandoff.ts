import { useCallback, useEffect, useState } from 'react';
import type { SheetDocument } from '@workbook/core/model';

export const EXTRACTION_HANDOFF_DURATION = 240;

type Handoff = {
  source: SheetDocument;
  targetId: string;
  ready: boolean;
};

/** Owns the transient source snapshot until the target has taken visual ownership. */
export function useExtractionHandoff(sheetIds: readonly string[]) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const begin = useCallback((source: SheetDocument, targetId: string) => {
    setHandoff({ source, targetId, ready: false });
  }, []);
  const cancel = useCallback(() => setHandoff(null), []);
  const targetReady = useCallback((targetId: string) => {
    setHandoff((current) => current?.targetId === targetId && !current.ready ? { ...current, ready: true } : current);
  }, []);
  const targetExists = handoff ? sheetIds.includes(handoff.targetId) : false;

  useEffect(() => {
    if (!handoff?.ready) return;
    if (!targetExists) {
      setHandoff(null);
      return;
    }
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) {
      setHandoff(null);
      return;
    }
    const onChange = () => { if (preference?.matches) setHandoff(null); };
    preference?.addEventListener?.('change', onChange);
    const timeout = window.setTimeout(() => setHandoff(null), EXTRACTION_HANDOFF_DURATION);
    return () => {
      window.clearTimeout(timeout);
      preference?.removeEventListener?.('change', onChange);
    };
  }, [handoff, targetExists]);

  return { handoff, begin, cancel, targetReady };
}
