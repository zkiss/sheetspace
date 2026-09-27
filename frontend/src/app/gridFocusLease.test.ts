import { describe, expect, it } from 'vitest';
import {
  activeFocusRequestId,
  pinsFocusedFrame,
  reduceGridFocusLease,
  type GridFocusLease,
} from './gridFocusLease';

const target = { sheetId: 'sheet-inputs', cell: { rowId: 'row-1', columnId: 'column-1' } };
const replacement = { sheetId: 'sheet-outputs', cell: { rowId: 'row-2', columnId: 'column-2' } };

describe('grid focus lease', () => {
  it('rejects stale request completion after a replacement is adopted', () => {
    const active: GridFocusLease = { token: 2, target: replacement, sheetId: replacement.sheetId, phase: 'request-active', requestId: 12 };

    expect(reduceGridFocusLease(active, { type: 'consume-request', requestId: 11 })).toBe(active);
    expect(reduceGridFocusLease(active, { type: 'cancel-request', requestId: 11 })).toBe(active);
    expect(reduceGridFocusLease(active, { type: 'bind-request', token: 1, requestId: 11, target })).toBe(active);
  });

  it('makes a consumed request terminal when its detailed body releases to overview', () => {
    const active: GridFocusLease = { token: 1, target, sheetId: target.sheetId, phase: 'request-active', requestId: 11 };
    const consumed = reduceGridFocusLease(active, { type: 'consume-request', requestId: 11 });

    expect(reduceGridFocusLease(consumed, {
      type: 'detail-displaced', observedToken: 1, token: 2, target,
    })).toBeNull();
  });

  it('does not let a stale release end or recreate a newer lease', () => {
    const active: GridFocusLease = { token: 2, target: replacement, sheetId: replacement.sheetId, phase: 'request-active', requestId: 12 };

    expect(reduceGridFocusLease(active, {
      type: 'detail-displaced', observedToken: 1, token: 3, target,
    })).toBe(active);
    expect(reduceGridFocusLease(active, { type: 'detailed-release', token: 1 })).toBe(active);
  });

  it('turns ordinary native ownership into one deferred restoration using the same token', () => {
    const native: GridFocusLease = { token: 4, target, sheetId: target.sheetId, phase: 'native-owned' };
    const awaiting = reduceGridFocusLease(native, {
      type: 'detail-displaced', observedToken: 4, token: 5, target,
    });

    expect(awaiting).toEqual({ token: 4, target, sheetId: target.sheetId, phase: 'awaiting-detail' });
    expect(pinsFocusedFrame(native)).toBe(true);
    expect(pinsFocusedFrame(awaiting)).toBe(false);
  });

  it('keeps request delivery authoritative through native focus and mode effects', () => {
    const active: GridFocusLease = { token: 6, target, sheetId: target.sheetId, phase: 'request-active', requestId: 14 };

    expect(reduceGridFocusLease(active, { type: 'native-focus', token: 7, target })).toBe(active);
    expect(reduceGridFocusLease(active, {
      type: 'detail-displaced', observedToken: 6, token: 7, target,
    })).toBe(active);
    expect(activeFocusRequestId(active)).toBe(14);
  });

  it('releases a consumed detailed request into native ownership', () => {
    const consumed: GridFocusLease = {
      token: 8, target, sheetId: target.sheetId, phase: 'consumed-awaiting-release', requestId: 15,
    };

    expect(reduceGridFocusLease(consumed, { type: 'detailed-release', token: 8 })).toEqual({
      token: 8, target, sheetId: target.sheetId, phase: 'native-owned',
    });
    expect(pinsFocusedFrame(consumed)).toBe(true);
    expect(activeFocusRequestId(consumed)).toBeNull();
  });
});
