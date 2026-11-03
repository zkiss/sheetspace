import { useCallback, useEffect, useRef, useState } from 'react';
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
  const observedTarget = useRef<string | null>(null);
  const begin = useCallback((source: SheetDocument, targetId: string) => {
    observedTarget.current = null;
    setHandoff({ source, targetId, ready: false });
  }, []);
  const cancel = useCallback((targetId?: string) => {
    setHandoff((current) => !targetId || current?.targetId === targetId ? null : current);
  }, []);
  const targetReady = useCallback((targetId: string) => {
    setHandoff((current) => current?.targetId === targetId && !current.ready ? { ...current, ready: true } : current);
  }, []);
  const targetExists = handoff ? sheetIds.includes(handoff.targetId) : false;

  useEffect(() => {
    if (!handoff) return;
    if (targetExists) observedTarget.current = handoff.targetId;
    else if (observedTarget.current === handoff.targetId) {
      cancel(handoff.targetId);
      return;
    }
    if (!handoff.ready) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) {
      cancel(handoff.targetId);
      return;
    }
    const onChange = () => { if (preference?.matches) cancel(handoff.targetId); };
    preference?.addEventListener?.('change', onChange);
    const timeout = window.setTimeout(() => cancel(handoff.targetId), EXTRACTION_HANDOFF_DURATION);
    return () => {
      window.clearTimeout(timeout);
      preference?.removeEventListener?.('change', onChange);
    };
  }, [cancel, handoff, targetExists]);

  return { handoff, begin, cancel, targetReady };
}
