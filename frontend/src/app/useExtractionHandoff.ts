import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SheetDocument } from '@workbook/core/model';

export const EXTRACTION_HANDOFF_DURATION = 240;
export type ExtractionCoverage = 'unknown' | 'empty' | 'waiting' | 'covered';
export type ExtractionHandoffResult = 'covered' | 'empty' | 'aborted';

type Handoff = {
  source: SheetDocument;
  targetId: string;
  token: number;
  accepted: boolean;
  ready: boolean;
};

/** Owns the transient source snapshot until the target has taken visual ownership. */
export function useExtractionHandoff(sheetIds: readonly string[], onExit?: (token: number, result: ExtractionHandoffResult) => void) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  const validator = useRef<{ token: number; measure: () => ExtractionCoverage } | null>(null);
  const fade = useRef(0);
  const exit = useRef(onExit);
  exit.current = onExit;
  const finish = useCallback((token: number, result: ExtractionHandoffResult) => {
    if (active.current !== token) return;
    active.current = null;
    validator.current = null;
    fade.current++;
    setHandoff((current) => current?.token === token ? null : current);
    exit.current?.(token, result);
  }, []);
  const registerCoverage = useCallback((token: number, measure: () => ExtractionCoverage) => {
    if (active.current !== token) return () => {};
    const registration = { token, measure };
    validator.current = registration;
    return () => { if (validator.current === registration) validator.current = null; };
  }, []);
  const begin = useCallback((source: SheetDocument, targetId: string) => {
    if (active.current !== null) finish(active.current, 'aborted');
    const token = ++generation.current;
    active.current = token;
    fade.current++;
    setHandoff({ source, targetId, token, accepted: false, ready: false });
    return token;
  }, [finish]);
  const cancel = useCallback((token: number) => finish(token, 'aborted'), [finish]);
  const empty = useCallback((token: number) => finish(token, 'empty'), [finish]);
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
    fade.current++;
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
    const lifetime = ++fade.current;
    const retire = () => {
      if (active.current !== token || fade.current !== lifetime) return;
      const registration = validator.current;
      const coverage = registration?.token === token ? registration.measure() : 'unknown';
      if (coverage === 'covered' || coverage === 'empty') finish(token, coverage);
      else targetNotReady(token);
    };
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) { retire(); return; }
    const onChange = () => { if (preference?.matches) retire(); };
    preference?.addEventListener?.('change', onChange);
    const timeout = window.setTimeout(retire, EXTRACTION_HANDOFF_DURATION);
    return () => {
      window.clearTimeout(timeout);
      preference?.removeEventListener?.('change', onChange);
    };
  }, [finish, handoff, sourceExists, targetExists, targetNotReady]);
  useEffect(() => () => {
    const token = active.current;
    active.current = null; validator.current = null; fade.current++;
    if (token !== null) exit.current?.(token, 'aborted');
  }, []);

  return { handoff, begin, accepted, cancel, empty, targetReady, targetNotReady, registerCoverage };
}
