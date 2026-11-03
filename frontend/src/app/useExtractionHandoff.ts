import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SheetDocument } from '@workbook/core/model';

export const EXTRACTION_HANDOFF_DURATION = 240;

type Handoff = {
  source: SheetDocument;
  targetId: string;
  token: number;
  accepted: boolean;
  ready: boolean;
};

/** Owns the transient source snapshot until the target has taken visual ownership. */
export function useExtractionHandoff(sheetIds: readonly string[]) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  const begin = useCallback((source: SheetDocument, targetId: string) => {
    const token = ++generation.current;
    active.current = token;
    setHandoff({ source, targetId, token, accepted: false, ready: false });
    return token;
  }, []);
  const cancel = useCallback((token: number) => {
    if (active.current !== token) return;
    active.current = null;
    setHandoff((current) => current?.token === token ? null : current);
  }, []);
  const accepted = useCallback((token: number) => {
    if (active.current !== token) return;
    setHandoff((current) => current?.token === token ? { ...current, accepted: true } : current);
  }, []);
  const targetReady = useCallback((token: number) => {
    if (active.current !== token) return;
    setHandoff((current) => current?.token === token && !current.ready ? { ...current, ready: true } : current);
  }, []);
  const targetNotReady = useCallback((token: number) => {
    if (active.current !== token) return;
    setHandoff((current) => current?.token === token && current.ready ? { ...current, ready: false } : current);
  }, []);
  const targetExists = handoff ? sheetIds.includes(handoff.targetId) : false;
  const sourceExists = handoff ? sheetIds.includes(handoff.source.id) : false;

  useLayoutEffect(() => {
    if (handoff?.accepted && (!targetExists || !sourceExists)) cancel(handoff.token);
  }, [cancel, handoff, sourceExists, targetExists]);
  useEffect(() => {
    if (!handoff?.ready || !handoff.accepted || !targetExists || !sourceExists) return;
    const token = handoff.token;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) { cancel(token); return; }
    const onChange = () => { if (preference?.matches) cancel(token); };
    preference?.addEventListener?.('change', onChange);
    const timeout = window.setTimeout(() => cancel(token), EXTRACTION_HANDOFF_DURATION);
    return () => {
      window.clearTimeout(timeout);
      preference?.removeEventListener?.('change', onChange);
    };
  }, [cancel, handoff, sourceExists, targetExists]);
  useEffect(() => () => { active.current = null; }, []);

  return { handoff, begin, accepted, cancel, targetReady, targetNotReady };
}
