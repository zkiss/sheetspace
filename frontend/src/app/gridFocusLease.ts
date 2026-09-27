import type { CellTarget } from '@grid/cellInteractionContracts';

type FocusLeaseBase = {
  token: number;
  sheetId: string;
  target: CellTarget;
};

export type GridFocusLease = FocusLeaseBase & (
  | { phase: 'native-owned' | 'awaiting-detail' }
  | { phase: 'request-active' | 'consumed-awaiting-release'; requestId: number }
);

export type GridFocusLeaseAction =
  | { type: 'native-focus'; token: number; target: CellTarget }
  | { type: 'await-detail'; token: number; target: CellTarget }
  | { type: 'detail-displaced'; observedToken: number | null; token: number; target: CellTarget }
  | { type: 'bind-request'; token: number; requestId: number; target: CellTarget }
  | { type: 'adopt-request'; token: number; requestId: number; target: CellTarget }
  | { type: 'consume-request'; requestId: number }
  | { type: 'cancel-request'; requestId: number }
  | { type: 'detailed-release'; token: number }
  | { type: 'external-focus' };

/**
 * One identity-safe lifecycle for native grid ownership and deferred focus.
 * Events which finish an operation carry its token or request ID so stale DOM
 * effects cannot release or recreate a newer owner.
 */
export function reduceGridFocusLease(
  lease: GridFocusLease | null,
  action: GridFocusLeaseAction,
): GridFocusLease | null {
  switch (action.type) {
    case 'native-focus':
      if (lease?.sheetId === action.target.sheetId
        && (lease.phase === 'request-active' || lease.phase === 'consumed-awaiting-release')) return lease;
      return { ...leaseBase(action.token, action.target), phase: 'native-owned' };
    case 'await-detail':
      return { ...leaseBase(action.token, action.target), phase: 'awaiting-detail' };
    case 'detail-displaced':
      if (lease?.token !== action.observedToken) return lease;
      if (lease?.phase === 'consumed-awaiting-release') return null;
      if (lease?.phase === 'request-active') return lease;
      return { ...leaseBase(lease?.token ?? action.token, action.target), phase: 'awaiting-detail' };
    case 'bind-request':
      if (lease?.token !== action.token || lease.phase !== 'awaiting-detail') return lease;
      return { ...leaseBase(action.token, action.target), phase: 'request-active', requestId: action.requestId };
    case 'adopt-request':
      if ((lease?.phase === 'request-active' || lease?.phase === 'consumed-awaiting-release')
        && lease.requestId === action.requestId) return lease;
      return { ...leaseBase(action.token, action.target), phase: 'request-active', requestId: action.requestId };
    case 'consume-request':
      return lease?.phase === 'request-active' && lease.requestId === action.requestId
        ? { ...lease, phase: 'consumed-awaiting-release' }
        : lease;
    case 'cancel-request':
      return lease?.phase === 'request-active' && lease.requestId === action.requestId ? null : lease;
    case 'detailed-release':
      return lease?.token === action.token && lease.phase === 'consumed-awaiting-release'
        ? { token: lease.token, sheetId: lease.sheetId, target: lease.target, phase: 'native-owned' }
        : lease;
    case 'external-focus':
      return null;
  }
}

export function activeFocusRequestId(lease: GridFocusLease | null) {
  return lease?.phase === 'request-active' ? lease.requestId : null;
}

export function pinsFocusedFrame(lease: GridFocusLease | null) {
  return lease?.phase === 'native-owned'
    || lease?.phase === 'request-active'
    || lease?.phase === 'consumed-awaiting-release';
}

function leaseBase(token: number, target: CellTarget): FocusLeaseBase {
  return { token, sheetId: target.sheetId, target };
}
